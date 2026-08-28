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
