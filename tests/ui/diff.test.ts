import { describe, expect, it } from 'vitest';
import { annotateDiff, applyDiffMarkers, diffText } from '../../src/ui/diffText.ts';
import { reviewDiffHtml } from '../../src/ui/compareText.ts';

describe('diffText', () => {
  it('marks a replaced word as delete plus insert', () => {
    const ops = diffText('Alice was tired', 'Алиса was tired');
    expect(ops).toEqual([
      { type: 'del', text: 'Alice' },
      { type: 'ins', text: 'Алиса' },
      { type: 'eq', text: ' was tired' },
    ]);
  });

  it('is empty of edits when both sides match', () => {
    expect(diffText('same text', 'same text').every((op) => op.type === 'eq')).toBe(true);
  });
});

describe('reviewDiffHtml', () => {
  it('wraps the changed word in del on the before pane and ins on the after pane', () => {
    const panes = reviewDiffHtml({
      preReview: 'Alice was tired.',
      translation: 'Алиса was tired.',
    });
    expect(panes.changed).toBe(true);
    expect(panes.before).toContain('<del class="diff-del">');
    expect(panes.before).toContain('Alice');
    expect(panes.before).not.toContain('Алиса');
    expect(panes.after).toContain('<ins class="diff-ins">');
    expect(panes.after).toContain('Алиса');
    expect(panes.after).not.toContain('Alice');
  });

  it('does not mark a chunk the review pass left alone', () => {
    const panes = reviewDiffHtml({ translation: 'Алиса сидела на берегу.' });
    expect(panes.changed).toBe(false);
    expect(panes.before).toBe(panes.after);
    expect(panes.before).not.toContain('diff-del');
    expect(panes.after).not.toContain('diff-ins');
  });
});

describe('applyDiffMarkers', () => {
  it('turns private-use wraps into del/ins tags', () => {
    const md = annotateDiff(diffText('old word', 'new word'), 'after');
    expect(applyDiffMarkers(md)).toContain('<ins class="diff-ins">new</ins>');
  });
});
