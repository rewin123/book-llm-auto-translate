import type { Chunk } from './types.ts';

export const DEFAULT_CHUNK_CHARS = 5000;

/**
 * Caps for "am I inside a construct I must not cut?".
 *
 * Without them a single unmatched `<` or `](` anywhere in a chapter marks the
 * whole remaining text as protected, and the scan that looks for a safe cut runs
 * to the end of the document — which produced chunks many times `maxChars`.
 */
const MAX_TAG_SPAN = 200;
const MAX_LINK_SPAN = 2000;
/** How far past `maxChars` a cut may travel before we cut anyway. */
const OVERSHOOT_SLACK = 512;

function insideTag(md: string, pos: number): boolean {
  const lt = md.lastIndexOf('<', pos);
  if (lt === -1) return false;
  const gt = md.lastIndexOf('>', pos);
  if (lt <= gt) return false;
  if (pos - lt > MAX_TAG_SPAN) return false;
  // A bare `<` (from a source `&lt;`) is text, not a tag: only a delimiter that
  // actually closes counts, and a real tag holds no `<` and no blank line.
  const close = md.indexOf('>', pos);
  if (close === -1 || close - lt > MAX_TAG_SPAN) return false;
  const span = md.slice(lt + 1, close);
  return !span.includes('<') && !span.includes('\n\n');
}

function insideLinkTarget(md: string, pos: number): boolean {
  const open = md.lastIndexOf('](', pos);
  if (open === -1) return false;
  const bracket = md.lastIndexOf('[', pos);
  if (bracket > open) return false;
  const close = md.indexOf(')', open + 2);
  // An unclosed `](` is ordinary text; it must not protect the rest of the book.
  if (close === -1 || close < pos) return false;
  return close - open <= MAX_LINK_SPAN;
}

/** Counts line-start fences before `pos`. Shared so the invariant checker agrees. */
function fenceCountBefore(md: string, pos: number): number {
  let fences = 0;
  let i = 0;
  while (i < pos) {
    const at = md.indexOf('```', i);
    if (at === -1 || at >= pos) break;
    if (at === 0 || md[at - 1] === '\n') fences += 1;
    i = at + 3;
  }
  return fences;
}

function hasFenceAtOrAfter(md: string, pos: number): boolean {
  let i = pos;
  while (i < md.length) {
    const at = md.indexOf('```', i);
    if (at === -1) return false;
    if (at === 0 || md[at - 1] === '\n') return true;
    i = at + 3;
  }
  return false;
}

