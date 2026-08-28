import { DEFAULT_CHUNK_CHARS } from '../ebook/chunk.ts';
import { storageKeys } from './keys.ts';

export type SetupPrefs = {
  sourceLang: string;
  targetLang: string;
  chunkChars: number;
  logLimit: number;
};

export function defaultSetup(): SetupPrefs {
  return { sourceLang: 'en', targetLang: 'ru', chunkChars: DEFAULT_CHUNK_CHARS, logLimit: 40 };
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
