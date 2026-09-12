import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  /** Chunk index whose translation call should fail with a non-retriable error. */
  failOn: -1,
  /** Every chunk the fake provider was asked to translate. */
  translated: [] as string[],
  /** Resolves the failing call only once the test says so. */
  gate: null as null | Promise<void>,
};

vi.mock('../../src/llm/index.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/llm/index.ts')>(
    '../../src/llm/index.ts',
  );
  return {
    ...actual,
    createLlmClient: () => {
      const inner = actual.mockClient();
      return {
        id: 'mock',
        model: 'mock-reverse',
        async complete(req: Parameters<typeof inner.complete>[0]) {
          const last = [...req.messages].reverse().find((m) => m.role === 'user');
          const content = last?.content ?? '';
          const source = /<<<SOURCE>>>([\s\S]*?)<<<END_SOURCE>>>/.exec(content)?.[1];
          const isTranslate = source != null && !/Form a glossary/i.test(content);
          if (isTranslate) {
            state.translated.push(source.trim());
            if (state.gate) await state.gate;
            if (state.failOn >= 0 && state.translated.length === state.failOn + 1) {
              // Shape of a provider rejecting the request outright: classifyFailure
              // reads this as `request`, which is not retriable.
              const err = new Error('400 model not found') as Error & { status: number };
              err.status = 400;
              throw err;
            }
          }
          return inner.complete(req);
        },
      };
    },
  };
});

const { buildDemoEpub } = await import('../../src/ebook/demoBook.ts');
const { JobRunner } = await import('../../src/job/runner.ts');
const { defaultStoredProviders } = await import('../../src/llm/presets.ts');
type JobSettings = import('../../src/job/types.ts').JobSettings;

const settings: JobSettings = {
  sourceLang: 'en',
  targetLang: 'ru',
  chunkChars: 200,
  logLimit: 40,
  providerId: 'mock',
  model: 'mock-reverse',
  concurrency: 4,
  glossaryBatch: 2,
  reviewBatch: 5,
};

function stored() {
  return { ...defaultStoredProviders(), activeId: 'mock' as const };
}

async function preparedRunner() {
  const bytes = await buildDemoEpub();
  const runner = new JobRunner(() => {});
  await runner.prepare({ name: 'alice.epub', bytes }, settings, stored());
  runner.styleGuide = 'Keep the voice plain.';
  return runner;
}

beforeEach(() => {
  state.failOn = -1;
  state.translated = [];
  state.gate = null;
});

/**
 * `Promise.all` rejects on the first window's error while the others are still
 * awaiting their own LLM calls. Nothing used to abort them, so they translated
 * to the end of their ranges — billing the user — and a Resume then replaced
 * `this.abort`, leaving that first set unstoppable and double-translating.
 */
describe('a non-retriable failure under concurrency', () => {
  it('stops the other windows instead of letting them run on', async () => {
    const runner = await preparedRunner();
    state.failOn = 0;
    await runner.runTranslate();

    expect(runner.phase).toBe('error');
    expect(runner.failure?.kind).toBe('request');
    // The controller is aborted, which is what makes the siblings stand down.
    expect(runner.abort?.signal.aborted).toBe(true);

    const afterFailure = state.translated.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(state.translated.length).toBe(afterFailure);
  });

  it('refuses a second run while the first is still live', async () => {
    const runner = await preparedRunner();
    let release = () => {};
    state.gate = new Promise<void>((r) => {
      release = r;
    });

    const first = runner.runTranslate();
    await new Promise((r) => setTimeout(r, 10));
    // A Resume at this point used to pass the phase-only guard and start a
    // whole second set of windows over the same chunks.
    await runner.runTranslate();
    release();
    await first;

    const seen = new Set(state.translated);
    expect(state.translated.length).toBe(seen.size);
    expect(runner.translated.length).toBe(runner.book!.chunks.length);
  });

  it('keeps the finished work when the failure is cleared', async () => {
    const runner = await preparedRunner();
    state.failOn = 1;
    await runner.runTranslate();
    expect(runner.phase).toBe('error');

    const done = runner.translated.length;
    const guide = runner.styleGuide;
    runner.clearFailure();

    // This is what "Check the model" does. It used to call reset().
    expect(runner.failure).toBeNull();
    expect(runner.translated.length).toBe(done);
    expect(runner.styleGuide).toBe(guide);
    expect(runner.book).not.toBeNull();
  });
});

describe('retryKeptOriginal', () => {
  /**
   * The field used to keep whatever the previous pass set, so pausing a retry
   * sent `resume()` into the review pass and the chunks still holding source
   * text were packed that way.
   */
  it('marks the retry as a translate pass while it runs', async () => {
    const bytes = await buildDemoEpub();
    const seen: (string | null)[] = [];
    const runner = new JobRunner((s) => seen.push(s.pausedDuring));
    await runner.prepare({ name: 'alice.epub', bytes }, settings, stored());
    runner.styleGuide = 'Keep the voice plain.';
    await runner.runTranslate();

    runner.translated[0]!.usedOriginal = true;
    runner.pausedDuring = 'translateReview';
    seen.length = 0;
    await runner.retryKeptOriginal();

    expect(seen[0]).toBe('translate');
  });

  it('refuses to start while another pass is still live', async () => {
    const runner = await preparedRunner();
    let release = () => {};
    state.gate = new Promise<void>((r) => {
      release = r;
    });
    const first = runner.runTranslate();
    await new Promise((r) => setTimeout(r, 10));
    const liveController = runner.abort;

    await runner.retryKeptOriginal();
    // The running pass still owns its controller, so pause() can reach it.
    expect(runner.abort).toBe(liveController);
    release();
    await first;
  });
});
