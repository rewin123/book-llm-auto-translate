import { describe, expect, it } from 'vitest';
import { buildDemoEpub, TINY_PNG } from '../../src/ebook/demoBook.ts';
import { parseEpub, packEpubFromMarkdown, readZipEntry } from '../../src/ebook/epub.ts';
import { joinMarkdown } from '../../src/ebook/markdown.ts';
import { validateTranslation } from '../../src/ebook/validate.ts';
import { translateChunkNode } from '../../src/graph/nodes.ts';
import { mockClient } from '../../src/llm/client.ts';
import { mergeGlossary } from '../../src/glossary/index.ts';

describe('graph + mock LLM', () => {
  it('translates every chunk, keeps images, and the EPUB still opens', async () => {
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
        styleGuide: 'Keep markdown. Reverse text for tests.',
        glossary,
        lastTwo,
        abortSignal: abort.signal,
        retries: 0,
      });
      expect(result.usedOriginal).toBe(false);
      expect(validateTranslation(chunk.markdown, result.markdown).ok).toBe(true);
      glossary = mergeGlossary(glossary, result.glossary);
      translated.push(result.markdown);
      lastTwo.push({
        index: chunk.index,
        original: chunk.markdown,
        translation: result.markdown,
      });
      if (lastTwo.length > 2) lastTwo.shift();
    }

    expect(translated.join('')).toMatch(/ecilA/);

    const packed = await packEpubFromMarkdown({
      title: book.title,
      markdown: joinMarkdown(translated),
      images: book.images,
      targetLang: 'ru',
      outName: 'alice.ru.epub',
    });
    const png = await readZipEntry(packed.bytes, 'OEBPS/images/cover.png');
    expect(png).toEqual(TINY_PNG);

    const again = await parseEpub(packed.bytes, packed.fileName, 400);
    expect(again.chunks.map((c) => c.markdown).join('')).toMatch(/ecilA/);
  });
});
