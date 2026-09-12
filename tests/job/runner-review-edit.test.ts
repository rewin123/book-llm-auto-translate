import { describe, expect, it, vi } from 'vitest';
import { buildDemoEpub } from '../../src/ebook/demoBook.ts';
import { JobRunner } from '../../src/job/runner.ts';
import { groupReviewWindows } from '../../src/job/windows.ts';
import { defaultStoredProviders, type StoredProviders } from '../../src/llm/presets.ts';
import type { JobSettings } from '../../src/job/types.ts';
import type { ReviewTools } from '../../src/review/agent.ts';

type Call = { ids: number[]; chunkCount: number; tools: ReviewTools };

const calls: Call[] = [];

/**
 * Drives the reviewer's tools by hand: the mock provider short-circuits the
 * agent, so this is the only way to see what the runner's tool closures do.
 */
vi.mock('../../src/review/agent.ts', () => ({
  runReviewAgent: async (opts: Call) => {
    calls.push(opts);
    for (const id of opts.ids) {
      opts.tools.readOriginalChunk(id);
      opts.tools.readTranslatedChunk(id);
    }
  },
}));

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

async function translatedRunner(): Promise<JobRunner> {
  const bytes = await buildDemoEpub();
  const runner = new JobRunner(() => undefined);
  await runner.prepare({ name: 'alice.epub', bytes }, settings, stored());
  await runner.runStyle();
  runner.approveStyle(runner.styleGuide);
  await runner.runGlossary();
  return runner;
}

describe('review tools are scoped to one chunk', () => {
  it('edits only the named chunk and refuses everything outside it', async () => {
    calls.length = 0;
    const runner = await translatedRunner();
    const chunkCount = runner.book!.chunks.length;
    const windows = groupReviewWindows(chunkCount, settings.reviewBatch);
    expect(calls.length).toBe(windows.length);

    const first = calls[0]!;
    const second = calls[1]!;
    expect(first.chunkCount).toBe(chunkCount);
    expect(first.ids).toEqual([windows[0]!.from, windows[0]!.to - 1]);

    const before = runner.translated.map((t) => t.translation);
    const targetId = first.ids[0]!;
    const target = before[targetId]!;
    const outsideId = second.ids[0]!;

    // A window may read any chunk, including its neighbours...
    expect(first.tools.readTranslatedChunk(outsideId)).toBe(before[outsideId]);
    expect(first.tools.readTranslatedChunk(chunkCount)).toContain('err: no chunk');
    // ...but it may only write the chunks it was given.
    expect(first.tools.editTranslatedChunk(outsideId, before[outsideId]!.slice(0, 4), 'zzzz')).toBe(
      `err: chunk ${outsideId} is not in your task; you may edit ${first.ids.join(', ')}`,
    );

    // A match that only exists across the join is refused, so a replacement can
    // never land in the wrong chunk or be written twice.
    const seam = target.slice(-4) + before[targetId + 1]!.slice(0, 4);
    expect(first.tools.editTranslatedChunk(targetId, seam, 'X')).toBe(
      'err: old was not found in this chunk',
    );

    const piece = target.slice(0, 6);
    expect(first.tools.editTranslatedChunk(targetId, piece, 'ПРАВКА')).toBe('ok');

    const after = runner.translated.map((t) => t.translation);
    expect(after[targetId]).toBe('ПРАВКА' + target.slice(6));
    for (let i = 0; i < after.length; i++) {
      if (i !== targetId) expect(after[i]).toBe(before[i]);
    }
    const pair = runner.translated.find((t) => t.index === targetId)!;
    expect(pair.preReview).toBe(target);
    expect(runner.events.some((e) => e.key === 'reviewEdit')).toBe(true);
  });
});
