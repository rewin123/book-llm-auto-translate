import { describe, expect, it } from 'vitest';
import { editStyleGuideline } from '../../src/verify/guide.ts';

describe('editStyleGuideline', () => {
  const guide = '## Names\nKeep Alice. Keep the cat.\n';

  it('replaces a unique substring', () => {
    const result = editStyleGuideline(guide, 'Keep Alice.', 'Keep Alice as Алиса.');
    expect(result).toEqual({
      ok: true,
      guide: '## Names\nKeep Alice as Алиса. Keep the cat.\n',
    });
  });

  it('rejects a missing substring', () => {
    expect(editStyleGuideline(guide, 'Bob', 'Роберт')).toEqual({
      ok: false,
      error: 'old_str was not found in the style guideline',
    });
  });

  it('rejects a substring that matches twice', () => {
    expect(editStyleGuideline(guide, 'Keep', 'Hold')).toEqual({
      ok: false,
      error: 'old_str matches 2 times; make it a unique substring',
    });
  });
});
