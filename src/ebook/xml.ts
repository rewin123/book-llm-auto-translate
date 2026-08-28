const WRAP_OPEN = '<bt-root xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">';
const WRAP_CLOSE = '</bt-root>';

export function wrapFragment(xml: string): string {
  return `${WRAP_OPEN}${xml}${WRAP_CLOSE}`;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error(err.textContent?.slice(0, 400) || 'XML parse error');
  }
  return doc;
}

export function isWellFormedXml(xml: string): boolean {
  try {
    parseXml(wrapFragment(xml));
    return true;
  } catch {
    try {
      parseXml(xml);
      return true;
    } catch {
      return false;
    }
  }
}

export function serializeElement(el: Element): string {
  return new XMLSerializer().serializeToString(el);
}

export function innerXml(el: Element): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    out += new XMLSerializer().serializeToString(child);
  }
  return out;
}

export function localName(el: Element): string {
  return (el.localName || el.tagName).toLowerCase();
}

export function findEl(root: ParentNode, name: string): Element | undefined {
  const want = name.toLowerCase();
  const walk = (node: ParentNode): Element | undefined => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (localName(el) === want) return el;
      const nested = walk(el);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(root);
}

export function findAll(root: ParentNode, name: string): Element[] {
  const want = name.toLowerCase();
  const out: Element[] = [];
  const walk = (node: ParentNode) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (localName(el) === want) out.push(el);
      walk(el);
    }
  };
  walk(root);
  return out;
}

export function textContent(el: Element | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function readXmlName(xml: string, pos: number): { name: string; next: number } {
  let j = pos;
  while (j < xml.length && /[:A-Za-z0-9_.-]/.test(xml[j]!)) j++;
  return { name: xml.slice(pos, j), next: j };
}

function skipQuoted(xml: string, pos: number): number {
  const q = xml[pos];
  if (q !== '"' && q !== "'") return pos;
  const end = xml.indexOf(q, pos + 1);
  return end === -1 ? xml.length : end + 1;
}

function skipToTagEnd(xml: string, pos: number): { end: number; selfClosing: boolean } {
  let j = pos;
  while (j < xml.length) {
    const ch = xml[j]!;
    if (ch === '"' || ch === "'") {
      j = skipQuoted(xml, j);
      continue;
    }
    if (ch === '>') return { end: j + 1, selfClosing: xml[j - 1] === '/' };
    j++;
  }
  return { end: xml.length, selfClosing: true };
}

function skipSpecial(xml: string, i: number): number | undefined {
  if (xml.startsWith('<!--', i)) {
    const end = xml.indexOf('-->', i + 4);
    return end === -1 ? xml.length : end + 3;
  }
  if (xml.startsWith('<![CDATA[', i)) {
    const end = xml.indexOf(']]>', i + 9);
    return end === -1 ? xml.length : end + 3;
  }
  if (xml.startsWith('<?', i)) {
    const end = xml.indexOf('?>', i + 2);
    return end === -1 ? xml.length : end + 2;
  }
  if (xml.startsWith('<!', i)) {
    const end = xml.indexOf('>', i + 2);
    return end === -1 ? xml.length : end + 1;
  }
  return undefined;
}

function endOfElement(xml: string, start: number): number {
  const special = skipSpecial(xml, start);
  if (special !== undefined) return special;
  const { name, next } = readXmlName(xml, start + 1);
  if (!name) return Math.min(start + 1, xml.length);
  const open = skipToTagEnd(xml, next);
  if (open.selfClosing) return open.end;
  const stack = [name];
  let i = open.end;
  while (i < xml.length && stack.length > 0) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) return xml.length;
    const skipped = skipSpecial(xml, lt);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }
    if (xml.startsWith('</', lt)) {
      const closed = readXmlName(xml, lt + 2);
      const tagEnd = skipToTagEnd(xml, closed.next);
      i = tagEnd.end;
      stack.pop();
      continue;
    }
    const opened = readXmlName(xml, lt + 1);
    const tagEnd = skipToTagEnd(xml, opened.next);
    i = tagEnd.end;
    if (!tagEnd.selfClosing && opened.name) stack.push(opened.name);
  }
  return i;
}

/**
 * Split a markup fragment into original top-level substrings (elements and text).
 * Concatenation of the result equals `xml`.
 */
export function splitTopLevelFragments(xml: string): string[] {
  const fragments: string[] = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const end = next === -1 ? n : next;
      fragments.push(xml.slice(i, end));
      i = end;
      continue;
    }
    const start = i;
    i = endOfElement(xml, i);
    fragments.push(xml.slice(start, i));
  }
  return fragments.filter((f) => f.length > 0);
}

export function reverseTextNodes(xml: string): string {
  const wrapped = wrapFragment(xml);
  const doc = parseXml(wrapped);
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      node.textContent = Array.from(node.textContent).reverse().join('');
    } else {
      for (const child of Array.from(node.childNodes)) walk(child);
    }
  };
  walk(doc.documentElement);
  const root = doc.documentElement;
  return innerXml(root);
}

export function extractPlainText(xml: string): string {
  try {
    const doc = parseXml(wrapFragment(xml));
    return textContent(doc.documentElement);
  } catch {
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
