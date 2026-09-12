import JSZip from 'jszip';
import { indexChunks } from './chunk.ts';
import { decodeXmlBytes } from './encoding.ts';
import { ImageBag, isImagePath, mimeFromPath } from './images.ts';
import {
  chapterNavTitle,
  escapeXml,
  htmlToMarkdown,
  markdownToXhtmlFragment,
  splitMarkdownIntoChapters,
} from './markdown.ts';
import { findAll, findEl, parseXml, textContent } from './xml.ts';
import type { BookImage, PackedBook, ParsedBook, TranslateLangs } from './types.ts';

const MIME = 'application/epub+zip';
const CSS = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; margin: 1.25em; }
h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, pre { display: block; }
h1, h2, h3 { font-weight: 700; line-height: 1.25; }
p { margin: 0.6em 0; }
img { max-width: 100%; height: auto; }
blockquote { margin-left: 1em; padding-left: 0.8em; border-left: 2px solid #ccc; }
ul, ol { margin: 0.6em 0; padding-left: 1.4em; }
li { display: list-item; margin: 0.2em 0; }
li p { margin: 0.15em 0; }
`;

/**
 * EPUB hrefs are URLs; ZIP entry names are not. Without decoding, a book whose
 * file names hold a space or any non-ASCII character looks for
 * `OEBPS/Chapter%201.xhtml`, finds nothing, and is reported to the user as
 * corrupt. A malformed escape is left as-is rather than thrown away.
 */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

export function zipPath(root: string, href: string): string {
  const dir = root.split('/').slice(0, -1).join('/');
  const decoded = decodeHref(href);
  const joined = dir ? `${dir}/${decoded}` : decoded;
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

/**
 * Reads an XML entry honouring its own encoding declaration. JSZip's `string`
 * mode is UTF-8 only, so a spec-valid UTF-16 content document decoded to
 * NUL-interleaved garbage, fell through to the lenient HTML parser, and was
 * translated as mojibake without surfacing any error.
 */
async function readXmlText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing EPUB entry: ${path}`);
  return decodeXmlBytes(await file.async('uint8array'));
}

/**
 * Removes script and style *bodies*. Dropping only the start tag left the
 * JavaScript and CSS source in the text, so it was billed, translated and
 * printed as paragraphs in the output book — and the orphaned `</script>` broke
 * XML parsing for the whole document.
 */
function stripNonProse(xhtml: string): string {
  return xhtml
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(?:link|script|style)\b[^>]*\/?>/gi, '');
}

function opfAttr(el: Element, name: string): string {
  return (
    el.getAttribute(name) ||
    el.getAttribute(name.toLowerCase()) ||
    el.getAttributeNS('http://www.idpf.org/2007/opf', name) ||
    ''
  );
}

export async function extractEpubImages(bytes: Uint8Array): Promise<BookImage[]> {
  const zip = await JSZip.loadAsync(bytes);
  return (await loadEpubImages(zip)).images;
}

async function loadEpubImages(zip: JSZip): Promise<ImageBag> {
  const bag = new ImageBag();
  const names = Object.keys(zip.files).sort();
  for (const name of names) {
    const entry = zip.files[name];
    if (!entry || entry.dir || !isImagePath(name)) continue;
    const bytes = await entry.async('uint8array');
    bag.add(name, bytes, mimeFromPath(name));
  }
  return bag;
}

export async function parseEpub(
  bytes: Uint8Array,
  fileName: string,
  maxChunkChars: number,
  langs?: TranslateLangs,
): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(bytes);
  const containerXml = await readText(zip, 'META-INF/container.xml');
  const container = parseXml(containerXml);
  const rootfile = findEl(container, 'rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB container has no OPF path');

  const opfXml = await readText(zip, opfPath);
  const opf = parseXml(opfXml);
  const manifest = new Map<string, { href: string; media: string; properties: string }>();
  for (const item of findAll(opf, 'item')) {
    const id = opfAttr(item, 'id');
    const href = opfAttr(item, 'href');
    if (id && href) {
      manifest.set(id, {
        href,
        media: opfAttr(item, 'media-type'),
        properties: opfAttr(item, 'properties'),
      });
    }
  }

  const title = textContent(findEl(opf, 'title')) || fileName.replace(/\.[^.]+$/, '');
  const images = await loadEpubImages(zip);
  const pieces: { documentPath: string; chapterTitle: string; markdown: string }[] = [];

  const itemrefs = findAll(opf, 'itemref');
  for (const ref of itemrefs) {
    const idref = opfAttr(ref, 'idref');
    const item = manifest.get(idref);
    if (!item) continue;
    if (opfAttr(ref, 'linear') === 'no') continue;
    if (/\bnav\b/i.test(item.properties)) continue;
    if (!/html|xml|xhtml/i.test(item.media) && !item.href.match(/\.x?html?$/i)) continue;
    const path = zipPath(opfPath, item.href);
    const xhtml = await readXmlText(zip, path);
    const forParse = stripNonProse(xhtml);
    let body: Element | undefined;
    let headingText = '';
    try {
      const doc = parseXml(forParse);
      body = findEl(doc, 'body') ?? doc.documentElement;
      const heading = findEl(body, 'h1') || findEl(body, 'h2') || findEl(body, 'title');
      headingText = textContent(heading);
    } catch {
      const doc = new DOMParser().parseFromString(forParse, 'text/html');
      body = doc.body ?? undefined;
      headingText = body?.querySelector('h1,h2,title')?.textContent?.trim() ?? '';
    }
    if (!body) continue;
    const mdOpts = {
      images,
      resolveHref: (href: string) => zipPath(path, href),
      dropAlreadyTranslated: langs,
    };
    const markdown = htmlToMarkdown(body, mdOpts);
    if (!markdown.trim()) continue;
    pieces.push({ documentPath: path, chapterTitle: headingText, markdown });
  }

  const chunks = indexChunks(pieces, maxChunkChars);
  return { format: 'epub', fileName, chunks, sourceBytes: bytes, title, images: images.images };
}

