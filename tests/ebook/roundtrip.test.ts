import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
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

  it('does not invent numbered chapter titles when a document has no heading', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plain</dc:title><dc:language>en</dc:language><dc:identifier id="bookid">urn:x</dc:identifier></metadata><manifest><item id="ch1" href="plain.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`,
    );
    zip.file(
      'OEBPS/plain.xhtml',
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Plain</title></head><body><p>Just a paragraph, no heading.</p></body></html>`,
    );
    const src = await zip.generateAsync({ type: 'uint8array' });
    const parsed = await parseEpub(src, 'plain.epub', 2500);
    const md = parsed.chunks.map((c) => c.markdown).join('');
    expect(md).toContain('Just a paragraph');
    expect(md).not.toMatch(/^# Chapter \d+/m);
    expect(parsed.chunks.every((c) => !/^Chapter \d+$/.test(c.chapterTitle))).toBe(true);

    const packed = await packEpubFromMarkdown({
      title: parsed.title,
      markdown: joinMarkdown(parsed.chunks.map((c) => c.markdown)),
      images: parsed.images,
      targetLang: 'en',
      outName: 'plain.en.epub',
    });
    const nav = new TextDecoder().decode(await readZipEntry(packed.bytes, 'OEBPS/nav.xhtml'));
    expect(nav).not.toMatch(/Chapter \d+/);
    const chapter = new TextDecoder().decode(await readZipEntry(packed.bytes, 'OEBPS/chapter-001.xhtml'));
    expect(chapter).not.toContain('<h1>Chapter ');
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

  it('does not number untitled FB2 sections', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info><book-title>Plain</book-title><lang>en</lang></title-info></description>
  <body>
    <section><p>First untitled section.</p></section>
    <section><p>Second untitled section.</p></section>
  </body>
</FictionBook>`;
    const parsed = parseFb2(new TextEncoder().encode(xml), 'plain.fb2', 2500);
    expect(parsed.chunks.map((c) => c.chapterTitle)).toEqual(['', '']);
    const md = parsed.chunks.map((c) => c.markdown).join('\n');
    expect(md).not.toMatch(/# Plain \d/);
    expect(md).not.toMatch(/# Chapter \d/);
  });
});
