import { splitTopLevelFragments } from './xml.ts';
import type { Chunk } from './types.ts';

export const DEFAULT_CHUNK_CHARS = 5000;

function insideTag(xml: string, pos: number): boolean {
  const lt = xml.lastIndexOf('<', pos);
  if (lt === -1) return false;
  const gt = xml.lastIndexOf('>', pos);
  return lt > gt;
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[0-9A-Za-zÀ-ÖØ-öø-ÿА-яЁё'’_-]/.test(ch);
}

/** Cut at or before `start+maxChars` on a word/tag boundary. Never splits a word. */
export function nextWordCut(xml: string, start: number, maxChars: number): number {
  const n = xml.length;
  if (start >= n) return n;
  let limit = Math.min(start + maxChars, n);
  if (limit === n) return n;

  if (insideTag(xml, limit)) {
    const tagStart = xml.lastIndexOf('<', limit);
    if (tagStart > start) limit = tagStart;
    else {
      const tagEnd = xml.indexOf('>', limit);
      limit = tagEnd === -1 ? n : tagEnd + 1;
    }
  }

  if (limit < n && isWordChar(xml[limit]) && isWordChar(xml[limit - 1])) {
    let cut = limit;
    while (cut > start && isWordChar(xml[cut - 1]) && !insideTag(xml, cut - 1)) {
      cut--;
    }
    if (cut > start) return cut;
    cut = limit;
    while (cut < n && isWordChar(xml[cut]) && !insideTag(xml, cut)) cut++;
    return cut;
  }
  return Math.max(limit, start + 1);
}

export function splitXmlAtWordBoundary(xml: string, maxChars: number): string[] {
  if (xml.length <= maxChars) return [xml];
  const parts: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const end = nextWordCut(xml, i, maxChars);
    parts.push(xml.slice(i, end));
    i = end;
  }
  return parts.filter((p) => p.length > 0);
}

export function packFragments(fragments: string[], maxChars: number): string[] {
  const exploded = fragments.flatMap((f) =>
    f.length <= maxChars ? [f] : splitXmlAtWordBoundary(f, maxChars),
  );
  const chunks: string[] = [];
  let buf = '';
  for (const frag of exploded) {
    if (!buf) {
      buf = frag;
      continue;
    }
    if (buf.length + frag.length <= maxChars) {
      buf += frag;
    } else {
      chunks.push(buf);
      buf = frag;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function chunkMarkup(xml: string, maxChars: number): string[] {
  const fragments = splitTopLevelFragments(xml);
  if (fragments.length === 0) return xml.trim() ? splitXmlAtWordBoundary(xml, maxChars) : [];
  return packFragments(fragments, maxChars);
}

export function chunksIntact(original: string, chunks: string[]): boolean {
  return chunks.join('') === original;
}

export function noChunkSplitsTag(chunks: string[]): boolean {
  return chunks.every((c) => {
    const opens = (c.match(/</g) || []).length;
    const closes = (c.match(/>/g) || []).length;
    return opens === closes;
  });
}

export function noChunkSplitsWord(original: string, chunks: string[]): boolean {
  let offset = 0;
  for (const chunk of chunks) {
    if (offset > 0 && offset < original.length) {
      const prev = original[offset - 1];
      const next = original[offset];
      if (isWordChar(prev) && isWordChar(next) && !insideTag(original, offset)) {
        return false;
      }
    }
    offset += chunk.length;
  }
  return true;
}

export function indexChunks(
  pieces: { documentPath: string; chapterTitle: string; xml: string }[],
  maxChars: number,
): Chunk[] {
  const out: Chunk[] = [];
  for (const piece of pieces) {
    const parts = chunkMarkup(piece.xml, maxChars);
    for (const xml of parts) {
      out.push({
        index: out.length,
        documentPath: piece.documentPath,
        chapterTitle: piece.chapterTitle,
        xml,
      });
    }
  }
  return out;
}
