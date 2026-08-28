export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error(err.textContent?.slice(0, 400) || 'XML parse error');
  }
  return doc;
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
