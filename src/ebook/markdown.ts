import { isAlreadyTargetLanguage, shouldSkipTranslatedElement } from './lang.ts';
import { localName } from './xml.ts';
import type { ImageBag } from './images.ts';

export type MdOpts = {
  /** Resolve a relative image/link href against the source document. */
  resolveHref?: (href: string) => string;
  images?: ImageBag;
  /** Drop blocks already in the target language (bilingual source books). */
  dropAlreadyTranslated?: { sourceLang: string; targetLang: string };
};

/** A markdown URL may hold balanced parentheses, as Wikipedia links routinely do. */
const URL_PART = String.raw`[^()\s]*(?:\([^()]*\)[^()]*)*`;

const BLOCK_NAMES = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'section',
  'article',
  'header',
  'main',
  'body',
  'table',
  'tr',
  'pre',
  'hr',
  'title',
  'subtitle',
  'epigraph',
  'poem',
  'stanza',
  'cite',
  'empty-line',
  // FB2 verse lines and attributions are laid out as blocks below, so a
  // container holding them must keep the block path.
  'v',
  'text-author',
  'figure',
]);

export function htmlToMarkdown(root: Element, opts?: MdOpts): string {
  const md = collapseBlankLines(childrenAsBlocks(root, opts)).trim() + (root.childNodes.length ? '\n' : '');
  // If every paragraph was already in the target language, keep the source
  // rather than producing an empty book (wrong language pair, or RU→RU).
  if (opts?.dropAlreadyTranslated && !md.trim()) {
    const { dropAlreadyTranslated: _dropped, ...rest } = opts;
    return htmlToMarkdown(root, rest);
  }
  return md;
}

function skipTranslated(el: Element, opts?: MdOpts): boolean {
  const drop = opts?.dropAlreadyTranslated;
  if (!drop) return false;
  if (shouldSkipTranslatedElement(el, drop.sourceLang, drop.targetLang)) return true;
  if (hasBlockChild(el)) return false;
  return isAlreadyTargetLanguage(el.textContent ?? '', drop.sourceLang, drop.targetLang);
}

function collapseBlankLines(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n');
}

function blockChildren(el: Element, opts?: MdOpts): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) out += nodeToBlock(child, opts);
  return out;
}

/**
 * A container's children as blocks — unless it holds no block child, in which
 * case the whole thing is one paragraph.
 *
 * Walking the children blindly turned `<div>He said <b>no</b>, loudly.</div>`
 * into three one-word paragraphs with the emphasis dropped, which is what every
 * book that lays out prose with `<div class="para">` instead of `<p>` gets.
 */
function childrenAsBlocks(el: Element, opts?: MdOpts): string {
  if (hasBlockChild(el)) return blockChildren(el, opts);
  const inline = inlineChildren(el, opts);
  return inline ? `${inline}\n\n` : '';
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.ELEMENT_NODE && BLOCK_NAMES.has(localName(n as Element)),
  );
}

/** A real XML DOM exposes `<![CDATA[…]]>` as its own node type; its text counts. */
function isTextLike(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE;
}

