import { describe, expect, it } from 'vitest';
import { defaultStoredProviders } from '../../src/llm/presets.ts';
import { reviewAgentUserPrompt } from '../../src/llm/prompts.ts';
import { runReviewAgent } from '../../src/review/agent.ts';

describe('runReviewAgent', () => {
  it('reads the current translation on the mock provider and does not edit', async () => {
    let reads = 0;
    let edits = 0;
    await runReviewAgent({
      stored: { ...defaultStoredProviders(), activeId: 'mock' },
      abortSignal: new AbortController().signal,
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: '## Names',
      glossary: [],
      original: 'Hello Alice',
      translation: 'ecilA olleH',
      from: 0,
      to: 1,
      chunkCount: 1,
      tools: {
        readTranslate: () => {
          reads += 1;
          return 'ecilA olleH';
        },
        editTranslate: () => {
          edits += 1;
          return 'ok';
        },
      },
    });
    expect(reads).toBe(1);
    expect(edits).toBe(0);
  });
});

describe('reviewAgentUserPrompt', () => {
  it('wraps original and translate in the tags the agent is told to expect', () => {
    expect(reviewAgentUserPrompt({ original: 'A', translation: 'B' })).toBe(
      `<original>
A
</original>
<translate>
B
</translate>`,
    );
  });
});
