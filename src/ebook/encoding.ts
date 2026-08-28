const DECL_RE = /encoding\s*=\s*["']([^"']+)["']/i;

const ALIASES: Record<string, string> = {
  'windows-1251': 'windows-1251',
  'cp1251': 'windows-1251',
  'win-1251': 'windows-1251',
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-16': 'utf-16',
  'iso-8859-1': 'iso-8859-1',
  'koi8-r': 'koi8-r',
};

export function encodingFromXmlDeclaration(bytes: Uint8Array): string {
  const head = bytes.subarray(0, Math.min(bytes.length, 256));
  let ascii = '';
  for (let i = 0; i < head.length; i++) {
    const c = head[i]!;
    if (c === 0) continue;
    ascii += String.fromCharCode(c);
  }
  const match = DECL_RE.exec(ascii);
  if (!match) return 'utf-8';
  const raw = match[1]!.trim().toLowerCase();
  return ALIASES[raw] ?? raw;
}

export function decodeXmlBytes(bytes: Uint8Array): string {
  const encoding = encodingFromXmlDeclaration(bytes);
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

export function toUtf8Xml(xml: string): string {
  if (/^<\?xml\b[^?]*\?>/i.test(xml)) {
    return xml.replace(
      /^<\?xml\b[^?]*\?>/i,
      '<?xml version="1.0" encoding="UTF-8"?>',
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}