function slug(s: string): string {
  const ascii = s
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 48);
  return ascii || 'book';
}

function chapterFileName(i: number): string {
  return `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
}

function wrapChapterXhtml(opts: { title: string; lang: string; bodyMd: string }): string {
  const inner = markdownToXhtmlFragment(opts.bodyMd) || '<p></p>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(opts.lang)}" lang="${escapeXml(opts.lang)}">
<head>
  <title>${escapeXml(opts.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
${inner}
</body>
</html>
`;
}

function navXhtml(opts: { title: string; lang: string; chapters: { title: string; href: string }[] }): string {
  const items = opts.chapters
    .map((c) => `      <li><a href="${escapeXml(c.href)}">${escapeXml(c.title)}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(opts.lang)}" lang="${escapeXml(opts.lang)}">
<head>
  <title>${escapeXml(opts.title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(opts.title)}</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`;
}

function contentOpf(opts: {
  title: string;
  lang: string;
  id: string;
  chapters: { id: string; href: string }[];
  images: BookImage[];
}): string {
  const manifestChapters = opts.chapters
    .map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const manifestImages = opts.images
    .map((img, i) => {
      const href = img.href.startsWith('images/') ? img.href : `images/${img.href.split('/').pop()}`;
      return `    <item id="img${i + 1}" href="${escapeXml(href)}" media-type="${escapeXml(img.mimeType)}"/>`;
    })
    .join('\n');
  const spine = opts.chapters.map((c) => `    <itemref idref="${c.id}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(opts.title)}</dc:title>
    <dc:language>${escapeXml(opts.lang)}</dc:language>
    <dc:identifier id="bookid">${escapeXml(opts.id)}</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles.css" media-type="text/css"/>
${manifestChapters}
${manifestImages}
  </manifest>
  <spine>
    <itemref idref="nav" linear="no"/>
${spine}
  </spine>
</package>
`;
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export async function packEpubFromMarkdown(options: {
  title: string;
  targetLang: string;
  markdown: string;
  images: BookImage[];
  outName: string;
}): Promise<PackedBook> {
  const chapters = splitMarkdownIntoChapters(options.markdown);
  const usedImages = usedImagesFor(options.markdown, options.images);

  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  out.file('META-INF/container.xml', CONTAINER);
  out.file('OEBPS/styles.css', CSS);

  // A chapter holding only an image has no text to label it with, and an empty
  // `<a/>` in the nav renders as a blank TOC row and fails epubcheck. The book's
  // own title is a truthful fallback; "Chapter N" would not be.
  const fallbackTitle = options.title.trim() || 'Untitled';
  const spine = chapters.map((ch, i) => ({
    id: `ch${i + 1}`,
    href: chapterFileName(i),
    title: chapterNavTitle(ch) || fallbackTitle,
    body: ch.body,
  }));

  for (const ch of spine) {
    out.file(
      `OEBPS/${ch.href}`,
      wrapChapterXhtml({ title: ch.title, lang: options.targetLang, bodyMd: ch.body }),
    );
  }

  out.file(
    'OEBPS/nav.xhtml',
    navXhtml({
      title: options.title,
      lang: options.targetLang,
      chapters: spine.map((c) => ({ title: c.title, href: c.href })),
    }),
  );

  for (const img of usedImages) {
    const href = img.href.startsWith('images/') ? img.href : `images/${img.href.split('/').pop()}`;
    out.file(`OEBPS/${href}`, img.bytes, { binary: true });
  }

  out.file(
    'OEBPS/content.opf',
    contentOpf({
      title: options.title,
      lang: options.targetLang,
      id: `urn:booktrans:${slug(options.title)}-${options.targetLang}`,
      chapters: spine.map((c) => ({ id: c.id, href: c.href })),
      images: usedImages,
    }),
  );

  const bytes = await out.generateAsync({
    type: 'uint8array',
    mimeType: MIME,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { bytes, mimeType: MIME, fileName: options.outName };
}

function usedImagesFor(markdown: string, images: BookImage[]): BookImage[] {
  if (images.length === 0) return [];
  const needed = new Set<string>();
  const re = /!\[[^\]]*]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) needed.add(m[1]!.trim());
  const matched = images.filter(
    (img) =>
      needed.has(img.href) ||
      needed.has(img.href.split('/').pop() ?? '') ||
      [...needed].some((src) => src.split('/').pop() === img.href.split('/').pop()),
  );
  return matched.length > 0 ? matched : images;
}

/** Size of a ZIP local file header, before the entry name. */
const ZIP_LOCAL_HEADER_SIZE = 30;

export function zipFirstEntry(bytes: Uint8Array): { name: string; method: number } {
  // Reading fixed offsets out of a short buffer threw `RangeError` instead of
  // the intended validation error, so callers saw an unexpected failure mode.
  if (bytes.byteLength < ZIP_LOCAL_HEADER_SIZE) {
    throw new Error('Not a ZIP');
  }
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

export async function readZipEntry(
  bytes: Uint8Array,
  path: string,
): Promise<Uint8Array | undefined> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(path);
  return file?.async('uint8array');
}
