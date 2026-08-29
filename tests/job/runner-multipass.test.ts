import { describe, expect, it } from 'vitest';
import { buildDemoEpub } from '../../src/ebook/demoBook.ts';
import { JobRunner } from '../../src/job/runner.ts';
import { defaultStoredProviders, type StoredProviders } from '../../src/llm/presets.ts';
import type { JobSettings } from '../../src/job/types.ts';

const settings: JobSettings = {
  sourceLang: 'en',
  targetLang: 'ru',
  chunkChars: 400,
  logLimit: 40,
  providerId: 'mock',
  model: 'mock-reverse',
  concurrency: 2,
  glossaryBatch: 2,
  reviewBatch: 5,
};

function stored(): StoredProviders {
  return { ...defaultStoredProviders(), activeId: 'mock' };
}

describe('multipass JobRunner', () => {
  it('builds a frozen glossary then translates windows in parallel', async () => {
    const bytes = await buildDemoEpub();
    let lastPhase = '';
    const runner = new JobRunner((s) => {
      lastPhase = s.phase;
    });
    await runner.prepare({ name: 'alice.epub', bytes }, settings, stored());
    await runner.runStyle();
    expect(runner.phase).toBe('review');
    expect(runner.styleGuide.length).toBeGreaterThan(20);

    runner.approveStyle(runner.styleGuide, [{ src: 'Alice', dst: 'Алиса' }]);
    await runner.runGlossary();
    expect(runner.phase).toBe('done');
    expect(runner.glossary.some((e) => e.src === 'Alice' && e.dst === 'Алиса')).toBe(true);
    expect(runner.translated.length).toBe(runner.book!.chunks.length);
    expect(runner.translated.some((t) => !t.usedOriginal)).toBe(true);
    expect(lastPhase).toBe('done');
    runner.reset();
  });
});
