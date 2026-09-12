import { DEFAULT_CHUNK_CHARS } from '../ebook/chunk.ts';
import { storageKeys } from './keys.ts';

export const DEFAULT_CONCURRENCY = 1;
export const DEFAULT_GLOSSARY_BATCH = 4;
export const DEFAULT_REVIEW_BATCH = 5;
export const MAX_BATCH = 20;

export type SetupPrefs = {
  sourceLang: string;
  targetLang: string;
  chunkChars: number;
  logLimit: number;
  concurrency: number;
  glossaryBatch: number;
  reviewBatch: number;
};

export function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.round(n));
}

export function clampBatch(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_BATCH, Math.max(1, Math.round(n)));
}

/** Bounds of the chunk-size field, matching the input's own min and max. */
export const MIN_CHUNK_CHARS = 800;
export const MAX_CHUNK_CHARS = 20_000;

/**
 * An unclamped value here re-split the whole book: an empty field reads as
 * `Number('') === 0`, and at zero the chunker advances one character at a time,
 * producing hundreds of thousands of chunks and freezing the tab — and the zero
 * was persisted, so the breakage survived a reload.
 */
export function clampChunkChars(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CHUNK_CHARS;
  return Math.min(MAX_CHUNK_CHARS, Math.max(MIN_CHUNK_CHARS, Math.round(n)));
}

/** Bounds of the log-size field. */
export const MIN_LOG_LIMIT = 5;
export const MAX_LOG_LIMIT = 200;

/**
 * `slice(-0)` is `slice(0)`, so a zero here copied the entire unbounded event
 * array into every snapshot — the exact opposite of "keep no lines".
 */
export function clampLogLimit(n: number): number {
  if (!Number.isFinite(n)) return MIN_LOG_LIMIT;
  return Math.min(MAX_LOG_LIMIT, Math.max(MIN_LOG_LIMIT, Math.round(n)));
}

export function defaultSetup(): SetupPrefs {
  return {
    sourceLang: 'en',
    targetLang: 'ru',
    chunkChars: DEFAULT_CHUNK_CHARS,
    logLimit: 40,
    concurrency: DEFAULT_CONCURRENCY,
    glossaryBatch: DEFAULT_GLOSSARY_BATCH,
    reviewBatch: DEFAULT_REVIEW_BATCH,
  };
}

/** Remembered between books — retyping the same pair every time is friction. */
export function loadSetup(): SetupPrefs {
  try {
    const raw = localStorage.getItem(storageKeys.setup);
    if (!raw) return defaultSetup();
    const merged = { ...defaultSetup(), ...(JSON.parse(raw) as Partial<SetupPrefs>) };
    // Heal a value an earlier build could persist out of range — a stored
    // `chunkChars: 0` froze the tab on every load until site data was cleared.
    return {
      ...merged,
      chunkChars: clampChunkChars(merged.chunkChars),
      logLimit: clampLogLimit(merged.logLimit),
      concurrency: clampConcurrency(merged.concurrency),
      glossaryBatch: clampBatch(merged.glossaryBatch, DEFAULT_GLOSSARY_BATCH),
      reviewBatch: clampBatch(merged.reviewBatch, DEFAULT_REVIEW_BATCH),
    };
  } catch {
    return defaultSetup();
  }
}

export function saveSetup(value: SetupPrefs) {
  try {
    localStorage.setItem(storageKeys.setup, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
