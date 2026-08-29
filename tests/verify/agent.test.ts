import { describe, expect, it } from 'vitest';
import { defaultStoredProviders } from '../../src/llm/presets.ts';
import { runImproveTurn, type ImproveStreamEvent } from '../../src/verify/agent.ts';

describe('runImproveTurn stream events', () => {
  it('emits tool events before the final mock reply when given a glossary pair', async () => {
    const events: ImproveStreamEvent[] = [];
    const result = await runImproveTurn({
      stored: { ...defaultStoredProviders(), activeId: 'mock' },
      abortSignal: new AbortController().signal,
      sourceLang: 'en',
      targetLang: 'ru',
      chunkIndex: 0,
      chunkCount: 1,
      styleGuide: '## Names',
      glossary: [],
      original: 'Alice',
      translation: 'ecilA',
      messages: [],
      userText: 'Alice -> Алиса',
      onEvent: (e) => events.push(e),
      tools: {
        editStyleGuideline: () => 'ok',
        addOrReplaceGlossary: () => 'Glossary: Alice → Алиса',
        doTranslate: async () => ({ original: 'Alice', translate: 'Алиса' }),
      },
    });
    expect(events.map((e) => e.type)).toEqual(['tool', 'tool', 'text']);
    expect(events.filter((e) => e.type === 'tool').map((e) => e.name)).toEqual([
      'add_or_replace_glossary',
      'do_translate',
    ]);
    expect(result.toolNames).toEqual(['add_or_replace_glossary', 'do_translate']);
  });
});
