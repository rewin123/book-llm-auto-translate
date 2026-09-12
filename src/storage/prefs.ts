import { storageKeys } from './keys.ts';

export type Locale = 'en' | 'ru';
export type Theme = 'light' | 'dark';

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKeys.locale);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function detectTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKeys.theme);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(storageKeys.locale, locale);
  } catch {
    /* quota / private mode */
  }
}

export function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKeys.theme, theme);
  } catch {
    /* quota / private mode */
  }
}
