import { describe, expect, it } from 'vitest';
import { buildDemoEpub } from '../../src/ebook/demoBook.ts';
import { JobRunner } from '../../src/job/runner.ts';
import { groupReviewWindows } from '../../src/job/windows.ts';
import { defaultStoredProviders, type StoredProviders } from '../../src/llm/presets.ts';
import type { JobSettings } from '../../src/job/types.ts';

const settings: JobSettings = {
  sourceLang: 'en',
  targetLang: 'ru',
  chunkChars: 80,
  logLimit: 40,
  providerId: 'mock',
  model: 'mock-reverse',
  concurrency: 2,
  glossaryBatch: 2,
  reviewBatch: 2,
};

function stored(): StoredProviders {
  return { ...defaultStoredProviders(), activeId: 'mock' };
}

describe('translate review', () => {
  it('runs disjoint review windows after a full translate, without rewriting mock output', async () => {
    const bytes = await buildDemoEpub();
    const runner = new JobRunner(() => undefined);
    await runner.prepare({ name: 'alice.epub', bytes }, settings, stored());
    await runner.runStyle();
    runner.approveStyle(runner.styleGuide);
    await runner.runGlossary();
    expect(runner.phase).toBe('done');

    const windows = groupReviewWindows(runner.book!.chunks.length, settings.reviewBatch);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[1]!.from).toBe(windows[0]!.to);
    expect(Object.keys(runner.reviewedChunks).length).toBe(runner.book!.chunks.length);
    expect(runner.events.some((e) => e.key === 'reviewWindow')).toBe(true);
    expect(runner.events.some((e) => e.key === 'reviewReady')).toBe(true);

    const before = runner.translated.map((t) => t.translation);
    await runner.runTranslateReview();
    expect(runner.translated.map((t) => t.translation)).toEqual(before);
  });
});
