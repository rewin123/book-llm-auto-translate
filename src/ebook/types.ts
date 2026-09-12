export type BookFormat = 'epub' | 'fb2';

export type TranslateLangs = {
  sourceLang: string;
  targetLang: string;
};

/**
 * How a chunk is rejoined with the one before it, when the cut between them was
 * not a block boundary: `'line'` for a soft line break, `'space'` for a split
 * made mid-sentence or between words. Absent means a real block boundary, which
 * is rejoined with a blank line.
 */
export type ChunkJoin = 'space' | 'line';

export type Chunk = {
  index: number;
  documentPath: string;
  chapterTitle: string;
  markdown: string;
  /**
   * Set when this chunk starts inside the block the previous one began, because
   * that block was longer than the chunk limit. Rejoining such a seam with a
   * blank line would turn one paragraph into several broken ones.
   */
  joinWith?: ChunkJoin;
};

export type BookImage = {
  /** Path used in markdown and in the generated EPUB, e.g. `images/cover.png`. */
  href: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type ParsedBook = {
  format: BookFormat;
  fileName: string;
  chunks: Chunk[];
  /** Original bytes kept so a restored job can re-extract images. */
  sourceBytes: Uint8Array;
  title: string;
  images: BookImage[];
};

export type PackedBook = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
};
