import { describe, expect, it } from 'vitest';
import { validateTranslation } from '../../src/ebook/validate.ts';

describe('translation validation', () => {
  const src = '<p id="p1">Hello <em>world</em> <a href="n.html">go</a></p>';

  it('accepts matching markup', () => {
    const dst = '<p id="p1">Привет <em>мир</em> <a href="n.html">далее</a></p>';
    expect(validateTranslation(src, dst).ok).toBe(true);
  });

  it('rejects tag mismatch, missing href, emptiness, and refusals', () => {
    expect(validateTranslation(src, '<p id="p1">Hi</p>').ok).toBe(false);
    expect(validateTranslation(src, '<p id="p1">Hello <em>world</em> <a href="x.html">go</a></p>').ok).toBe(
      false,
    );
    expect(validateTranslation(src, '').ok).toBe(false);
    expect(validateTranslation(src, '<p id="p1">I cannot translate this <em>x</em> <a href="n.html">g</a></p>').ok).toBe(
      false,
    );
  });
});
