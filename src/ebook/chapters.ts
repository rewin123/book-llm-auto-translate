import type { Chunk } from './types.ts';

export type ChapterRange = {
  title: string;
  documentPath: string;
  /** Inclusive 0-based chunk index. */
  from: number;
  /** Inclusive 0-based chunk index. */
  to: number;
};

/** Consecutive chunks that share a document path and chapter title. */
export function chapterChunkRanges(chunks: Chunk[]): ChapterRange[] {
  const out: ChapterRange[] = [];
  for (const chunk of chunks) {
    const last = out[out.length - 1];
    const same =
      last &&
      last.documentPath === chunk.documentPath &&
      last.title === chunk.chapterTitle;
    if (same && last) {
      last.to = chunk.index;
    } else {
      out.push({
        title: chunk.chapterTitle,
        documentPath: chunk.documentPath,
        from: chunk.index,
        to: chunk.index,
      });
    }
  }
  return out;
}

/**
 * Human-facing chapter list for the style-agent user message.
 * Ranges are 1-based; `read_chunk` still takes a 0-based idx.
 */
export function formatChapterList(chunks: Chunk[]): string {
  return chapterChunkRanges(chunks)
    .map((ch, i) => {
      const title = ch.title.trim() || `Untitled ${i + 1}`;
      return `# ${title} (chunks from ${ch.from + 1} to ${ch.to + 1})`;
    })
    .join('\n');
}