function insideFence(md: string, pos: number): boolean {
  if (fenceCountBefore(md, pos) % 2 !== 1) return false;
  // An unterminated fence would otherwise protect every later offset.
  return hasFenceAtOrAfter(md, pos);
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[0-9A-Za-zÀ-ÖØ-öø-ÿА-яЁё'’_-]/.test(ch);
}

function isProtected(md: string, pos: number): boolean {
  return insideTag(md, pos) || insideLinkTarget(md, pos) || insideFence(md, pos);
}

/**
 * Never cut between the halves of a surrogate pair: each side would hold an
 * unpaired code unit, which is invalid UTF-16 and reaches the API and the
 * checkpoint as `U+FFFD`.
 */
function avoidSurrogateSplit(md: string, cut: number): number {
  if (cut <= 0 || cut >= md.length) return cut;
  const prev = md.charCodeAt(cut - 1);
  if (prev < 0xd800 || prev > 0xdbff) return cut;
  const next = md.charCodeAt(cut);
  return next >= 0xdc00 && next <= 0xdfff ? cut + 1 : cut;
}

/** Cut at or before `start+maxChars` on a word/link/fence boundary. Never splits a word. */
export function nextWordCut(md: string, start: number, maxChars: number): number {
  return avoidSurrogateSplit(md, rawWordCut(md, start, maxChars));
}

function rawWordCut(md: string, start: number, maxChars: number): number {
  const n = md.length;
  if (start >= n) return n;
  const limit = Math.min(start + maxChars, n);
  if (limit === n) return n;
  // Cutting a little late beats returning a chunk many times the limit.
  const ceiling = Math.min(n, limit + OVERSHOOT_SLACK);

  if (isProtected(md, limit)) {
    let cut = limit;
    while (cut > start && isProtected(md, cut)) cut--;
    if (cut > start) return cut;
    cut = limit;
    while (cut < ceiling && isProtected(md, cut)) cut++;
    return cut < ceiling ? cut : Math.max(limit, start + 1);
  }

  if (isWordChar(md[limit]) && isWordChar(md[limit - 1])) {
    let cut = limit;
    while (cut > start && isWordChar(md[cut - 1]) && !isProtected(md, cut - 1)) {
      cut--;
    }
    if (cut > start) return cut;
    cut = limit;
    while (cut < ceiling && isWordChar(md[cut]) && !isProtected(md, cut)) cut++;
    return cut < ceiling ? cut : Math.max(limit, start + 1);
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

/**
 * A chunk plus whether it starts in the middle of a block the previous chunk
 * began. Packing the translation back together needs this: an over-long
 * paragraph is legitimately cut mid-sentence, and rejoining such a seam with a
 * blank line would turn one paragraph into several broken ones.
 */
export type ChunkPart = { markdown: string; continuesBlock: boolean };

function explode(fragments: string[], maxChars: number): ChunkPart[] {
  const out: ChunkPart[] = [];
  for (const fragment of fragments) {
    if (fragment.length <= maxChars) {
      out.push({ markdown: fragment, continuesBlock: false });
      continue;
    }
    const pieces = splitAtWordBoundary(fragment, maxChars);
    pieces.forEach((markdown, i) => out.push({ markdown, continuesBlock: i > 0 }));
  }
  return out;
}

export function packFragmentParts(fragments: string[], maxChars: number): ChunkPart[] {
  const chunks: ChunkPart[] = [];
  let buf: ChunkPart | null = null;
  for (const frag of explode(fragments, maxChars)) {
    if (!buf) {
      buf = { ...frag };
      continue;
    }
    if (buf.markdown.length + frag.markdown.length <= maxChars) {
      buf.markdown += frag.markdown;
    } else {
      chunks.push(buf);
      buf = { ...frag };
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function packFragments(fragments: string[], maxChars: number): string[] {
  return packFragmentParts(fragments, maxChars).map((p) => p.markdown);
}

export function chunkMarkdownParts(md: string, maxChars: number): ChunkPart[] {
  const fragments = splitMarkdownBlocks(md);
  if (fragments.length === 0) {
    if (!md.trim()) return [];
    return splitAtWordBoundary(md, maxChars).map((markdown, i) => ({
      markdown,
      continuesBlock: i > 0,
    }));
  }
  return packFragmentParts(fragments, maxChars);
}

export function chunkMarkdown(md: string, maxChars: number): string[] {
  return chunkMarkdownParts(md, maxChars).map((p) => p.markdown);
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
  // Counts only line-start fences, the same rule `insideFence` applies; a
  // backtick run inside prose is not a fence and must not fail the invariant.
  return chunks.every((c) => fenceCountBefore(c, c.length) % 2 === 0);
}

/** No chunk holds an unpaired surrogate half. */
export function noChunkSplitsSurrogate(chunks: string[]): boolean {
  return chunks.every((c) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(c));
}

export function indexChunks(
  pieces: { documentPath: string; chapterTitle: string; markdown: string }[],
  maxChars: number,
): Chunk[] {
  const out: Chunk[] = [];
  for (const piece of pieces) {
    for (const part of chunkMarkdownParts(piece.markdown, maxChars)) {
      out.push({
        index: out.length,
        documentPath: piece.documentPath,
        chapterTitle: piece.chapterTitle,
        markdown: part.markdown,
        ...(part.continuesBlock ? { continuesBlock: true as const } : {}),
      });
    }
  }
  return out;
}
