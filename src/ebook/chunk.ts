import type { Chunk, ChunkJoin } from './types.ts';

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

/**
 * How far either side of the ideal offset we look for a better place to cut.
 *
 * Clamped to half the chunk size so a small `maxChars` cannot be overshot by
 * more than it: at the 5000-character default this is the full 1000.
 */
const BOUNDARY_SEARCH_RADIUS = 1000;

export function boundarySlack(maxChars: number): number {
  return Math.min(BOUNDARY_SEARCH_RADIUS, Math.max(1, Math.floor(maxChars / 2)));
}

/**
 * Quality of a cut, best first. A chunk that ends at a section or paragraph
 * break reads as a unit and gives the model a complete thought; one that ends
 * mid-sentence does not, and the seam has to be stitched back together after
 * translation.
 */
const Cut = {
  None: 0,
  Word: 1,
  Sentence: 2,
  Line: 3,
  Paragraph: 4,
  Section: 5,
} as const;

type Cut = (typeof Cut)[keyof typeof Cut];

const RANKS = [Cut.Section, Cut.Paragraph, Cut.Line, Cut.Sentence, Cut.Word] as const;

/** A heading or thematic break starts a new section of the book. */
const SECTION_LINE_RE = /^(?:#{1,6} |-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|```)/;

/** Sentence-ending punctuation, as prose actually uses it. */
const SENTENCE_END = new Set(['.', '!', '?', '…', '"', '»', "'", ')']);

function isSentenceEnd(md: string, at: number): boolean {
  const ch = md[at];
  if (ch === undefined) return false;
  if (ch === '.' || ch === '!' || ch === '?' || ch === '…') return true;
  // A closing quote or bracket only ends a sentence when punctuation precedes it.
  if (!SENTENCE_END.has(ch)) return false;
  const prev = md[at - 1];
  return prev === '.' || prev === '!' || prev === '?' || prev === '…';
}

/** True when the last non-empty line before `i` is a heading. */
function endsWithHeading(md: string, i: number): boolean {
  let end = i - 1;
  while (end > 0 && md[end - 1] === '\n') end -= 1;
  if (end <= 0) return false;
  const start = md.lastIndexOf('\n', end - 1) + 1;
  return /^#{1,6} /.test(md.slice(start, end));
}

/**
 * How good a cut at `i` would be — `i` is where the next chunk starts, so the
 * character before it is the last one kept.
 */
function cutRank(md: string, i: number): Cut {
  const prev = md[i - 1];
  if (prev === undefined) return Cut.None;

  if (prev === '\n') {
    const lineEnd = md.indexOf('\n', i);
    const line = md.slice(i, lineEnd === -1 ? md.length : lineEnd);
    if (SECTION_LINE_RE.test(line)) return Cut.Section;
    // A heading belongs with the text under it. Cutting just after one leaves it
    // stranded at the end of a chunk, translated without the section it titles,
    // so this is only ever a last resort.
    if (endsWithHeading(md, i)) return Cut.Word;
    // Preceded by a blank line: the previous block is finished.
    if (md[i - 2] === '\n') return Cut.Paragraph;
    return Cut.Line;
  }

  if (/\s/.test(prev)) {
    // Walk back over the whitespace run to find what the sentence ended with.
    let j = i - 1;
    while (j > 0 && /\s/.test(md[j - 1]!)) j -= 1;
    return isSentenceEnd(md, j - 1) ? Cut.Sentence : Cut.Word;
  }

  return Cut.None;
}

/**
 * `isProtected` walks the document, so it is only ever asked about the few best
 * candidates rather than every offset in the window.
 */
const MAX_PROTECTION_PROBES = 24;

/**
 * Best cut within `radius` of `limit`, preferring section over paragraph over
 * line over sentence over word, and the closest offset within a rank.
 */
function rankedCut(md: string, start: number, limit: number, radius: number): number | null {
  const lo = Math.max(start + 1, limit - radius);
  const hi = Math.min(md.length, limit + radius);
  if (hi < lo) return null;

  const byRank = new Map<Cut, number[]>();
  for (let i = lo; i <= hi; i += 1) {
    const rank = cutRank(md, i);
    if (rank === Cut.None) continue;
    const list = byRank.get(rank);
    if (list) list.push(i);
    else byRank.set(rank, [i]);
  }

  for (const rank of RANKS) {
    const list = byRank.get(rank);
    if (!list) continue;
    list.sort((a, b) => Math.abs(a - limit) - Math.abs(b - limit) || a - b);
    for (const cut of list.slice(0, MAX_PROTECTION_PROBES)) {
      if (!isProtected(md, cut)) return cut;
    }
  }
  return null;
}

/**
 * Cut at the best boundary near `start+maxChars`.
 *
 * Splitting on the nearest word boundary alone left chunks ending mid-sentence
 * even when a paragraph break sat a few dozen characters away, which costs the
 * model the context it needs and forces the seam to be repaired afterwards.
 */
export function nextWordCut(md: string, start: number, maxChars: number): number {
  return avoidSurrogateSplit(md, rawWordCut(md, start, maxChars));
}

function rawWordCut(md: string, start: number, maxChars: number): number {
  const n = md.length;
  if (start >= n) return n;
  const limit = Math.min(start + maxChars, n);
  if (limit === n) return n;

  const slack = boundarySlack(maxChars);
  const ranked = rankedCut(md, start, limit, slack);
  if (ranked !== null) return ranked;

  // Nothing rankable nearby (a solid run of non-space text, say): fall back to
  // the old behaviour of nudging off a protected region or a word.
  const ceiling = Math.min(n, limit + slack);
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

/**
 * Splits `md`, reporting for each piece how it should be rejoined with the one
 * before it — which follows from the kind of boundary that was cut.
 */
export function splitAtBoundaries(md: string, maxChars: number): ChunkPart[] {
  if (md.length <= maxChars) return [{ markdown: md, joinWith: undefined }];
  const parts: ChunkPart[] = [];
  let i = 0;
  let pendingJoin: ChunkJoin | undefined;
  while (i < md.length) {
    const end = nextWordCut(md, i, maxChars);
    const text = md.slice(i, end);
    if (text.length > 0) parts.push({ markdown: text, joinWith: pendingJoin });
    pendingJoin = joinForRank(cutRank(md, end));
    i = end;
  }
  return parts;
}

function joinForRank(rank: Cut): ChunkJoin | undefined {
  if (rank === Cut.Section || rank === Cut.Paragraph) return undefined;
  return rank === Cut.Line ? 'line' : 'space';
}

export function splitAtWordBoundary(md: string, maxChars: number): string[] {
  return splitAtBoundaries(md, maxChars).map((p) => p.markdown);
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
 * A chunk plus how it should be rejoined with the one before it.
 *
 * Packing the translation back together needs this, because the cut is not
 * always a block boundary: an over-long paragraph is legitimately split
 * mid-sentence, and gluing that seam with a blank line would turn one paragraph
 * into several broken ones. `undefined` means a real block boundary.
 */
export type ChunkPart = { markdown: string; joinWith: ChunkJoin | undefined };

function explode(fragments: string[], maxChars: number): ChunkPart[] {
  const out: ChunkPart[] = [];
  for (const fragment of fragments) {
    if (fragment.length <= maxChars) {
      out.push({ markdown: fragment, joinWith: undefined });
      continue;
    }
    out.push(...splitAtBoundaries(fragment, maxChars));
  }
  return out;
}

/** A block that opens a section: the chunk after it should start with it. */
function isSectionFragment(markdown: string): boolean {
  return /^\s*(?:#{1,6} |-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/.test(markdown);
}

export function packFragmentParts(fragments: string[], maxChars: number): ChunkPart[] {
  const chunks: ChunkPart[] = [];
  /** Fragments accumulated for the chunk being built. */
  let buf: ChunkPart[] = [];
  let bufLen = 0;

  const merge = (parts: ChunkPart[]): ChunkPart => ({
    markdown: parts.map((p) => p.markdown).join(''),
    joinWith: parts[0]!.joinWith,
  });

  /**
   * Trailing headings move to the next chunk. A heading left at the end of a
   * chunk is translated without the section it titles, and the section then
   * starts without its heading — so it travels with its body instead.
   */
  const carryTrailingHeadings = (): ChunkPart[] => {
    const carried: ChunkPart[] = [];
    while (buf.length > 1 && isSectionFragment(buf[buf.length - 1]!.markdown)) {
      carried.unshift(buf.pop()!);
    }
    return carried;
  };

  for (const frag of explode(fragments, maxChars)) {
    if (buf.length === 0) {
      buf = [{ ...frag }];
      bufLen = frag.markdown.length;
      continue;
    }
    if (bufLen + frag.markdown.length <= maxChars) {
      buf.push({ ...frag });
      bufLen += frag.markdown.length;
      continue;
    }
    const carried = carryTrailingHeadings();
    chunks.push(merge(buf));
    buf = [...carried, { ...frag }];
    bufLen = buf.reduce((n, p) => n + p.markdown.length, 0);
  }
  if (buf.length > 0) chunks.push(merge(buf));
  return chunks;
}

export function packFragments(fragments: string[], maxChars: number): string[] {
  return packFragmentParts(fragments, maxChars).map((p) => p.markdown);
}

export function chunkMarkdownParts(md: string, maxChars: number): ChunkPart[] {
  const fragments = splitMarkdownBlocks(md);
  if (fragments.length === 0) {
    if (!md.trim()) return [];
    return splitAtBoundaries(md, maxChars);
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
        ...(part.joinWith ? { joinWith: part.joinWith } : {}),
      });
    }
  }
  return out;
}
