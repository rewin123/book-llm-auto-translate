import { collectImageSrcs, collectLinkHrefs, markdownToPlainText } from './markdown.ts';

const REFUSAL_RE =
  /i cannot translate|i can't translate|as an ai|не могу перевести|отказ от перевода/i;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateTranslation(source: string, translation: string): ValidationResult {
  if (!translation.trim()) return { ok: false, reason: 'empty translation' };

  const srcText = markdownToPlainText(source);
  const dstText = markdownToPlainText(translation);
  if (srcText.length > 20 && dstText.length < Math.max(8, srcText.length * 0.15)) {
    return { ok: false, reason: 'translation too short' };
  }
  if (srcText.length > 20 && dstText.length > srcText.length * 8) {
    return { ok: false, reason: 'translation too long' };
  }
  if (REFUSAL_RE.test(dstText)) return { ok: false, reason: 'model refusal' };
  if (/<<<(?:END_)?(?:TRANSLATION|SOURCE|GLOSSARY)>>>/i.test(translation)) {
    return { ok: false, reason: 'harness tags in translation' };
  }

  for (const src of collectImageSrcs(source)) {
    if (!translation.includes(`](${src})`)) {
      return { ok: false, reason: `missing image ${src}` };
    }
  }

  for (const href of collectLinkHrefs(source)) {
    if (/^(https?:|mailto:)/i.test(href) || href.includes('/') || href.includes('.')) {
      if (!translation.includes(href)) return { ok: false, reason: `missing href ${href}` };
    }
  }

  return { ok: true };
}
