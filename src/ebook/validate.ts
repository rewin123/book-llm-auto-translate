import { extractPlainText, isWellFormedXml, parseXml, wrapFragment } from './xml.ts';

const REFUSAL_RE =
  /i cannot translate|i can't translate|as an ai|не могу перевести|отказ от перевода/i;

function collectTagNames(xml: string): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /<\/?([A-Za-z][:A-Za-z0-9_.-]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const name = m[1]!.toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function collectAttrs(xml: string, attr: string): Set<string> {
  const values = new Set<string>();
  const re = new RegExp(`\\s${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) values.add(m[2]!);
  return values;
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateTranslation(source: string, translation: string): ValidationResult {
  if (!translation.trim()) return { ok: false, reason: 'empty translation' };

  if (!isWellFormedXml(translation)) return { ok: false, reason: 'not well-formed XML' };

  if (!mapsEqual(collectTagNames(source), collectTagNames(translation))) {
    return { ok: false, reason: 'tag multiset mismatch' };
  }

  for (const attr of ['id', 'href', 'src'] as const) {
    const orig = collectAttrs(source, attr);
    const next = collectAttrs(translation, attr);
    for (const v of orig) {
      if (!next.has(v)) return { ok: false, reason: `missing ${attr}="${v}"` };
    }
  }

  const srcText = extractPlainText(source);
  const dstText = extractPlainText(translation);
  if (srcText.length > 20 && dstText.length < Math.max(8, srcText.length * 0.15)) {
    return { ok: false, reason: 'translation too short' };
  }
  if (srcText.length > 20 && dstText.length > srcText.length * 8) {
    return { ok: false, reason: 'translation too long' };
  }
  if (REFUSAL_RE.test(dstText)) return { ok: false, reason: 'model refusal' };

  try {
    parseXml(wrapFragment(translation));
  } catch {
    return { ok: false, reason: 'fragment parse failed' };
  }

  return { ok: true };
}
