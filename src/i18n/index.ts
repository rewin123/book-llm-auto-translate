import { createContext, useContext } from 'react';
import { en, type Messages } from './en.ts';
import { ru } from './ru.ts';
import type { Locale } from '../storage/prefs.ts';

export type { Messages };

export const catalogs: Record<Locale, Messages> = { en, ru };

export const I18nContext = createContext<{
  locale: Locale;
  t: Messages;
  setLocale: (l: Locale) => void;
}>({ locale: 'en', t: en, setLocale: () => undefined });

export function useT() {
  return useContext(I18nContext);
}

/** Fills `{name}` placeholders. Unknown names are left alone rather than blanked. */
export function fmt(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

/** Endonym-aware language names, so a picker never shows bare ISO codes. */
export function languageName(code: string, locale: Locale): string {
  try {
    const label = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    if (!label || label === code) return code;
    const native = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return native && native !== label ? `${label} — ${native}` : label;
  } catch {
    return code;
  }
}

export function shortLanguageName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatBytes(bytes: number, locale: Locale): string {
  const mb = bytes / 1_000_000;
  if (mb >= 1) return `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1000)).toLocaleString(locale)} KB`;
}

export function formatDuration(ms: number, t: Messages): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return fmt(t.unitSec, { n: Math.max(1, Math.round(ms / 1000)) });
  if (mins < 60) return fmt(t.unitMin, { n: mins });
  return fmt(t.unitHour, { n: Math.floor(mins / 60), m: mins % 60 });
}

export function formatAgo(ts: number, t: Messages): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return t.agoJustNow;
  if (mins < 60) return fmt(t.agoMinutes, { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return fmt(t.agoHours, { n: hours });
  return fmt(t.agoDays, { n: Math.round(hours / 24) });
}

export function formatUsd(usd: number | null, t: Messages): string {
  if (usd == null) return t.costUnknown;
  if (usd === 0) return t.costFree;
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** "~$0.04", but never "~price unknown". */
export function approxUsd(usd: number | null, t: Messages): string {
  if (usd == null) return t.costUnknown;
  if (usd === 0) return t.costFree;
  return `~${formatUsd(usd, t)}`;
}
