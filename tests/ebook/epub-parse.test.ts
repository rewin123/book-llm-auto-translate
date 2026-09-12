import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { packEpubFromMarkdown, parseEpub, zipFirstEntry } from '../../src/ebook/epub.ts';
import { ImageBag } from '../../src/ebook/images.ts';
import { TINY_PNG } from '../../src/ebook/demoBook.ts';

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function opf(href: string): string {
  return `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="i"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest><item id="c1" href="${href}" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
}

function chapter(inner: string, encoding = 'UTF-8'): string {
  return `<?xml version="1.0" encoding="${encoding}"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${inner}</body></html>`;
}

async function buildEpub(entryName: string, manifestHref: string, body: string | Uint8Array) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', opf(manifestHref));
  zip.file(`OEBPS/${entryName}`, body);
  return zip.generateAsync({ type: 'uint8array' });
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
}

/**
 * EPUB hrefs are URLs, ZIP entry names are not. Undecoded, a book whose file
 * names hold a space or non-ASCII character was reported to the user as corrupt.
 */
describe('percent-encoded manifest hrefs', () => {
  it('finds a chapter whose file name holds a space', async () => {
    const bytes = await buildEpub('Chapter 1.xhtml', 'Chapter%201.xhtml', chapter('<p>Real text.</p>'));
    const book = await parseEpub(bytes, 'spaced.epub', 5000);
    expect(book.chunks.map((c) => c.markdown).join('')).toContain('Real text');
  });

  it('finds a chapter whose file name is non-ASCII', async () => {
    const name = 'Глава 1.xhtml';
    const bytes = await buildEpub(name, encodeURIComponent(name), chapter('<p>Cyrillic name.</p>'));
    const book = await parseEpub(bytes, 'cyr.epub', 5000);
    expect(book.chunks.map((c) => c.markdown).join('')).toContain('Cyrillic name');
  });
});

/** Stripping only the start tag left the code in the prose, billed and translated. */
describe('script and style bodies', () => {
  it('keeps neither JavaScript nor CSS in the book text', async () => {
    const bytes = await buildEpub(
      'c.xhtml',
      'c.xhtml',
      chapter('<script type="text/javascript">var secret = 42; alert("boom");</script><p>Real text.</p><style>p{color:red}</style>'),
    );
    const md = (await parseEpub(bytes, 's.epub', 5000)).chunks.map((c) => c.markdown).join('');
    expect(md).not.toContain('secret');
    expect(md).not.toContain('alert');
    expect(md).not.toContain('color:red');
    expect(md).toContain('Real text');
  });
});

/** UTF-16 is a legal content-document encoding; JSZip's string mode is UTF-8 only. */
describe('content document encoding', () => {
  it('decodes a UTF-16 chapter instead of producing mojibake', async () => {
    const bytes = await buildEpub(
      'c.xhtml',
      'c.xhtml',
      utf16le(chapter('<p>Сигма текст.</p>', 'UTF-16')),
    );
    const md = (await parseEpub(bytes, 'u.epub', 5000)).chunks.map((c) => c.markdown).join('');
    expect(md).toContain('Сигма текст');
  });
});

describe('ImageBag', () => {
  it('keeps two distinct images that share a base name', () => {
    const bag = new ImageBag();
    const first = bag.add('art/cover.png', new Uint8Array([1]), 'image/png');
    const second = bag.add('cover.png', new Uint8Array([2]), 'image/png');
    expect(first).not.toBe(second);
    expect(bag.images).toHaveLength(2);
    expect(bag.images[1]!.bytes).toEqual(new Uint8Array([2]));
  });

  it('still treats a repeat of the same path as the same image', () => {
    const bag = new ImageBag();
    const first = bag.add('art/cover.png', new Uint8Array([1]), 'image/png');
    expect(bag.add('art/cover.png', new Uint8Array([1]), 'image/png')).toBe(first);
    expect(bag.images).toHaveLength(1);
  });

  it('resolves a percent-encoded reference', () => {
    const bag = new ImageBag();
    const href = bag.add('art/my pic.png', new Uint8Array([1]), 'image/png');
    expect(bag.hrefFor('art/my%20pic.png')).toBe(href);
  });
});

describe('packed EPUB', () => {
  it('labels an image-only chapter instead of emitting an empty nav anchor', async () => {
    const packed = await packEpubFromMarkdown({
      title: 'My Book',
      targetLang: 'ru',
      markdown: '![cover](images/c.png)\n\n# Real\n\ntext\n',
      images: [{ href: 'images/c.png', bytes: TINY_PNG, mimeType: 'image/png' }],
      outName: 'o.epub',
    });
    const zip = await JSZip.loadAsync(packed.bytes);
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).not.toMatch(/<a[^>]*><\/a>/);
  });
});

describe('zipFirstEntry', () => {
  it('reports a short buffer as not a ZIP rather than throwing a RangeError', () => {
    expect(() => zipFirstEntry(new Uint8Array(10))).toThrow('Not a ZIP');
  });
});