function nodeToBlock(node: Node, opts?: MdOpts): string {
  if (isTextLike(node)) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return t ? `${t}\n\n` : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (skipTranslated(el, opts)) return '';
  const name = localName(el);
  switch (name) {
    case 'h1':
      return `# ${inlineChildren(el, opts)}\n\n`;
    case 'h2':
      return `## ${inlineChildren(el, opts)}\n\n`;
    case 'h3':
      return `### ${inlineChildren(el, opts)}\n\n`;
    case 'h4':
      return `#### ${inlineChildren(el, opts)}\n\n`;
    case 'h5':
      return `##### ${inlineChildren(el, opts)}\n\n`;
    case 'h6':
      return `###### ${inlineChildren(el, opts)}\n\n`;
    case 'p':
      return `${inlineChildren(el, opts)}\n\n`;
    case 'blockquote':
    case 'epigraph':
    case 'cite':
      return toBlockquote(childrenAsBlocks(el, opts)) + '\n\n';
    case 'ul':
    case 'ol':
      return listToMd(el, opts, name === 'ol') + '\n';
    case 'li':
      return `- ${inlineChildren(el, opts)}\n`;
    case 'hr':
      return '---\n\n';
    case 'pre':
      return `\`\`\`\n${(el.textContent ?? '').replace(/\n$/, '')}\n\`\`\`\n\n`;
    case 'br':
      return '\n';
    case 'img':
    case 'image':
      return `${imageToMd(el, opts)}\n\n`;
    case 'div':
    case 'section':
    case 'article':
    case 'body':
    case 'header':
    case 'main':
    case 'figure':
    case 'poem':
    case 'stanza':
      return childrenAsBlocks(el, opts);
    case 'title':
      return `# ${inlineChildren(el, opts)}\n\n`;
    case 'subtitle':
      return `### ${inlineChildren(el, opts)}\n\n`;
    case 'empty-line':
      return '\n';
    case 'v':
      return `${inlineChildren(el, opts)}\n`;
    case 'text-author':
      return `*${inlineChildren(el, opts)}*\n\n`;
    case 'table':
      return `${tableToMd(el, opts)}\n\n`;
    default: {
      if (hasBlockChild(el)) return blockChildren(el, opts);
      const inline = inlineChildren(el, opts);
      return inline ? `${inline}\n\n` : '';
    }
  }
}

function toBlockquote(inner: string): string {
  const lines = inner.trim().split('\n');
  if (lines.length === 1 && !lines[0]) return '';
  return lines.map((l) => (l ? `> ${l}` : '>')).join('\n');
}

function listToMd(el: Element, opts: MdOpts | undefined, ordered: boolean): string {
  const lines: string[] = [];
  let n = 0;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    const name = localName(child);
    if (name === 'li') {
      n += 1;
      const prefix = ordered ? `${n}. ` : '- ';
      const body = hasBlockChild(child)
        ? blockChildren(child, opts).trim()
        : inlineChildren(child, opts);
      lines.push(`${prefix}${body.replace(/\n/g, '\n  ')}`);
      continue;
    }
    // A nested `<ul>`/`<ol>` as a direct child of a list is valid markup that
    // several converters emit; dropping it lost whole sub-lists from the book.
    if (name === 'ul' || name === 'ol') {
      const nested = listToMd(child, opts, name === 'ol').trimEnd();
      if (nested) lines.push(nested.replace(/^/gm, '  '));
      continue;
    }
    const stray = nodeToBlock(child, opts).trim();
    if (stray) lines.push(stray.replace(/\n/g, '\n  '));
  }
  return lines.join('\n') + '\n';
}

function tableToMd(el: Element, opts?: MdOpts): string {
  const rows = Array.from(el.getElementsByTagName('*')).filter(
    (n) => localName(n) === 'tr',
  );
  if (rows.length === 0) return inlineChildren(el, opts);
  const lines: string[] = [];
  rows.forEach((row, idx) => {
    const cells = Array.from(row.childNodes).filter(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE &&
        (localName(n as Element) === 'td' || localName(n as Element) === 'th'),
    ) as Element[];
    // A cell's own line break would otherwise split the row and leave the
    // delimiter line detached, so nothing renders as a table at all.
    const cols = cells.map((c) =>
      inlineChildren(c, opts).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim(),
    );
    lines.push(`| ${cols.join(' | ')} |`);
    if (idx === 0) lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  });
  return lines.join('\n');
}

function inlineChildren(el: Element, opts?: MdOpts): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) out += nodeToInline(child, opts);
  return out.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function nodeToInline(node: Node, opts?: MdOpts): string {
  if (isTextLike(node)) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (opts?.dropAlreadyTranslated && shouldSkipTranslatedElement(el, opts.dropAlreadyTranslated.sourceLang, opts.dropAlreadyTranslated.targetLang)) {
    return '';
  }
  const name = localName(el);
  if (name === 'em' || name === 'i' || name === 'emphasis') return `*${inlineChildren(el, opts)}*`;
  if (name === 'strong' || name === 'b') return `**${inlineChildren(el, opts)}**`;
  if (name === 'code') return `\`${inlineChildren(el, opts)}\``;
  if (name === 'br') return '  \n';
  if (name === 'a') {
    const href = resolveLink(
      el.getAttribute('href') ||
        el.getAttribute('l:href') ||
        el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        '',
      opts,
    );
    const text = inlineChildren(el, opts) || href;
    return href ? `[${text}](${href})` : text;
  }
  if (name === 'img' || name === 'image') return imageToMd(el, opts);
  return inlineChildren(el, opts);
}

