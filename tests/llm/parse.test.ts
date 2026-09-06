import { describe, expect, it } from 'vitest';
import {
  formatTranslateOutput,
  parseTranslateOutput,
  stripHarnessMarkers,
} from '../../src/llm/client.ts';
import { translateChunkNode } from '../../src/graph/nodes.ts';
import type { LlmClient } from '../../src/llm/client.ts';
import { lastTwoFor } from '../../src/graph/glossary.ts';
import { translateSystemPrompt } from '../../src/llm/prompts.ts';

describe('parseTranslateOutput', () => {
  it('unwraps a well-formed harness pair', () => {
    expect(parseTranslateOutput(formatTranslateOutput('Привет *мир*'))).toEqual({
      markdown: 'Привет *мир*',
    });
  });

  it('strips an opening tag when the model omits <<<END_TRANSLATION>>>', () => {
    const parsed = parseTranslateOutput('<<<TRANSLATION>>>\nПривет *мир*');
    expect(parsed.markdown).toBe('Привет *мир*');
    expect(parsed.markdown).not.toContain('TRANSLATION');
  });

  it('does not keep a doubled opening tag after a successful extract', () => {
    const parsed = parseTranslateOutput(
      '<<<TRANSLATION>>>\n<<<TRANSLATION>>>\nПривет *мир*\n<<<END_TRANSLATION>>>',
    );
    expect(parsed.markdown).toBe('Привет *мир*');
  });

  it('accepts raw markdown with no harness tags', () => {
    expect(parseTranslateOutput('Привет *мир*')).toEqual({ markdown: 'Привет *мир*' });
  });
});

describe('stripHarnessMarkers', () => {
  it('drops leftover SOURCE / GLOSSARY markers', () => {
    expect(stripHarnessMarkers('<<<SOURCE>>>Hi<<<END_SOURCE>>>')).toBe('Hi');
  });
});

describe('translate system prompt', () => {
  it('does not ask the model to wrap the chunk in harness tags', () => {
    const sys = translateSystemPrompt({
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: 'Be literary.',
    });
    expect(sys).not.toContain('Return EXACTLY this format');
    expect(sys).not.toContain('<<<TRANSLATION>>>');
    expect(sys).toMatch(/markdown only/i);
  });
});

describe('translateChunkNode harness leak', () => {
  it('stores the translation without the opening tag when the end marker is missing', async () => {
    const client: LlmClient = {
      id: 'unclosed',
      model: 'unclosed',
      async complete() {
        return { text: '<<<TRANSLATION>>>\nПривет *мир*', toolCalls: [] };
      },
    };
    const result = await translateChunkNode({
      client,
      chunk: {
        index: 0,
        documentPath: 'x.md',
        chapterTitle: 'x',
        markdown: 'Hello *world*',
      },
      sourceLang: 'en',
      targetLang: 'ru',
      styleGuide: 'Keep markdown.',
      glossary: [],
      lastTwo: [],
      abortSignal: new AbortController().signal,
      retries: 0,
    });
    expect(result.usedOriginal).toBe(false);
    expect(result.markdown).toBe('Привет *мир*');
  });
});

describe('lastTwoFor', () => {
  it('does not echo a leaked harness tag into the next prompt', () => {
    const prev = lastTwoFor(1, [
      {
        index: 0,
        original: 'Hello',
        translation: '<<<TRANSLATION>>>\nПривет',
      },
    ]);
    expect(prev[0]?.translation).toBe('Привет');
  });
});
