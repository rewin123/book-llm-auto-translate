import JSZip from 'jszip';
import { indexChunks } from './chunk.ts';
import { findAll, findEl, innerXml, parseXml, textContent } from './xml.ts';
import type { Chunk, PackedBook, ParsedBook } from './types.ts';

const MIME = 'application/epub+zip';

function zipPath(root: string, href: string): string {
  const dir = root.split('/').slice(0, -1).join('/');
  const joined = dir ? `${dir}/${href}` : href;
  return joined.replace(/\\/g, '/').split('/').reduce<string[]>((acc, part) => {
    if (part === '..') acc.pop();
    else if (part && part !== '.') acc.push(part);
    return acc;
  }, []).join('/');
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing EPUB entry: ${path}`);
  return file.async('string');
}

function opfAttr(el: Element, name: string): string {
  return (
    el.getAttribute(name) ||
    el.getAttribute(name.toLowerCase()) ||
    el.getAttributeNS('http://www.idpf.org/2007/opf', name) ||
    ''
  );
}

export async function parseEpub(
  bytes: Uint8Array,
  fileName: string,
  maxChunkChars: number,
): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(bytes);
  const containerXml = await readText(zip, 'META-INF/container.xml');
  const container = parseXml(containerXml);
  const rootfile = findEl(container, 'rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB container has no OPF path');

  const opfXml = await readText(zip, opfPath);
  const opf = parseXml(opfXml);
  const manifest = new Map<string, { href: string; media: string }>();
  for (const item of findAll(opf, 'item')) {
    const id = opfAttr(item, 'id');
    const href = opfAttr(item, 'href');
    if (id && href) {
      manifest.set(id, { href, media: opfAttr(item, 'media-type') });
    }
  }

  const title = textContent(findEl(opf, 'title')) || fileName.replace(/\.[^.]+$/, '');
  const pieces: { documentPath: string; chapterTitle: string; xml: string }[] = [];

  const itemrefs = findAll(opf, 'itemref');
  let chapterN = 0;
  for (const ref of itemrefs) {
    const idref = opfAttr(ref, 'idref');
    const item = manifest.get(idref);
    if (!item) continue;
    if (!/html|xml|xhtml/i.test(item.media) && !item.href.match(/\.x?html?$/i)) continue;
    const path = zipPath(opfPath, item.href);
    const xhtml = await readText(zip, path);
    let inner = '';
    let headingText = '';
    try {
      const doc = parseXml(xhtml);
      const body = findEl(doc, 'body') ?? doc.documentElement;
      inner = innerXml(body);
      const heading = findEl(body, 'h1') || findEl(body, 'h2') || findEl(body, 'title');
      headingText = textContent(heading);
    } catch {
      const doc = new DOMParser().parseFromString(xhtml, 'text/html');
      const body = doc.body;
      inner = body?.innerHTML ?? xhtml;
      headingText = body?.querySelector('h1,h2,title')?.textContent?.trim() ?? '';
    }
    chapterN += 1;
    pieces.push({
      documentPath: path,
      chapterTitle: headingText || `Chapter ${chapterN}`,
      xml: inner,
    });
  }

  const chunks = indexChunks(pieces, maxChunkChars);
  return { format: 'epub', fileName, chunks, sourceBytes: bytes, title };
}

function replaceBodyInner(xhtml: string, inner: string): string {
  const doc = parseXml(xhtml);
  const body = findEl(doc, 'body');
  if (!body) return xhtml;
  while (body.firstChild) body.removeChild(body.firstChild);
  const wrapped = parseXml(
    `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>`,
  );
  const div = wrapped.documentElement;
  const kids = Array.from(div.childNodes);
  for (const kid of kids) {
    body.appendChild(doc.importNode(kid, true));
  }
  const html = doc.documentElement;
  const serialized = new XMLSerializer().serializeToString(html);
  if (xhtml.trimStart().startsWith('<?xml')) {
    const decl = xhtml.match(/^<\?xml[^?]*\?>\s*/);
    const doctype = xhtml.match(/<!DOCTYPE[^>]*>\s*/i);
    return `${decl?.[0] ?? '<?xml version="1.0" encoding="UTF-8"?>\n'}${doctype?.[0] ?? ''}${serialized}`;
  }
  return serialized;
}

function setDcLanguage(opfXml: string, lang: string): string {
  const doc = parseXml(opfXml);
  const language = findEl(doc, 'language');
  if (language) language.textContent = lang;
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export async function packEpub(options: {
  sourceBytes: Uint8Array;
  chunks: Chunk[];
  translations: string[];
  targetLang: string;
  outName: string;
}): Promise<PackedBook> {
  const src = await JSZip.loadAsync(options.sourceBytes);
  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  const entries = Object.values(src.files);
  for (const entry of entries) {
    if (entry.dir || entry.name === 'mimetype') continue;
    out.file(entry.name, await entry.async('uint8array'), {
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  const byDoc = new Map<string, string[]>();
  options.chunks.forEach((chunk, i) => {
    const xml = options.translations[i] ?? chunk.xml;
    const list = byDoc.get(chunk.documentPath) ?? [];
    list.push(xml);
    byDoc.set(chunk.documentPath, list);
  });

  for (const [path, parts] of byDoc) {
    const original = await src.file(path)!.async('string');
    out.file(path, replaceBodyInner(original, parts.join('')));
  }

  const containerXml = await src.file('META-INF/container.xml')!.async('string');
  const container = parseXml(containerXml);
  const opfPath = findEl(container, 'rootfile')?.getAttribute('full-path');
  if (opfPath && src.file(opfPath)) {
    const opfXml = await src.file(opfPath)!.async('string');
    out.file(opfPath, setDcLanguage(opfXml, options.targetLang));
  }

  const bytes = await out.generateAsync({
    type: 'uint8array',
    mimeType: MIME,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { bytes, mimeType: MIME, fileName: options.outName };
}

export function zipFirstEntry(bytes: Uint8Array): { name: string; method: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('Not a ZIP');
  }
  const method = view.getUint16(8, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const nameBytes = bytes.subarray(30, 30 + nameLen);
  const name = new TextDecoder().decode(nameBytes);
  void extraLen;
  return { name, method };
}

export function isBinaryEpubPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ttf|otf|woff2?|mp3|mp4|css|js)$/i.test(path);
}

export async function readZipEntry(
  bytes: Uint8Array,
  path: string,
): Promise<Uint8Array | undefined> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(path);
  return file?.async('uint8array');
}

export function collectEpubItems(xmlOpf: string): { id: string; href: string }[] {
  const opf = parseXml(xmlOpf);
  return findAll(opf, 'item').map((item) => ({
    id: item.getAttribute('id') || '',
    href: item.getAttribute('href') || '',
  }));
}

