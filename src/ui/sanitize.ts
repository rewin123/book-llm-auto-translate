import { markdownToXhtmlFragment } from '../ebook/markdown.ts';

const ALLOWED = new Set([
  'p',
  'div',
  'span',
  'em',
  'i',
  'b',
  'strong',
  'br',
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
  'a',
  'img',
  'section',
  'title',
  'subtitle',
  'emphasis',
  'empty-line',
  'cite',
  'poem',
  'stanza',
  'v',
  'text-author',
]);

/** Schemes a preview link may use. Everything else is dropped. */
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Validates a URL by allowlisted scheme, after removing the characters a
 * browser's URL parser itself ignores.
 *
 * A denylist over the raw string was bypassable: `trim()` leaves C0 controls in
 * place and the pattern is anchored, so `java\tscript:alert(1)` and
 * `\x01javascript:alert(1)` both survived — and the browser strips exactly those
 * bytes before deciding the scheme, so both executed. Since this app keeps
 * provider API keys in localStorage, script on its origin means key theft.
 */
function safeHref(value: string): string | null {
  // Drop what a browser's URL parser itself ignores: C0 controls, space and DEL.
  // Validate and return that same string, so what was checked is exactly what
  // reaches the DOM.
  // oxlint-disable-next-line no-control-regex -- matching these is the fix
  const normalized = value.replace(/[\u0000-\u0020\u007F]/g, '');
  if (!normalized) return null;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(normalized);
  // No scheme means a fragment or a relative reference, which carries nothing to
  // abuse; a protocol-relative `//host` would inherit the page's scheme.
  if (!scheme) return normalized.startsWith('//') ? null : normalized;
  return ALLOWED_SCHEMES.has(scheme[1]!.toLowerCase()) ? normalized : null;
}

function copySafe(src: Node, dstDoc: Document): Node | null {
  if (src.nodeType === Node.TEXT_NODE) {
    return dstDoc.createTextNode(src.textContent ?? '');
  }
  if (src.nodeType !== Node.ELEMENT_NODE) return null;
  const el = src as Element;
  const name = (el.localName || el.tagName).toLowerCase();
  if (!ALLOWED.has(name)) {
    const frag = dstDoc.createDocumentFragment();
    for (const child of Array.from(src.childNodes)) {
      const copied = copySafe(child, dstDoc);
      if (copied) frag.appendChild(copied);
    }
    return frag;
  }
  if (name === 'empty-line') {
    const gap = dstDoc.createElement('div');
    gap.className = 'empty-line';
    return gap;
  }
  const htmlName =
    name === 'emphasis'
      ? 'em'
      : name === 'title'
        ? 'h2'
        : name === 'subtitle'
          ? 'h3'
          : name === 'v'
            ? 'p'
            : name === 'cite'
              ? 'blockquote'
              : name === 'poem' || name === 'stanza'
                ? 'div'
                : name === 'text-author'
                  ? 'p'
                  : name;
  const out = dstDoc.createElement(htmlName);
  if (name === 'a') {
    const href = safeHref(el.getAttribute('href') || el.getAttribute('l:href') || '');
    if (href) {
      out.setAttribute('href', href);
      out.setAttribute('rel', 'noopener noreferrer');
    }
  }
  if (name === 'img') {
    const srcAttr = safeHref(el.getAttribute('src') || '');
    if (srcAttr && !srcAttr.startsWith('http')) {
      /* relative epub paths won't load — keep alt */
    } else if (srcAttr) {
      out.setAttribute('src', srcAttr);
    }
    const alt = el.getAttribute('alt');
    if (alt) out.setAttribute('alt', alt);
  }
  for (const child of Array.from(src.childNodes)) {
    const copied = copySafe(child, dstDoc);
    if (copied) out.appendChild(copied);
  }
  return out;
}

export function markupToSafeHtml(markdown: string): string {
  const fragment = markdownToXhtmlFragment(markdown);
  const wrapped = `<div xmlns="http://www.w3.org/1999/xhtml">${fragment}</div>`;
  const parsed = new DOMParser().parseFromString(wrapped, 'application/xml');
  const err = parsed.getElementsByTagName('parsererror')[0];
  const srcRoot = err
    ? new DOMParser().parseFromString(`<div>${fragment}</div>`, 'text/html').body.firstElementChild
    : parsed.documentElement;
  if (!srcRoot) return '';
  const dst = document.implementation.createHTMLDocument('');
  const dest = dst.createElement('div');
  dest.className = 'preview-body';
  for (const child of Array.from(srcRoot.childNodes)) {
    const copied = copySafe(child, dst);
    if (copied) dest.appendChild(copied);
  }
  return dest.innerHTML;
}
