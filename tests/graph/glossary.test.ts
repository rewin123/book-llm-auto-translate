import { describe, expect, it } from 'vitest';
import { extractGlossaryNode, lastTwoFor } from '../../src/graph/glossary.ts';
import { parseGlossaryJson } from '../../src/glossary/index.ts';
import { mockClient } from '../../src/llm/client.ts';
import { glossaryUserPrompt, styleAgentUserPrompt, translateSystemPrompt } from '../../src/llm/prompts.ts';

describe('glossary JSON', () => {
  it('reads a bare object and ignores non-string values', () => {
    expect(parseGlossaryJson('{"Andrei":"Андрей","n":1,"Alice":"Алиса"}')).toEqual([
      { src: 'Andrei', dst: 'Андрей' },
      { src: 'Alice', dst: 'Алиса' },
    ]);
  });

  it('strips fences and leading chatter', () => {
    const text = 'Here you go:\n```json\n{"White Rabbit":"Белый Кролик"}\n```\n';
    expect(parseGlossaryJson(text)).toEqual([{ src: 'White Rabbit', dst: 'Белый Кролик' }]);
  });

  it('returns empty on invalid JSON', () => {
    expect(parseGlossaryJson('not json')).toEqual([]);
  });
});

describe('extractGlossaryNode', () => {
  it('returns a JSON map from the mock client', async () => {
    const abort = new AbortController();
    const result = await extractGlossaryNode({
      client: mockClient(),
      markdown: 'Alice met the Cheshire Cat.',
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: 'Keep names consistent.',
      abortSignal: abort.signal,
      retries: 0,
    });
    expect(result.glossary.some((e) => e.src === 'Alice')).toBe(true);
    expect(result.llmCalls[0]?.user).toContain('Form a glossary');
  });
});

describe('lastTwoFor', () => {
  it('picks the two preceding book indices when they exist', () => {
    const pairs = [
      { index: 0, original: 'a', translation: 'A' },
      { index: 2, original: 'c', translation: 'C' },
    ];
    expect(lastTwoFor(3, pairs).map((p) => p.index)).toEqual([2]);
    expect(lastTwoFor(2, pairs).map((p) => p.index)).toEqual([0]);
    expect(lastTwoFor(0, pairs)).toEqual([]);
  });
});

describe('prompts', () => {
  it('asks the translator for translation only', () => {
    const sys = translateSystemPrompt({
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: 'Be literary.',
    });
    expect(sys).not.toContain('<<<TRANSLATION>>>');
    expect(sys).not.toContain('<<<END_TRANSLATION>>>');
    expect(sys).not.toContain('<<<GLOSSARY>>>');
    expect(sys).toMatch(/markdown only/i);
  });

  it('lists chapters in the style-agent user message', () => {
    const user = styleAgentUserPrompt({
      totalChunks: 4,
      chapterList: '# Redemption (chunks from 1 to 3)',
    });
    expect(user).toContain('# Redemption (chunks from 1 to 3)');
    expect(user).toContain('0-based');
  });

  it('asks for a JSON glossary', () => {
    expect(glossaryUserPrompt({ markdown: 'Hello', targetLang: 'ru' })).toContain('JSON object');
  });
});
