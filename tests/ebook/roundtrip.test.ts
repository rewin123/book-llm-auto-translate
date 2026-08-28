import { describe, expect, it } from 'vitest';
import {
  buildDemoEpub,
  buildDemoFb2,
  TINY_FONT,
  TINY_PNG,
} from '../../src/ebook/demoBook.ts';
import { parseEpub, packEpub, readZipEntry, zipFirstEntry } from '../../src/ebook/epub.ts';
import { parseFb2, packFb2 } from '../../src/ebook/fb2.ts';

describe('EPUB golden round-trip', () => {
  it('keeps mimetype first+STORE, spine, and binary assets byte-identical', async () => {
    const src = await buildDemoEpub();
    const parsed = await parseEpub(src, 'alice.epub', 2500);
    expect(parsed.chunks.length).toBeGreaterThan(0);

    const packed = await packEpub({
      sourceBytes: src,
      chunks: parsed.chunks,
      translations: parsed.chunks.map((c) => c.xml),
      targetLang: 'en',
      outName: 'alice.en.epub',
    });

    const first = zipFirstEntry(packed.bytes);
    expect(first.name).toBe('mimetype');
    expect(first.method).toBe(0);

    const png = await readZipEntry(packed.bytes, 'OEBPS/images/cover.png');
    const font = await readZipEntry(packed.bytes, 'OEBPS/fonts/dummy.ttf');
    const css = await readZipEntry(packed.bytes, 'OEBPS/styles.css');
    expect(png).toEqual(TINY_PNG);
    expect(font).toEqual(TINY_FONT);
    expect(new TextDecoder().decode(css)).toContain('font-family');

    const opf = await readZipEntry(packed.bytes, 'OEBPS/content.opf');
    const opfText = new TextDecoder().decode(opf);
    expect(opfText).toContain('idref="ch1"');
    expect(opfText).toContain('idref="ch2"');
    expect(opfText).toContain('href="images/cover.png"');
  });
});

describe('FB2 round-trip', () => {
  it('copies binary covers unchanged', () => {
    const xml = buildDemoFb2();
    const bytes = new TextEncoder().encode(xml);
    const parsed = parseFb2(bytes, 'alice.fb2', 2500);
    const packed = packFb2({
      sourceBytes: bytes,
      chunks: parsed.chunks,
      translations: parsed.chunks.map((c) => c.xml),
      targetLang: 'en',
      outName: 'alice.en.fb2',
    });
    const out = new TextDecoder().decode(packed.bytes);
    expect(out).toContain('encoding="UTF-8"');
    expect(out).toContain('id="cover.png"');
    const origBin = xml.match(/<binary[^>]*>([^<]+)<\/binary>/)?.[1];
    const outBin = out.match(/<binary[^>]*>([^<]+)<\/binary>/)?.[1];
    expect(outBin).toBe(origBin);
  });
});
