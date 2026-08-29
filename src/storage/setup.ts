import { DEFAULT_CHUNK_CHARS } from '../ebook/chunk.ts';
import { storageKeys } from './keys.ts';

export const DEFAULT_CONCURRENCY = 1;
export const DEFAULT_GLOSSARY_BATCH = 4;
export const DEFAULT_REVIEW_BATCH = 5;
export const MAX_CONCURRENCY = 8;
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
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(n)));
}

export function clampBatch(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_BATCH, Math.max(1, Math.round(n)));
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
    return { ...defaultSetup(), ...(JSON.parse(raw) as Partial<SetupPrefs>) };
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
