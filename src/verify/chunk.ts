import type { Chunk } from '../ebook/types.ts';

/** Longest markdown; ties go to the earlier index. */
export function longestChunkIndex(chunks: Chunk[]): number {
  if (chunks.length === 0) return 0;
  let best = 0;
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i]!.markdown.length > chunks[best]!.markdown.length) best = i;
  }
  return best;
}
