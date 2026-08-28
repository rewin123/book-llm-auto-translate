import type { Chunk } from './types.ts';

export const DEFAULT_CHUNK_CHARS = 5000;

function insideTag(md: string, pos: number): boolean {
  const lt = md.lastIndexOf('<', pos);
  if (lt === -1) return false;
  const gt = md.lastIndexOf('>', pos);
  return lt > gt;
}

function insideLinkTarget(md: string, pos: number): boolean {
  const open = md.lastIndexOf('](', pos);
  if (open === -1) return false;
  const close = md.indexOf(')', open + 2);
  const bracket = md.lastIndexOf('[', pos);
  if (bracket > open) return false;
  return close === -1 || close >= pos;
}

function insideFence(md: string, pos: number): boolean {
  let fences = 0;
  let i = 0;
  while (i < pos) {
    const at = md.indexOf('```', i);
    if (at === -1 || at >= pos) break;
    if (at === 0 || md[at - 1] === '\n') fences += 1;
    i = at + 3;
  }
  return fences % 2 === 1;
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[0-9A-Za-zÀ-ÖØ-öø-ÿА-яЁё'’_-]/.test(ch);
}

function isProtected(md: string, pos: number): boolean {
  return insideTag(md, pos) || insideLinkTarget(md, pos) || insideFence(md, pos);
}

/** Cut at or before `start+maxChars` on a word/link/fence boundary. Never splits a word. */
export function nextWordCut(md: string, start: number, maxChars: number): number {
  const n = md.length;
  if (start >= n) return n;
  let limit = Math.min(start + maxChars, n);
  if (limit === n) return n;

  if (isProtected(md, limit)) {
    let cut = limit;
    while (cut > start && isProtected(md, cut)) cut--;
    if (cut > start) return cut;
    cut = limit;
    while (cut < n && isProtected(md, cut)) cut++;
    return cut;
  }

  if (limit < n && isWordChar(md[limit]) && isWordChar(md[limit - 1])) {
    let cut = limit;
    while (cut > start && isWordChar(md[cut - 1]) && !isProtected(md, cut - 1)) {
      cut--;
    }
    if (cut > start) return cut;
    cut = limit;
    while (cut < n && isWordChar(md[cut]) && !isProtected(md, cut)) cut++;
    return cut;
  }
  return Math.max(limit, start + 1);
}

export function splitAtWordBoundary(md: string, maxChars: number): string[] {
  if (md.length <= maxChars) return [md];
  const parts: string[] = [];
  let i = 0;
  while (i < md.length) {
    const end = nextWordCut(md, i, maxChars);
    parts.push(md.slice(i, end));
    i = end;
  }
  return parts.filter((p) => p.length > 0);
}

/**
 * Split markdown into original block substrings. Concatenation equals `md`.
 * Headings, fenced code, and blank-line-separated paragraphs stay intact.
 */
export function splitMarkdownBlocks(md: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = md.length;
  while (i < n) {
    if (md.startsWith('```', i) && (i === 0 || md[i - 1] === '\n')) {
      const close = md.indexOf('```', i + 3);
      let end = close === -1 ? n : close + 3;
      if (end < n && md[end] === '\n') end += 1;
      out.push(md.slice(i, end));
      i = end;
      continue;
    }

    let j = i;
    while (j < n) {
      if (j > i && md.startsWith('```', j) && md[j - 1] === '\n') break;
      if (
        j > i &&
        md[j] === '#' &&
        md[j - 1] === '\n' &&
        /^#{1,6} /.test(md.slice(j, Math.min(j + 8, n)))
      ) {
        break;
      }
      if (md.startsWith('\n\n', j)) {
        j += 2;
        while (j < n && md[j] === '\n') j += 1;
        break;
      }
      j += 1;
    }
    if (j === i) j = Math.min(i + 1, n);
    out.push(md.slice(i, j));
    i = j;
  }
  return out.filter((f) => f.length > 0);
}

export function packFragments(fragments: string[], maxChars: number): string[] {
  const exploded = fragments.flatMap((f) =>
    f.length <= maxChars ? [f] : splitAtWordBoundary(f, maxChars),
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

export function chunkMarkdown(md: string, maxChars: number): string[] {
  const fragments = splitMarkdownBlocks(md);
  if (fragments.length === 0) return md.trim() ? splitAtWordBoundary(md, maxChars) : [];
  return packFragments(fragments, maxChars);
}

export function chunksIntact(original: string, chunks: string[]): boolean {
  return chunks.join('') === original;
}

export function noChunkSplitsWord(original: string, chunks: string[]): boolean {
  let offset = 0;
  for (const chunk of chunks) {
    if (offset > 0 && offset < original.length) {
      const prev = original[offset - 1];
      const next = original[offset];
      if (isWordChar(prev) && isWordChar(next) && !isProtected(original, offset)) {
        return false;
      }
    }
    offset += chunk.length;
  }
  return true;
}

export function noChunkSplitsFence(chunks: string[]): boolean {
  return chunks.every((c) => {
    const fences = c.match(/```/g)?.length ?? 0;
    return fences % 2 === 0;
  });
}

export function indexChunks(
  pieces: { documentPath: string; chapterTitle: string; markdown: string }[],
  maxChars: number,
): Chunk[] {
  const out: Chunk[] = [];
  for (const piece of pieces) {
    const parts = chunkMarkdown(piece.markdown, maxChars);
    for (const markdown of parts) {
      out.push({
        index: out.length,
        documentPath: piece.documentPath,
        chapterTitle: piece.chapterTitle,
        markdown,
      });
    }
  }
  return out;
}
