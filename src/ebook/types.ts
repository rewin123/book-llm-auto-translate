export type BookFormat = 'epub' | 'fb2';

export type Chunk = {
  index: number;
  documentPath: string;
  chapterTitle: string;
  markdown: string;
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
