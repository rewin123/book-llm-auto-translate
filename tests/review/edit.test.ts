import { describe, expect, it } from 'vitest';
import { applyChunkEdit, applyReviewedTranslation, formatEditResult, replaceOnce } from '../../src/review/edit.ts';
import type { TranslatedPair } from '../../src/job/types.ts';

describe('replaceOnce', () => {
  it('replaces a unique substring', () => {
    expect(replaceOnce('aaa bbb ccc', 'bbb', 'XY')).toEqual({ ok: true, text: 'aaa XY ccc' });
  });

  it('treats the replacement as a literal, not a pattern', () => {
    expect(replaceOnce('cost: X', 'X', '$& $1')).toEqual({ ok: true, text: 'cost: $& $1' });
  });

  it('rejects a missing substring', () => {
    expect(replaceOnce('aaa', 'zzz', 'q')).toEqual({
      ok: false,
      error: 'old was not found in this chunk',
    });
  });

  it('rejects a substring that matches twice', () => {
    expect(replaceOnce('keep keep', 'keep', 'hold')).toEqual({
      ok: false,
      error: 'old matches 2 times in this chunk; make it a unique substring',
    });
  });

  it('rejects an empty old', () => {
    expect(replaceOnce('aaa', '', 'x')).toEqual({ ok: false, error: 'old is empty' });
  });

  it('formats ok and err for the agent tool', () => {
    expect(formatEditResult({ ok: true })).toBe('ok');
    expect(formatEditResult({ ok: false, error: 'nope' })).toBe('err: nope');
  });
});

describe('applyChunkEdit', () => {
  const pair = (): TranslatedPair => ({
    index: 1,
    original: 'Alice was beginning to get very tired of sitting by her sister on the bank.',
    translation: 'Alice начала уставать сидеть рядом с сестрой на берегу.',
  });

  it('edits the chunk and snapshots the pre-review text', () => {
    const { result, pair: next } = applyChunkEdit(pair(), 'Alice', 'Алиса');
    expect(result).toBe('ok');
    expect(next.translation).toContain('Алиса');
    expect(next.preReview).toBe(pair().translation);
  });

  it('never edits across a chunk boundary: a seam-spanning old is not found', () => {
    // The tail of chunk 1 plus the head of chunk 2 only exists in the joined
    // book, never inside one chunk — so the replace is refused instead of
    // silently rewriting one side of the seam.
    const { result, pair: next } = applyChunkEdit(pair(), 'берегу.Алиса', 'берегу. Алиса');
    expect(result).toBe('err: old was not found in this chunk');
    expect(next).toEqual(pair());
  });

  it('rejects an edit that fails the chunk validator and keeps the pair untouched', () => {
    const before = pair();
    const { result, pair: next } = applyChunkEdit(before, before.translation, '');
    expect(result).toBe('err: empty translation');
    expect(next).toBe(before);
  });

  it('rejects an edit that drops an image the chunk must keep', () => {
    const withImage: TranslatedPair = {
      index: 0,
      original: 'See ![cat](img/cat.png) here.',
      translation: 'Смотри ![кот](img/cat.png) здесь.',
    };
    const { result, pair: next } = applyChunkEdit(withImage, '![кот](img/cat.png)', 'картинка');
    expect(result).toBe('err: missing image img/cat.png');
    expect(next).toBe(withImage);
  });
});

describe('applyReviewedTranslation', () => {
  const pair: TranslatedPair = {
    index: 0,
    original: 'Alice',
    translation: 'Алиса',
  };

  it('snapshots the first translation and keeps it across later edits', () => {
    const once = applyReviewedTranslation(pair, 'Алиска');
    expect(once.preReview).toBe('Алиса');
    expect(once.translation).toBe('Алиска');
    const twice = applyReviewedTranslation(once, 'Алисе');
    expect(twice.preReview).toBe('Алиса');
    expect(twice.translation).toBe('Алисе');
  });

  it('returns the same object when the text did not change', () => {
    expect(applyReviewedTranslation(pair, 'Алиса')).toBe(pair);
  });
});
