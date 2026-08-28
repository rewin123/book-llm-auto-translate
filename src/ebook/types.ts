export type BookFormat = 'epub' | 'fb2';

export type Chunk = {
  index: number;
  documentPath: string;
  chapterTitle: string;
  xml: string;
};

export type ParsedBook = {
  format: BookFormat;
  fileName: string;
  chunks: Chunk[];
  /** Original bytes kept for clone-pack. */
  sourceBytes: Uint8Array;
  title: string;
};

export type PackedBook = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
};
