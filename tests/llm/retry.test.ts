import { describe, expect, it, vi } from 'vitest';
import {
  attachRetryAfter,
  attachStatus,
  classifyFailure,
  errorStatus,
  isTimeoutError,
  sleepOrOnline,
  withNetworkRetry,
} from '../../src/llm/net.ts';
import { migrateProviders } from '../../src/storage/providers.ts';

describe('errorStatus', () => {
  it('reads a flat status', () => {
    expect(errorStatus(attachStatus(new Error('nope'), 429))).toBe(429);
  });

  it('reads a status nested under a response', () => {
    const err = Object.assign(new Error('nope'), { response: { status: 503 } });
    expect(errorStatus(err)).toBe(503);
  });

  /**
   * The status used to be scraped out of the message text, which misread prose:
   * a token count became an HTTP status, turning a permanent failure into eleven
   * retries and hiding the advice the user actually needed.
   */
  it('does not invent a status from numbers in the message', () => {
    const msg =
      "maximum context length is 16385 tokens, however you requested 16400 tokens (400 in the messages)";
    expect(errorStatus(new Error(msg))).toBeNull();
  });

  it('does not read a token count as a server error', () => {
    expect(errorStatus(new Error('request used 503 tokens'))).toBeNull();
  });
});

describe('classifyFailure', () => {
  it('treats a context overflow as permanent even when it arrives as a 400', () => {
    const err = attachStatus(new Error('This model maximum context length is 8192 tokens'), 400);
    const verdict = classifyFailure(err);
    expect(verdict.kind).toBe('context');
    expect(verdict.retryable).toBe(false);
  });

  it('treats a context overflow reported as a 500 as permanent too', () => {
    const err = attachStatus(new Error('input is too long for this model'), 500);
    expect(classifyFailure(err).kind).toBe('context');
  });

  it('still retries a genuine server error', () => {
    const verdict = classifyFailure(attachStatus(new Error('upstream exploded'), 503));
    expect(verdict.kind).toBe('server');
    expect(verdict.retryable).toBe(true);
  });

  it('does not retry auth failures', () => {
    expect(classifyFailure(attachStatus(new Error('bad key'), 401)).retryable).toBe(false);
  });

  it('gives our own step timeout a small budget, not the reconnect budget', () => {
    const err = new DOMException('step timeout of 180000ms exceeded', 'TimeoutError');
    expect(isTimeoutError(err)).toBe(true);
    const verdict = classifyFailure(err);
    expect(verdict.retryable).toBe(true);
    expect(verdict.maxAttempts).toBeLessThanOrEqual(2);
  });

  it('stops retrying a rate limit that asks for longer than the whole budget', () => {
    const err = attachRetryAfter(attachStatus(new Error('slow down'), 429), '3600');
    const verdict = classifyFailure(err);
    expect(verdict.kind).toBe('rate');
    expect(verdict.retryable).toBe(false);
  });

  it('keeps retrying a short rate limit', () => {
    const err = attachRetryAfter(attachStatus(new Error('slow down'), 429), '2');
    expect(classifyFailure(err).retryable).toBe(true);
  });
});

describe('Retry-After', () => {
  it('records both the honoured delay and what was asked for', () => {
    const err = attachRetryAfter(new Error('x'), '3600') as Error & {
      retryAfterMs: number;
      retryAfterRequestedMs: number;
    };
    expect(err.retryAfterMs).toBe(120_000);
    expect(err.retryAfterRequestedMs).toBe(3_600_000);
  });

  /**
   * A short `Retry-After` replaced the ladder without raising the attempt count,
   * so a per-minute limit answering `retry-after: 2` burned all eleven attempts
   * in about 22 seconds — inside the window that still had to pass — and the job
   * died on a limit the default ladder would have waited out.
   */
  it('raises the attempt budget when a short delay replaces the ladder', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const run = withNetworkRetry(
        async () => {
          calls += 1;
          throw attachRetryAfter(attachStatus(new Error('slow down'), 429), '2');
        },
        { delays: [2000] },
      ).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await run;
      // The ladder spans ~170s, so a 2s delay has to be tried far more than 11
      // times to cover the same ground.
      expect(calls).toBeGreaterThan(11);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sleepOrOnline', () => {
  /**
   * Subscribing to `online` unconditionally cut every backoff short, rate limits
   * included: a Wi-Fi flap during a cooldown resent the request immediately,
   * earned another 429, and spent the budget without honouring the limit.
   */
  it('ignores an online event during an ordinary backoff', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void sleepOrOnline(30_000).then(() => {
        done = true;
      });
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends early on reconnect when the wait exists because we are offline', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void sleepOrOnline(30_000, undefined, true).then(() => {
        done = true;
      });
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * An id from another build resolved to PROVIDER_PRESETS[0] — the mock provider,
 * which "translates" by reversing text. That passed validation, so the run
 * completed and offered a downloadable book of gibberish.
 */
describe('migrateProviders', () => {
  it('replaces an unknown active provider with the default', () => {
    const migrated = migrateProviders({ activeId: 'some-retired-preset' as never });
    expect(migrated.activeId).not.toBe('mock');
    expect(migrated.activeId).toBe('deepseek');
  });

  it('keeps a known provider', () => {
    expect(migrateProviders({ activeId: 'groq' }).activeId).toBe('groq');
  });

  it('keeps the mock provider when it was chosen on purpose', () => {
    expect(migrateProviders({ activeId: 'mock' }).activeId).toBe('mock');
  });
});
