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

/** A byte-order mark is authoritative: it outranks any `encoding=` attribute. */
export function encodingFromBom(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  return null;
}

function decodeWith(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Share of U+FFFD — a decode that produced many is the wrong decode. */
function replacementRatio(text: string): number {
  if (!text) return 0;
  return (text.match(/�/g)?.length ?? 0) / text.length;
}

const MAX_REPLACEMENT_RATIO = 0.02;

/**
 * Decodes an XML document, preferring the BOM, then the declaration.
 *
 * `fatal: false` never throws, so a cp1251 file mislabelled `encoding="utf-8"` —
 * endemic among FB2 books — used to decode into a document made of replacement
 * characters and go on to be chunked and translated. A decode that produces an
 * implausible share of them is now retried with the common single-byte
 * encodings, and the cleanest result wins.
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  const bom = encodingFromBom(bytes);
  if (bom) {
    const decoded = decodeWith(bytes, bom);
    if (decoded !== null) return decoded;
  }

  const declared = encodingFromXmlDeclaration(bytes);
  const first = decodeWith(bytes, declared) ?? decodeWith(bytes, 'utf-8') ?? '';
  if (replacementRatio(first) <= MAX_REPLACEMENT_RATIO) return first;

  let best = first;
  let bestRatio = replacementRatio(first);
  for (const candidate of ['windows-1251', 'iso-8859-1', 'koi8-r', 'utf-8']) {
    if (candidate === declared) continue;
    const decoded = decodeWith(bytes, candidate);
    if (decoded === null) continue;
    const ratio = replacementRatio(decoded);
    if (ratio < bestRatio) {
      best = decoded;
      bestRatio = ratio;
      if (ratio === 0) break;
    }
  }
  return best;
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
