/** First subtag of a BCP 47 code: `ru-RU` → `ru`. */
export function languagePrefix(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

export type ScriptKind = 'cyrillic' | 'latin' | 'cjk' | 'other';

export function scriptForLang(lang: string): ScriptKind {
  const p = languagePrefix(lang);
  if (['ru', 'uk', 'be', 'bg', 'mk', 'sr', 'kk', 'ky', 'tg', 'mn'].includes(p)) return 'cyrillic';
  if (['zh', 'ja', 'ko'].includes(p)) return 'cjk';
  if (
    [
      'en',
      'de',
      'fr',
      'es',
      'it',
      'pt',
      'nl',
      'pl',
      'cs',
      'sk',
      'sv',
      'da',
      'no',
      'fi',
      'hu',
      'ro',
      'tr',
      'id',
      'vi',
      'lt',
      'lv',
      'et',
    ].includes(p)
  ) {
    return 'latin';
  }
  return 'other';
}

const CYRILLIC = /[\u0400-\u04FF]/g;
const LATIN = /[A-Za-z]/g;
const CJK = /[\u3040-\u30FF\u3400-\u9FFF]/g;

export function scriptCounts(text: string): { cyrillic: number; latin: number; cjk: number } {
  return {
    cyrillic: text.match(CYRILLIC)?.length ?? 0,
    latin: text.match(LATIN)?.length ?? 0,
    cjk: text.match(CJK)?.length ?? 0,
  };
}

export function isMostlyScript(text: string, script: ScriptKind): boolean {
  if (script === 'other') return false;
  const { cyrillic, latin, cjk } = scriptCounts(text);
  const total = cyrillic + latin + cjk;
  if (total < 8) return false;
  const n = script === 'cyrillic' ? cyrillic : script === 'latin' ? latin : cjk;
  return n / total > 0.7;
}

export function ownElementLang(el: Element): string {
  return languagePrefix(
    el.getAttribute('lang') ||
      el.getAttribute('xml:lang') ||
      el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ||
      '',
  );
}

/**
 * True when a block is already in the target language and should not be sent
 * for translation (bilingual books, leftover target paragraphs).
 */
export function isAlreadyTargetLanguage(
  text: string,
  sourceLang: string,
  targetLang: string,
): boolean {
  const src = languagePrefix(sourceLang);
  const dst = languagePrefix(targetLang);
  if (!src || !dst || src === dst) return false;
  const srcScript = scriptForLang(src);
  const dstScript = scriptForLang(dst);
  if (srcScript === 'other' || dstScript === 'other' || srcScript === dstScript) return false;
  return isMostlyScript(text, dstScript) && !isMostlyScript(text, srcScript);
}

export function shouldSkipTranslatedElement(
  el: Element,
  sourceLang: string,
  targetLang: string,
): boolean {
  const lang = ownElementLang(el);
  if (!lang) return false;
  const src = languagePrefix(sourceLang);
  const dst = languagePrefix(targetLang);
  return Boolean(dst) && lang === dst && lang !== src;
}
