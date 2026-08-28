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

function safeHref(value: string): string | null {
  const v = value.trim();
  if (!v || /^(javascript|data|vbscript):/i.test(v)) return null;
  return v;
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
    if (href) out.setAttribute('href', href);
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

export function markupToSafeHtml(xml: string): string {
  const wrapped = `<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>`;
  const parsed = new DOMParser().parseFromString(wrapped, 'application/xml');
  const err = parsed.getElementsByTagName('parsererror')[0];
  const srcRoot = err
    ? new DOMParser().parseFromString(`<div>${xml}</div>`, 'text/html').body.firstElementChild
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
