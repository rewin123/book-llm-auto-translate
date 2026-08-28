import { describe, expect, it } from 'vitest';
import { validateTranslation } from '../../src/ebook/validate.ts';

describe('translation validation', () => {
  const src =
    'Hello *world* and a [go](n.html) plus ![cover](images/cover.png).';

  it('accepts matching markdown', () => {
    const dst =
      'Привет *мир* and a [далее](n.html) plus ![обложка](images/cover.png).';
    expect(validateTranslation(src, dst).ok).toBe(true);
  });

  it('rejects a missing image, emptiness, and refusals', () => {
    expect(validateTranslation(src, 'Привет *мир* [далее](n.html).').ok).toBe(false);
    expect(validateTranslation(src, '').ok).toBe(false);
    expect(
      validateTranslation(
        src,
        'I cannot translate this *x* [g](n.html) ![cover](images/cover.png).',
      ).ok,
    ).toBe(false);
  });

  it('does not require identical emphasis markers', () => {
    const dst = 'Привет **мир** and a [далее](n.html) plus ![обложка](images/cover.png).';
    expect(validateTranslation(src, dst).ok).toBe(true);
  });
});
