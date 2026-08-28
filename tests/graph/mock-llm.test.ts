import { describe, expect, it } from 'vitest';
import { buildDemoEpub, TINY_PNG } from '../../src/ebook/demoBook.ts';
import { parseEpub, packEpub, readZipEntry } from '../../src/ebook/epub.ts';
import { validateTranslation } from '../../src/ebook/validate.ts';
import { translateChunkNode } from '../../src/graph/nodes.ts';
import { mockClient } from '../../src/llm/client.ts';
import { mergeGlossary } from '../../src/glossary/index.ts';

describe('graph + mock LLM', () => {
  it('translates every chunk, keeps images, and stays sequential', async () => {
    const src = await buildDemoEpub();
    const book = await parseEpub(src, 'alice.epub', 400);
    const client = mockClient();
    const abort = new AbortController();
    let glossary = mergeGlossary([], []);
    const translated: string[] = [];
    const lastTwo: { index: number; original: string; translation: string }[] = [];

    for (const chunk of book.chunks) {
      const result = await translateChunkNode({
        client,
        chunk,
        sourceLang: 'en',
        targetLang: 'ru',
        styleGuide: 'Keep tags. Reverse text for tests.',
        glossary,
        lastTwo,
        abortSignal: abort.signal,
        retries: 0,
      });
      expect(result.usedOriginal).toBe(false);
      expect(validateTranslation(chunk.xml, result.xml).ok).toBe(true);
      glossary = mergeGlossary(glossary, result.glossary);
      translated.push(result.xml);
      lastTwo.push({ index: chunk.index, original: chunk.xml, translation: result.xml });
      if (lastTwo.length > 2) lastTwo.shift();
    }

    expect(translated.join('')).toMatch(/ecilA/);

    const packed = await packEpub({
      sourceBytes: src,
      chunks: book.chunks,
      translations: translated,
      targetLang: 'ru',
      outName: 'alice.ru.epub',
    });
    const png = await readZipEntry(packed.bytes, 'OEBPS/images/cover.png');
    expect(png).toEqual(TINY_PNG);
  });
});
