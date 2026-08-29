import { describe, expect, it } from 'vitest';
import { buildDemoEpub } from '../../src/ebook/demoBook.ts';
import { JobRunner } from '../../src/job/runner.ts';
import { defaultStoredProviders, type StoredProviders } from '../../src/llm/presets.ts';
import type { JobSettings } from '../../src/job/types.ts';
import { longestChunkIndex } from '../../src/verify/chunk.ts';

const settings: JobSettings = {
  sourceLang: 'en',
  targetLang: 'ru',
  chunkChars: 400,
  logLimit: 40,
  providerId: 'mock',
  model: 'mock-reverse',
  concurrency: 1,
  glossaryBatch: 2,
  reviewBatch: 5,
};

function stored(): StoredProviders {
  return { ...defaultStoredProviders(), activeId: 'mock' };
}

describe('Guideline Verifier', () => {
  it('translates the longest chunk without writing the book translation list', async () => {
    const bytes = await buildDemoEpub();
    const runner = new JobRunner(() => undefined);
    await runner.prepare({ name: 'alice.epub', bytes }, settings, stored());
    await runner.runStyle();
    runner.approveStyle(runner.styleGuide, [{ src: 'Alice', dst: 'Алиса' }]);
    await runner.runVerify();
    expect(runner.phase).toBe('verifyReview');
    expect(runner.verifyIndex).toBe(longestChunkIndex(runner.book!.chunks));
    expect(runner.verifyPair?.original).toBe(runner.book!.chunks[runner.verifyIndex]!.markdown);
    expect(runner.verifyPair?.translation).toBeTruthy();
    expect(runner.translated).toEqual([]);

    runner.patchVerifyGuide('## Work', '## Work (edited)');
    expect(runner.styleGuide.startsWith('## Work (edited)')).toBe(true);
    runner.upsertVerifyGlossary('White Rabbit', 'Белый Кролик');
    expect(runner.glossary.some((e) => e.src === 'White Rabbit' && e.dst === 'Белый Кролик')).toBe(
      true,
    );

    await runner.runVerify({ index: 0 });
    expect(runner.verifyIndex).toBe(0);
    expect(runner.verifyPair?.index).toBe(0);
    expect(runner.translated).toEqual([]);
  });
});
