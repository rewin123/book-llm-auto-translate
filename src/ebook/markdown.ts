import { localName } from './xml.ts';
import type { ImageBag } from './images.ts';

export type MdOpts = {
  /** Resolve a relative image/link href against the source document. */
  resolveHref?: (href: string) => string;
  images?: ImageBag;
};

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
]);

export function htmlToMarkdown(root: Element, opts?: MdOpts): string {
  return collapseBlankLines(blockChildren(root, opts)).trim() + (root.childNodes.length ? '\n' : '');
}

function collapseBlankLines(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n');
}

function blockChildren(el: Element, opts?: MdOpts): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) out += nodeToBlock(child, opts);
  return out;
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.ELEMENT_NODE && BLOCK_NAMES.has(localName(n as Element)),
  );
}

function nodeToBlock(node: Node, opts?: MdOpts): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return t ? `${t}\n\n` : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
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
      return toBlockquote(blockChildren(el, opts)) + '\n\n';
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
      return blockChildren(el, opts);
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
  const items = Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE && localName(n as Element) === 'li',
  ) as Element[];
  return items
    .map((item, i) => {
      const prefix = ordered ? `${i + 1}. ` : '- ';
      if (hasBlockChild(item)) {
        const inner = blockChildren(item, opts).trim().replace(/\n/g, '\n  ');
        return `${prefix}${inner}`;
      }
      return `${prefix}${inlineChildren(item, opts)}`;
    })
    .join('\n') + '\n';
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
    const cols = cells.map((c) => inlineChildren(c, opts).replace(/\|/g, '\\|'));
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
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
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

const IMAGE_RE = /!\[([^\]]*)]\(([^)]+)\)/g;
const LINK_RE = /(?<!!)\[([^\]]*)]\(([^)]+)\)/g;

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

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineToXhtml(s: string): string {
  const slots: string[] = [];
  const stash = (html: string) => {
    const i = slots.length;
    slots.push(html);
    return `%%BT${i}%%`;
  };
  let t = s;
  t = t.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_all, alt, src) =>
    stash(`<img alt="${escapeXml(alt)}" src="${escapeXml(toEpubImageSrc(src))}"/>`),
  );
  t = t.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_all, text, href) =>
    stash(`<a href="${escapeXml(href)}">${escapeXml(text)}</a>`),
  );
  t = t.replace(/`([^`]+)`/g, (_all, code) => stash(`<code>${escapeXml(code)}</code>`));
  t = escapeXml(t);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');
  t = t.replace(/_(.+?)_/g, '<em>$1</em>');
  t = t.replace(/%%BT(\d+)%%/g, (_all, i) => slots[Number(i)]!);
  t = t.replace(/  \n/g, '<br/>\n');
  return t;
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
    if (isListItem(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
      while (i < lines.length && (isListItem(lines[i]!) || (/^\s+\S/.test(lines[i]!) && items.length > 0))) {
        const item = lines[i]!.replace(/^(\s*[-*+] |\s*\d+\. )/, '');
        if (isListItem(lines[i]!)) items.push(item);
        else items[items.length - 1] = `${items[items.length - 1]}\n${lines[i]!.trim()}`;
        i += 1;
      }
      out.push(`<${tag}>${items.map((it) => `<li>${inlineToXhtml(it)}</li>`).join('')}</${tag}>`);
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
  if (!trimmed) return [{ title: 'Chapter 1', body: '' }];
  const parts = trimmed.split(/(?=^#{1,2} )/m).filter((p) => p.trim());
  if (parts.length === 0) return [{ title: 'Chapter 1', body: trimmed }];
  return parts.map((part, i) => {
    const first = part.split('\n')[0] ?? '';
    const heading = /^(#{1,2}) (.*)$/.exec(first);
    const title = heading?.[2]?.trim() || `Chapter ${i + 1}`;
    return { title, body: part.trim() };
  });
}

export function joinMarkdown(parts: string[]): string {
  return `${parts.map((p) => p.replace(/\s+$/, '')).filter((p) => p.length > 0).join('\n\n')}\n`;
}

export function ensureHeading(md: string, title: string): string {
  const trimmed = md.trim();
  if (!title.trim()) return trimmed ? `${trimmed}\n` : '';
  if (/^# /m.test(trimmed)) return `${trimmed}\n`;
  return `# ${title}\n\n${trimmed}\n`;
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
