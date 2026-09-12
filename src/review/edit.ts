import { validateTranslation } from '../ebook/validate.ts';

/** Replace a substring that must occur exactly once in `text`. */
export function replaceOnce(
  text: string,
  oldStr: string,
  newStr: string,
): { ok: true; text: string } | { ok: false; error: string } {
  if (!oldStr) return { ok: false, error: 'old is empty' };
  const count = text.split(oldStr).length - 1;
  if (count === 0) return { ok: false, error: 'old was not found in this chunk' };
  if (count > 1) {
    return {
      ok: false,
      error: `old matches ${count} times in this chunk; make it a unique substring`,
    };
  }
  return { ok: true, text: text.replace(oldStr, () => newStr) };
}

export function formatEditResult(result: { ok: true } | { ok: false; error: string }): string {
  return result.ok ? 'ok' : `err: ${result.error}`;
}

export type ChunkEditResult<T> = { result: string; pair: T };

/**
 * Edit one chunk's translation in place. The match must be unique *within the
 * chunk*, so a replacement can never span a chunk boundary — the reviewer's
 * edits stay where the reviewer aimed them and the book keeps its chunking.
 */
export function applyChunkEdit<
  T extends {
    translation: string;
    original: string;
    usedOriginal?: boolean;
    reason?: string;
    preReview?: string;
  },
>(pair: T, oldStr: string, newStr: string): ChunkEditResult<T> {
  const replaced = replaceOnce(pair.translation, oldStr, newStr);
  if (!replaced.ok) return { result: formatEditResult(replaced), pair };
  const check = validateTranslation(pair.original, replaced.text);
  if (!check.ok) return { result: `err: ${check.reason}`, pair };
  return { result: 'ok', pair: applyReviewedTranslation(pair, replaced.text) };
}

/** Keep the first pre-review snapshot when the review pass rewrites a chunk. */
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
