import { validateTranslation } from '../ebook/validate.ts';

/** Surgical replace across concatenated chunk translations. `oldStr` must occur once. */
export function editTranslateParts(
  parts: string[],
  oldStr: string,
  newStr: string,
): { ok: true; parts: string[] } | { ok: false; error: string } {
  if (!oldStr) return { ok: false, error: 'old_str is empty' };
  const joined = parts.join('');
  const count = joined.split(oldStr).length - 1;
  if (count === 0) return { ok: false, error: 'old_str was not found in the translation' };
  if (count > 1) {
    return {
      ok: false,
      error: `old_str matches ${count} times; make it a unique substring`,
    };
  }

  const start = joined.indexOf(oldStr);
  const end = start + oldStr.length;
  const next: string[] = [];
  let offset = 0;
  let placed = false;
  for (const part of parts) {
    const partStart = offset;
    const partEnd = offset + part.length;
    offset = partEnd;
    if (partEnd <= start || partStart >= end) {
      next.push(part);
      continue;
    }
    const prefix = partStart < start ? part.slice(0, start - partStart) : '';
    const suffix = partEnd > end ? part.slice(end - partStart) : '';
    if (!placed) {
      next.push(prefix + newStr + suffix);
      placed = true;
    } else {
      next.push(suffix);
    }
  }
  return { ok: true, parts: next };
}

export function formatEditResult(result: { ok: true } | { ok: false; error: string }): string {
  return result.ok ? 'ok' : `err: ${result.error}`;
}

/** Apply a unique replace, then reject it if the window would fail translation checks. */
export function applyReviewEdit(
  parts: string[],
  originalJoined: string,
  oldStr: string,
  newStr: string,
): string {
  const result = editTranslateParts(parts, oldStr, newStr);
  if (!result.ok) return formatEditResult(result);
  const check = validateTranslation(originalJoined, result.parts.join(''));
  if (!check.ok) return `err: ${check.reason}`;
  for (let i = 0; i < parts.length; i++) parts[i] = result.parts[i]!;
  return 'ok';
}

/** Keep the first pre-review snapshot when the seam pass rewrites a chunk. */
export function applyReviewedTranslation<
  T extends {
    translation: string;
    original: string;
    usedOriginal?: boolean;
    reason?: string;
    preReview?: string;
  },
>(pair: T, next: string): T {
  if (next === pair.translation) return pair;
  return {
    ...pair,
    preReview: pair.preReview ?? pair.translation,
    translation: next,
    usedOriginal: next === pair.original ? pair.usedOriginal : false,
    reason: next === pair.original ? pair.reason : undefined,
  };
}
