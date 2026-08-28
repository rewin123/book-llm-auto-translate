import { indexChunks } from './chunk.ts';
import { ImageBag, mimeFromPath } from './images.ts';
import { htmlToMarkdown } from './markdown.ts';
import { decodeXmlBytes } from './encoding.ts';
import { findAll, findEl, localName, parseXml, textContent } from './xml.ts';
import type { BookImage, ParsedBook, TranslateLangs } from './types.ts';

function sectionTitle(section: Element, fallback: string): string {
  const title = Array.from(section.childNodes).find(
    (n) => n.nodeType === Node.ELEMENT_NODE && localName(n as Element) === 'title',
  ) as Element | undefined;
  return textContent(title) || fallback;
}

function loadFb2Images(doc: Document): ImageBag {
  const bag = new ImageBag();
  for (const bin of findAll(doc, 'binary')) {
    const id = bin.getAttribute('id') || '';
    if (!id) continue;
    const type = bin.getAttribute('content-type') || mimeFromPath(id, 'image/jpeg');
    const b64 = (bin.textContent || '').replace(/\s+/g, '');
    if (!b64) continue;
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      bag.add(id, bytes, type);
    } catch {
      // skip a corrupt binary rather than failing the whole book
    }
  }
  return bag;
}

export function extractFb2Images(bytes: Uint8Array): BookImage[] {
  const xml = decodeXmlBytes(bytes);
  const doc = parseXml(xml);
  return loadFb2Images(doc).images;
}

export function parseFb2Xml(
  xml: string,
  fileName: string,
  maxChunkChars: number,
  sourceBytes: Uint8Array,
  langs?: TranslateLangs,
): ParsedBook {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const bookTitle =
    textContent(findEl(findEl(root, 'description') ?? root, 'book-title')) ||
    fileName.replace(/\.[^.]+$/, '');
  const images = loadFb2Images(doc);

  const pieces: { documentPath: string; chapterTitle: string; markdown: string }[] = [];
  const bodies = findAll(root, 'body');
  let n = 0;
  for (const body of bodies) {
    const name = body.getAttribute('name') || '';
    if (name === 'notes' || name === 'comments') continue;
    const sections = Array.from(body.childNodes).filter(
      (c) => c.nodeType === Node.ELEMENT_NODE && localName(c as Element) === 'section',
    ) as Element[];
    if (sections.length === 0) {
      n += 1;
      pieces.push({
        documentPath: `body:${name || n}`,
        chapterTitle: bookTitle,
        markdown: htmlToMarkdown(body, { images, dropAlreadyTranslated: langs }),
      });
      continue;
    }
    sections.forEach((section, idx) => {
      n += 1;
      const path = `section:${name || 'main'}:${idx}`;
      pieces.push({
        documentPath: path,
        chapterTitle: sectionTitle(section, ''),
        markdown: htmlToMarkdown(section, { images, dropAlreadyTranslated: langs }),
      });
    });
  }

  return {
    format: 'fb2',
    fileName,
    chunks: indexChunks(pieces, maxChunkChars),
    sourceBytes,
    title: bookTitle,
    images: images.images,
  };
}

export function parseFb2(
  bytes: Uint8Array,
  fileName: string,
  maxChunkChars: number,
  langs?: TranslateLangs,
): ParsedBook {
  const xml = decodeXmlBytes(bytes);
  return parseFb2Xml(xml, fileName, maxChunkChars, bytes, langs);
}
