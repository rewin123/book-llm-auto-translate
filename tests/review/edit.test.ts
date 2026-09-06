import { describe, expect, it } from 'vitest';
import { applyReviewEdit, editTranslateParts, formatEditResult } from '../../src/review/edit.ts';

describe('editTranslateParts', () => {
  it('replaces a unique substring inside one chunk', () => {
    const result = editTranslateParts(['aaa', 'bbb', 'ccc'], 'bb', 'XY');
    expect(result).toEqual({ ok: true, parts: ['aaa', 'XYb', 'ccc'] });
  });

  it('keeps concatenation when the match spans a seam', () => {
    const result = editTranslateParts(['He said', 'hello.'], 'saidhello', 'said hello');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.join('')).toBe('He said hello.');
    expect(result.parts).toHaveLength(2);
  });

  it('rejects a missing substring', () => {
    expect(editTranslateParts(['aaa'], 'zzz', 'q')).toEqual({
      ok: false,
      error: 'old_str was not found in the translation',
    });
  });

  it('rejects a substring that matches twice', () => {
    expect(editTranslateParts(['keep keep'], 'keep', 'hold')).toEqual({
      ok: false,
      error: 'old_str matches 2 times; make it a unique substring',
    });
  });

  it('rejects an empty old_str', () => {
    expect(editTranslateParts(['aaa'], '', 'x')).toEqual({
      ok: false,
      error: 'old_str is empty',
    });
  });

  it('formats ok and err for the agent tool', () => {
    expect(formatEditResult({ ok: true })).toBe('ok');
    expect(formatEditResult({ ok: false, error: 'nope' })).toBe('err: nope');
  });

  it('mutates parts on a valid edit and rejects one that empties the translation', () => {
    const parts = ['Alice was beginning to get very tired of sitting by her sister on the bank.'];
    const original = parts[0]!;
    expect(applyReviewEdit(parts, original, 'Alice', 'Алиса')).toBe('ok');
    expect(parts[0]).toContain('Алиса');
    expect(applyReviewEdit(parts, original, parts[0]!, '')).toBe('err: empty translation');
    expect(parts[0]).toContain('Алиса');
  });
});