function imageToMd(el: Element, opts?: MdOpts): string {
  const raw =
    el.getAttribute('src') ||
    el.getAttribute('l:href') ||
    el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
    el.getAttribute('href') ||
    '';
  const src = raw.replace(/^#/, '');
  const resolved = opts?.resolveHref ? opts.resolveHref(src) : src;
  const href = opts?.images?.hrefFor(resolved) ?? opts?.images?.hrefFor(src) ?? resolved;
  const alt = el.getAttribute('alt') || el.getAttribute('title') || '';
  return `![${alt}](${href})`;
}

function resolveLink(href: string, opts?: MdOpts): string {
  if (!href) return '';
  if (/^(https?:|mailto:|data:|#)/i.test(href)) return href;
  return opts?.resolveHref ? opts.resolveHref(href) : href;
}

export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>*+-]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const IMAGE_RE = new RegExp(String.raw`!\[([^\]]*)\]\((${URL_PART})\)`, 'g');
const LINK_RE = new RegExp(String.raw`(?<!!)\[([^\]]*)\]\((${URL_PART})\)`, 'g');

export function collectImageSrcs(md: string): string[] {
  const out: string[] = [];
  const re = new RegExp(IMAGE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const src = m[2]!.trim();
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

export function collectLinkHrefs(md: string): string[] {
  const out: string[] = [];
  const re = new RegExp(LINK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const href = m[2]!.trim();
    if (href && !out.includes(href)) out.push(href);
  }
  return out;
}

export function toEpubImageSrc(mdHref: string): string {
  if (/^(https?:|data:)/i.test(mdHref)) return mdHref;
  const base = mdHref.split('/').pop() || mdHref;
  return `images/${base}`;
}

/**
 * Drops every code point XML 1.0 forbids: C0 controls other than tab/LF/CR,
 * unpaired surrogate halves and the two non-characters. A truncated UTF-16 pair
 * is a routine artefact of streamed model output, and leaving one in makes the
 * whole chapter — and for strict readers the whole book — fail to parse.
 */
export function stripXmlIllegal(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code === 0x9 || code === 0xa || code === 0xd) {
      out += s[i];
      continue;
    }
    if (code < 0x20) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    out += s[i];
  }
  return out;
}

export function escapeXml(s: string): string {
  return stripXmlIllegal(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const INLINE_IMAGE_RE = new RegExp(String.raw`!\[([^\]]*)\]\((${URL_PART})\)`);
const INLINE_LINK_RE = new RegExp(String.raw`\[([^\]]*)\]\((${URL_PART})\)`);
const INLINE_CODE_RE = /`([^`]+)`/;

/**
 * A piece of an inline run: `html` is already-serialized markup that must be
 * copied verbatim, `text` is still markdown that needs escaping and emphasis.
 *
 * Splitting into segments rather than substituting string placeholders is what
 * keeps literal sentinel text in a book from being swallowed, keeps a link
 * inside a code span intact, and keeps the soft-break pass from writing `<br/>`
 * into an `href` it has no business touching.
 */
type Segment = { html: string } | { text: string };

function splitSegments(
  segments: Segment[],
  pattern: RegExp,
  toHtml: (m: RegExpExecArray) => string,
): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    if ('html' in segment) {
      out.push(segment);
      continue;
    }
    let rest = segment.text;
    for (;;) {
      const m = pattern.exec(rest);
      if (!m) break;
      if (m.index > 0) out.push({ text: rest.slice(0, m.index) });
      out.push({ html: toHtml(m) });
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) out.push({ text: rest });
  }
  return out;
}

function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Emphasis in one pass, so runs can nest but never interleave. Four independent
 * regex passes used to emit `<strong>a <em>b</strong> c</em>`, which is not
 * well-formed XML and costs the reader the whole chapter.
 */
function emphasize(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '*' || ch === '_') {
      const len = s[i + 1] === ch ? 2 : 1;
      const close = findCloser(s, i, len);
      if (close !== -1) {
        const tag = len === 2 ? 'strong' : 'em';
        out += `<${tag}>${emphasize(s.slice(i + len, close))}</${tag}>`;
        i = close + len;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function findCloser(s: string, open: number, len: number): number {
  const ch = s[open]!;
  const run = ch.repeat(len);
  // An opener is followed by content, and `_` never opens inside a word, so
  // `snake_case_name` and `2 * 3 * 4` stay literal text.
  if (/\s/.test(s[open + len] ?? '')) return -1;
  if (ch === '_' && isAlnum(s[open - 1])) return -1;
  for (let i = open + len; i < s.length; i += 1) {
    // Emphasis does not reach across a soft break.
    if (s[i] === '\n') return -1;
    if (!s.startsWith(run, i)) continue;
    if (i === open + len) continue;
    if (/\s/.test(s[i - 1] ?? '')) continue;
    if (s[i + len] === ch) continue;
    if (ch === '_' && isAlnum(s[i + len])) continue;
    return i;
  }
  return -1;
}

function textToXhtml(text: string): string {
  // Soft line breaks must stay visible in EPUB: a raw newline inside <p> is
  // just whitespace and readers collapse it. Dialogue and verse rely on this.
  return emphasize(escapeXml(text)).replace(/\n/g, '<br/>\n');
}

function inlineToXhtml(s: string): string {
  // Code spans are split out first: their body is literal, so a link or image
  // written inside one must survive as text rather than become markup.
  let segments: Segment[] = [{ text: s }];
  segments = splitSegments(segments, INLINE_CODE_RE, (m) => `<code>${escapeXml(m[1]!)}</code>`);
  segments = splitSegments(
    segments,
    INLINE_IMAGE_RE,
    (m) => `<img alt="${escapeXml(m[1]!)}" src="${escapeXml(toEpubImageSrc(m[2]!))}"/>`,
  );
  segments = splitSegments(
    segments,
    INLINE_LINK_RE,
    (m) => `<a href="${escapeXml(m[2]!)}">${textToXhtml(m[1]!)}</a>`,
  );
  return segments.map((seg) => ('html' in seg ? seg.html : textToXhtml(seg.text))).join('');
}

function isFence(line: string): boolean {
  return /^```/.test(line);
}

function isHeading(line: string): boolean {
  return /^#{1,6} /.test(line);
}

function isHr(line: string): boolean {
  const t = line.trim();
  return /^(-{3,}|\*{3,}|_{3,})$/.test(t);
}

function isDashLine(line: string): boolean {
  return /^\s*- /.test(line);
}

function isListItem(line: string): boolean {
  return /^(\s*[-*+] |\s*\d+\. )/.test(line);
}

function isQuote(line: string): boolean {
  return /^>/.test(line);
}

export function markdownToXhtmlFragment(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (isFence(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i]!)) {
        buf.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(`<pre><code>${escapeXml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) {
      const n = heading[1]!.length;
      out.push(`<h${n}>${inlineToXhtml(heading[2]!)}</h${n}>`);
      i += 1;
      continue;
    }
    if (isHr(line)) {
      out.push('<hr/>');
      i += 1;
      continue;
    }
    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && (isQuote(lines[i]!) || (lines[i]!.trim() === '' && i + 1 < lines.length && isQuote(lines[i + 1]!)))) {
        buf.push(lines[i]!.replace(/^> ?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${markdownToXhtmlFragment(buf.join('\n'))}</blockquote>`);
      continue;
    }
    // Literary dialogue is written as "- replica" lines. Treating those as
    // <ul><li> strips the dash and, in many EPUB readers, the line break.
    if (isDashLine(line)) {
      while (i < lines.length && isDashLine(lines[i]!)) {
        out.push(`<p>${inlineToXhtml(lines[i]!.trim())}</p>`);
        i += 1;
      }
      continue;
    }
    if (isListItem(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
      while (
        i < lines.length &&
        ((isListItem(lines[i]!) && !isDashLine(lines[i]!)) ||
          (/^\s+\S/.test(lines[i]!) && items.length > 0 && !isDashLine(lines[i]!)))
      ) {
        const item = lines[i]!.replace(/^(\s*[-*+] |\s*\d+\. )/, '');
        if (isListItem(lines[i]!)) items.push(item);
        else items[items.length - 1] = `${items[items.length - 1]}\n${lines[i]!.trim()}`;
        i += 1;
      }
      out.push(
        `<${tag}>\n${items.map((it) => `<li><p>${inlineToXhtml(it)}</p></li>`).join('\n')}\n</${tag}>`,
      );
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !isHeading(lines[i]!) &&
      !isFence(lines[i]!) &&
      !isHr(lines[i]!) &&
      !isListItem(lines[i]!) &&
      !isQuote(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i += 1;
    }
    out.push(`<p>${inlineToXhtml(buf.join('\n'))}</p>`);
  }
  return out.join('\n');
}

export function splitMarkdownIntoChapters(md: string): { title: string; body: string }[] {
  const trimmed = md.trim();
  if (!trimmed) return [{ title: '', body: '' }];
  // Split only on headings outside fenced code: a `# comment` inside a fence is
  // not a chapter, and cutting there left an unterminated fence behind.
  const lines = trimmed.split('\n');
  const parts: string[] = [];
  let buf: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (isFence(line)) fenced = !fenced;
    else if (!fenced && /^#{1,2} /.test(line) && buf.length > 0) {
      parts.push(buf.join('\n'));
      buf = [];
    }
    buf.push(line);
  }
  if (buf.length > 0) parts.push(buf.join('\n'));
  const kept = parts.filter((p) => p.trim());
  if (kept.length === 0) return [{ title: '', body: trimmed }];
  return kept.map((part) => {
    const first = part.split('\n')[0] ?? '';
    const heading = /^(#{1,2}) (.*)$/.exec(first);
    const title = heading?.[2]?.trim() ?? '';
    return { title, body: part.trim() };
  });
}

/**
 * Rejoins translated chunks. A chunk flagged `continuesBlock` was cut out of the
 * middle of an over-long paragraph, so it is rejoined with a space — gluing such
 * a seam with a blank line turned one paragraph into several, each broken
 * mid-sentence.
 */
export function joinMarkdown(parts: string[], continuesBlock?: readonly boolean[]): string {
  let out = '';
  parts.forEach((raw, i) => {
    const part = raw.replace(/\s+$/, '');
    if (!part) return;
    if (!out) {
      out = part;
      return;
    }
    out += continuesBlock?.[i] ? ` ${part.replace(/^\s+/, '')}` : `\n\n${part}`;
  });
  return out ? `${out}\n` : '\n';
}

/** Label for EPUB nav / `<title>` — the book's own heading, else a short snippet. Never "Chapter N". */
export function chapterNavTitle(ch: { title: string; body: string }): string {
  if (ch.title.trim()) return ch.title.trim();
  const snippet = markdownToPlainText(ch.body).replace(/\s+/g, ' ').trim();
  if (!snippet) return '';
  // Slice by code point: cutting mid-surrogate put an unpaired half into
  // nav.xhtml and the chapter <title>, which is not valid UTF-8 once zipped.
  const points = Array.from(snippet);
  if (points.length <= 48) return snippet;
  return `${points.slice(0, 48).join('').trim()}…`;
}

function reverseChars(s: string): string {
  return Array.from(s).reverse().join('');
}

function reverseInline(s: string): string {
  return s.replace(
    /(!?\[)([^\]]*)(\]\([^)]+\))|(`[^`]+`)|([^[\]#!*_`]+)|([[\]#!*_`]+)/g,
    (_all, open?: string, inner?: string, close?: string, code?: string, text?: string, punct?: string) => {
      if (open && inner != null && close) return `${open}${reverseChars(inner)}${close}`;
      if (code) return code;
      if (punct) return punct;
      return reverseChars(text ?? '');
    },
  );
}

/** Reverses readable text but keeps markdown syntax, URLs, and image paths. */
export function reverseMarkdownText(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6} )(.*)$/.exec(line);
      if (heading) return heading[1] + reverseInline(heading[2]!);
      if (/^```/.test(line)) return line;
      return reverseInline(line);
    })
    .join('\n');
}
