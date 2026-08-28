import { describe, expect, it, vi } from 'vitest';
import {
  attachStatus,
  classifyFailure,
  CONNECTION_RETRIES,
  isRetryableError,
  waitUntilOnline,
  withNetworkRetry,
} from '../../src/llm/net.ts';

describe('network retry', () => {
  it('retries Failed to fetch then succeeds', async () => {
    let n = 0;
    const value = await withNetworkRetry(
      async () => {
        n += 1;
        if (n < 3) throw new TypeError('Failed to fetch');
        return 'ok';
      },
      { delays: [1, 1, 1], maxAttempts: 5 },
    );
    expect(value).toBe('ok');
    expect(n).toBe(3);
  });

  it(`reconnects Failed to fetch up to ${CONNECTION_RETRIES} times`, async () => {
    let n = 0;
    await expect(
      withNetworkRetry(
        async () => {
          n += 1;
          throw new TypeError('Failed to fetch');
        },
        { delays: Array(CONNECTION_RETRIES).fill(1) },
      ),
    ).rejects.toThrow(/Failed to fetch/);
    expect(n).toBe(1 + CONNECTION_RETRIES);
    expect(classifyFailure(new TypeError('Failed to fetch')).maxAttempts).toBe(1 + CONNECTION_RETRIES);
  });

  it('retries a request timeout, then succeeds', async () => {
    let n = 0;
    const value = await withNetworkRetry(
      async () => {
        n += 1;
        if (n < 4) throw new DOMException('Aborted', 'AbortError');
        return 'ok';
      },
      { delays: [1, 1, 1] },
    );
    expect(value).toBe('ok');
    expect(n).toBe(4);
  });

  it('retries an empty or cut-off model body', async () => {
    let n = 0;
    const value = await withNetworkRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error('Empty model response (no message.content)');
        return 'ok';
      },
      { delays: [1, 1] },
    );
    expect(value).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry 401', async () => {
    await expect(
      withNetworkRetry(
        async () => {
          throw attachStatus(new Error('401 unauthorized'), 401);
        },
        { delays: [1], maxAttempts: 5 },
      ),
    ).rejects.toThrow(/401/);
  });

  it('treats connection errors as retryable and auth as not', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableError(new Error('net::ERR_CONNECTION_CLOSED'))).toBe(true);
    expect(isRetryableError(new Error('Empty model response (no message.content)'))).toBe(true);
    expect(isRetryableError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isRetryableError(attachStatus(new Error('503'), 503))).toBe(true);
    expect(isRetryableError(attachStatus(new Error('invalid api key'), 401))).toBe(false);
    const user = new AbortController();
    user.abort();
    expect(isRetryableError(new TypeError('Failed to fetch'), user.signal)).toBe(false);
    expect(isRetryableError(new DOMException('Aborted', 'AbortError'), user.signal)).toBe(false);
  });

  it('waits for the online event when navigator is offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      let waited = false;
      const p = waitUntilOnline(undefined, () => {
        waited = true;
      });
      expect(waited).toBe(true);
      window.dispatchEvent(new Event('online'));
      await p;
    } finally {
      spy.mockRestore();
    }
  });
});
