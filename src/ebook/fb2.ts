import { indexChunks } from './chunk.ts';
import { decodeXmlBytes, toUtf8Xml } from './encoding.ts';
import { findAll, findEl, innerXml, localName, parseXml, textContent } from './xml.ts';
import type { Chunk, PackedBook, ParsedBook } from './types.ts';

function sectionTitle(section: Element, fallback: string): string {
  const title = Array.from(section.childNodes).find(
    (n) => n.nodeType === Node.ELEMENT_NODE && localName(n as Element) === 'title',
  ) as Element | undefined;
  return textContent(title) || fallback;
}

export function parseFb2Xml(xml: string, fileName: string, maxChunkChars: number, sourceBytes: Uint8Array): ParsedBook {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const bookTitle =
    textContent(findEl(findEl(root, 'description') ?? root, 'book-title')) ||
    fileName.replace(/\.[^.]+$/, '');

  const pieces: { documentPath: string; chapterTitle: string; xml: string }[] = [];
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
        xml: innerXml(body),
      });
      continue;
    }
    sections.forEach((section, idx) => {
      n += 1;
      const path = `section:${name || 'main'}:${idx}`;
      pieces.push({
        documentPath: path,
        chapterTitle: sectionTitle(section, `${bookTitle} ${n}`),
        xml: innerXml(section),
      });
    });
  }

  return {
    format: 'fb2',
    fileName,
    chunks: indexChunks(pieces, maxChunkChars),
    sourceBytes,
    title: bookTitle,
  };
}

export function parseFb2(
  bytes: Uint8Array,
  fileName: string,
  maxChunkChars: number,
): ParsedBook {
  const xml = decodeXmlBytes(bytes);
  return parseFb2Xml(xml, fileName, maxChunkChars, bytes);
}

export function packFb2(options: {
  sourceBytes: Uint8Array;
  chunks: Chunk[];
  translations: string[];
  targetLang: string;
  outName: string;
}): PackedBook {
  const xml = toUtf8Xml(decodeXmlBytes(options.sourceBytes));
  const doc = parseXml(xml);
  const root = doc.documentElement;

  const lang = findEl(root, 'lang');
  if (lang) lang.textContent = options.targetLang;

  const byDoc = new Map<string, string[]>();
  options.chunks.forEach((chunk, i) => {
    const part = options.translations[i] ?? chunk.xml;
    const list = byDoc.get(chunk.documentPath) ?? [];
    list.push(part);
    byDoc.set(chunk.documentPath, list);
  });

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
      const key = `body:${name || n}`;
      const inner = byDoc.get(key)?.join('');
      if (inner !== undefined) replaceChildrenFromXml(doc, body, inner);
      continue;
    }
    sections.forEach((section, idx) => {
      n += 1;
      const key = `section:${name || 'main'}:${idx}`;
      const inner = byDoc.get(key)?.join('');
      if (inner !== undefined) replaceChildrenFromXml(doc, section, inner);
    });
  }

  const out = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`;
  return {
    bytes: new TextEncoder().encode(out),
    mimeType: 'application/x-fictionbook+xml',
    fileName: options.outName,
  };
}

function replaceChildrenFromXml(doc: Document, el: Element, inner: string) {
  while (el.firstChild) el.removeChild(el.firstChild);
  const wrapped = parseXml(
    `<fb xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">${inner}</fb>`,
  );
  const root = wrapped.documentElement;
  const kids = Array.from(root.childNodes);
  for (const kid of kids) {
    el.appendChild(doc.importNode(kid, true));
  }
}
