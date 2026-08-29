export type GlossaryEntry = { src: string; dst: string };

export function mergeGlossary(
  current: GlossaryEntry[],
  updates: GlossaryEntry[],
): GlossaryEntry[] {
  const map = new Map(current.map((e) => [e.src, e.dst]));
  for (const u of updates) {
    const src = u.src.trim();
    const dst = u.dst.trim();
    if (!src || !dst || src === dst) continue;
    if (map.has(src)) continue;
    map.set(src, dst);
  }
  return [...map.entries()].map(([src, dst]) => ({ src, dst }));
}

/** Insert or overwrite by source form. Empty sides are ignored. */
export function upsertGlossary(
  current: GlossaryEntry[],
  src: string,
  dst: string,
): GlossaryEntry[] {
  const s = src.trim();
  const d = dst.trim();
  if (!s || !d) return current;
  const map = new Map(current.map((e) => [e.src, e.dst]));
  map.set(s, d);
  return [...map.entries()].map(([key, value]) => ({ src: key, dst: value }));
}

/** Parse a model JSON object `{ "Alice": "Алиса", ... }` (fences and chatter allowed). */
export function parseGlossaryJson(text: string): GlossaryEntry[] {
  const obj = extractJsonObject(text);
  if (!obj) return [];
  const out: GlossaryEntry[] = [];
  for (const [src, dst] of Object.entries(obj)) {
    if (typeof dst !== 'string') continue;
    const s = src.trim();
    const d = dst.trim();
    if (!s || !d) continue;
    out.push({ src: s, dst: d });
  }
  return out;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseGlossaryLines(text: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s*(?:->|—|–|\|)\s*/);
    if (parts.length >= 2) out.push({ src: parts[0]!, dst: parts.slice(1).join(' | ') });
  }
  return out;
}
