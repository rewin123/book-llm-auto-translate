import { describe, expect, it } from 'vitest';
import {
  buildDemoEpub,
  buildDemoFb2,
  TINY_PNG,
} from '../../src/ebook/demoBook.ts';
import { parseEpub, packEpubFromMarkdown, readZipEntry, zipFirstEntry } from '../../src/ebook/epub.ts';
import { parseFb2 } from '../../src/ebook/fb2.ts';
import { packBook } from '../../src/ebook/index.ts';
import { joinMarkdown } from '../../src/ebook/markdown.ts';

describe('EPUB markdown round-trip', () => {
  it('converts to markdown, builds a new EPUB, and stays parseable', async () => {
    const src = await buildDemoEpub();
    const parsed = await parseEpub(src, 'alice.epub', 2500);
    expect(parsed.chunks.length).toBeGreaterThan(0);
    const md = parsed.chunks.map((c) => c.markdown).join('');
    expect(md).toContain('Alice');
    expect(md).toMatch(/# Down the Rabbit-Hole/);
    expect(md).toContain('![A tiny cover](images/cover.png)');

    const packed = await packEpubFromMarkdown({
      title: parsed.title,
      markdown: joinMarkdown(parsed.chunks.map((c) => c.markdown)),
      images: parsed.images,
      targetLang: 'en',
      outName: 'alice.en.epub',
    });

    const first = zipFirstEntry(packed.bytes);
    expect(first.name).toBe('mimetype');
    expect(first.method).toBe(0);

    const png = await readZipEntry(packed.bytes, 'OEBPS/images/cover.png');
    expect(png).toEqual(TINY_PNG);

    const xhtml = await readZipEntry(packed.bytes, 'OEBPS/chapter-001.xhtml');
    expect(new TextDecoder().decode(xhtml)).toContain('Alice');

    const again = await parseEpub(packed.bytes, packed.fileName, 2500);
    expect(again.chunks.length).toBeGreaterThan(0);
    expect(again.chunks.map((c) => c.markdown).join('')).toContain('Alice');
    expect(again.title).toBe('Alice excerpt');
  });
});

describe('FB2 → markdown → EPUB', () => {
  it('keeps the cover image in the generated EPUB', async () => {
    const xml = buildDemoFb2();
    const bytes = new TextEncoder().encode(xml);
    const parsed = parseFb2(bytes, 'alice.fb2', 2500);
    expect(parsed.chunks.map((c) => c.markdown).join('')).toContain('Alice');

    const packed = await packBook({
      book: parsed,
      translations: parsed.chunks.map((c) => c.markdown),
      targetLang: 'en',
    });
    expect(packed.fileName).toBe('alice.en.epub');
    const png = await readZipEntry(packed.bytes, 'OEBPS/images/cover.png');
    expect(png).toEqual(TINY_PNG);

    const again = await parseEpub(packed.bytes, packed.fileName, 2500);
    expect(again.chunks.map((c) => c.markdown).join('')).toContain('Alice');
  });
});
