import type { Chunk } from '../ebook/types.ts';

export type BigChunk = {
  id: number;
  /** Inclusive 0-based standard-chunk index. */
  from: number;
  /** Inclusive 0-based standard-chunk index. */
  to: number;
  markdown: string;
};

/** Pack consecutive standard chunks into glossary-sized big chunks. */
export function groupBigChunks(chunks: Chunk[], batch: number): BigChunk[] {
  const size = Math.max(1, Math.floor(batch) || 1);
  const out: BigChunk[] = [];
  for (let i = 0; i < chunks.length; i += size) {
    const slice = chunks.slice(i, i + size);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    out.push({
      id: out.length,
      from: first.index,
      to: last.index,
      markdown: slice.map((c) => c.markdown).join(''),
    });
  }
  return out;
}

export type TranslateWindow = {
  id: number;
  /** Inclusive start. */
  from: number;
  /** Exclusive end. */
  to: number;
};

/**
 * Split `chunkCount` chunks into up to `parallelN` contiguous sequential windows.
 * Window length is `ceil(chunkCount / parallelN)`; the last window may be shorter.
 */
export function splitTranslateWindows(chunkCount: number, parallelN: number): TranslateWindow[] {
  if (chunkCount <= 0) return [];
  const workers = Math.max(1, Math.min(Math.floor(parallelN) || 1, chunkCount));
  const size = Math.ceil(chunkCount / workers);
  const out: TranslateWindow[] = [];
  for (let start = 0; start < chunkCount; start += size) {
    out.push({ id: out.length, from: start, to: Math.min(start + size, chunkCount) });
  }
  return out;
}
