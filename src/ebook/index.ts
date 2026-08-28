import { packEpub } from './epub.ts';
import { packFb2 } from './fb2.ts';
import { parseFb2 } from './fb2.ts';
import { parseEpub } from './epub.ts';
import { DEFAULT_CHUNK_CHARS } from './chunk.ts';
import JSZip from 'jszip';
import type { PackedBook, ParsedBook } from './types.ts';

/** Why a file could not be opened, in a form the UI can explain and act on. */
export type ParseErrorCode = 'unsupported' | 'zip-no-fb2' | 'corrupt' | 'empty';

export class BookParseError extends Error {
  code: ParseErrorCode;
  fileName: string;

  constructor(code: ParseErrorCode, fileName: string, cause?: unknown) {
    super(`${code}: ${fileName}`);
    this.name = 'BookParseError';
    this.code = code;
    this.fileName = fileName;
    if (cause instanceof Error) this.cause = cause;
  }
}

export const ACCEPTED_EXTENSIONS = '.epub,.fb2,.fb2.zip,.fbz';

export async function parseBook(
  file: File | { name: string; bytes: Uint8Array },
  maxChunkChars = DEFAULT_CHUNK_CHARS,
): Promise<ParsedBook> {
  const name = file.name;
  const bytes =
    file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  const lower = name.toLowerCase();

  const book = await parseByExtension(lower, bytes, name, maxChunkChars);
  if (book.chunks.length === 0) throw new BookParseError('empty', name);
  return book;
}

async function parseByExtension(
  lower: string,
  bytes: Uint8Array,
  name: string,
  maxChunkChars: number,
): Promise<ParsedBook> {
  try {
    if (lower.endsWith('.epub')) {
      return await parseEpub(bytes, name, maxChunkChars);
    }
    if (lower.endsWith('.fb2')) {
      return await parseFb2(bytes, name, maxChunkChars);
    }
    if (lower.endsWith('.fb2.zip') || lower.endsWith('.fbz') || lower.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(bytes);
      const fb2 = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.fb2'));
      // A plain .zip reaches here too: it opens fine but holds no book, which is
      // a different problem from a corrupt archive and deserves its own message.
      if (!fb2) throw new BookParseError('zip-no-fb2', name);
      const inner = await fb2.async('uint8array');
      return await parseFb2(inner, fb2.name, maxChunkChars);
    }
  } catch (err) {
    if (err instanceof BookParseError) throw err;
    throw new BookParseError('corrupt', name, err);
  }
  throw new BookParseError('unsupported', name);
}

export async function packBook(options: {
  book: ParsedBook;
  translations: string[];
  targetLang: string;
}): Promise<PackedBook> {
  const base = options.book.fileName.replace(/\.(epub|fb2|fb2\.zip|fbz)$/i, '');
  if (options.book.format === 'epub') {
    return packEpub({
      sourceBytes: options.book.sourceBytes,
      chunks: options.book.chunks,
      translations: options.translations,
      targetLang: options.targetLang,
      outName: `${base}.${options.targetLang}.epub`,
    });
  }
  return packFb2({
    sourceBytes: options.book.sourceBytes,
    chunks: options.book.chunks,
    translations: options.translations,
    targetLang: options.targetLang,
    outName: `${base}.${options.targetLang}.fb2`,
  });
}

export { DEFAULT_CHUNK_CHARS } from './chunk.ts';
export { validateTranslation } from './validate.ts';
export { reverseTextNodes } from './xml.ts';
export type { Chunk, PackedBook, ParsedBook } from './types.ts';
