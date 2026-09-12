import { describe, expect, it } from 'vitest';
import { defaultStoredProviders } from '../../src/llm/presets.ts';
import { reviewAgentSystemPrompt, reviewAgentUserPrompt } from '../../src/llm/prompts.ts';
import { runReviewAgent } from '../../src/review/agent.ts';

describe('runReviewAgent', () => {
  it('reads one chunk on the mock provider and does not edit', async () => {
    const reads: number[] = [];
    let edits = 0;
    await runReviewAgent({
      stored: { ...defaultStoredProviders(), activeId: 'mock' },
      abortSignal: new AbortController().signal,
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: '## Names',
      glossary: [],
      ids: [2, 3],
      chunkCount: 10,
      tools: {
        readOriginalChunk: () => 'Hello Alice',
        readTranslatedChunk: (id) => {
          reads.push(id);
          return 'ecilA olleH';
        },
        editTranslatedChunk: () => {
          edits += 1;
          return 'ok';
        },
      },
    });
    expect(reads).toEqual([2]);
    expect(edits).toBe(0);
  });
});

describe('reviewAgentUserPrompt', () => {
  it('names the chunks to check and the neighbours to read', () => {
    const prompt = reviewAgentUserPrompt({ ids: [2, 3, 4, 5, 6], chunkCount: 120 });
    expect(prompt).toContain('chunks 2, 3, 4, 5, 6 (of 120 chunks in this book)');
    expect(prompt).toContain('Also read chunk 1 and 7');
    expect(prompt).toContain('Start with chunk 2.');
  });

  it('does not point at neighbours that do not exist', () => {
    const whole = reviewAgentUserPrompt({ ids: [0, 1, 2], chunkCount: 3 });
    expect(whole).not.toContain('Also read chunk');
    const head = reviewAgentUserPrompt({ ids: [0, 1], chunkCount: 10 });
    expect(head).toContain('Also read chunk 2 ');
    const tail = reviewAgentUserPrompt({ ids: [8, 9], chunkCount: 10 });
    expect(tail).toContain('Also read chunk 7 ');
  });
});

describe('reviewAgentSystemPrompt', () => {
  it('describes chunks as consecutive pieces and names the three tools', () => {
    const prompt = reviewAgentSystemPrompt({
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: '',
      glossary: [{ src: 'Alice', dst: 'Алиса' }],
      chunkCount: 120,
    });
    expect(prompt).toContain('consecutive pieces of the book');
    expect(prompt).toContain('chunks 0…119');
    expect(prompt).toContain('read_original_chunk(id)');
    expect(prompt).toContain('read_translated_chunk(id)');
    expect(prompt).toContain('edit_translated_chunk(id, old, new)');
    expect(prompt).toContain('Alice — Алиса');
  });
});
