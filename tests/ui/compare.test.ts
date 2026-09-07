import { describe, expect, it } from 'vitest';
import { comparePaneMarkdown, liveFollowIndex } from '../../src/ui/compareText.ts';

describe('comparePaneMarkdown', () => {
  it('keeps the original snapshot when chunk.markdown is later overwritten', () => {
    const chunk = { markdown: 'Hello Alice' };
    const pair = { original: 'Hello Alice', translation: 'Привет Алиса' };
    chunk.markdown = pair.translation;
    const panes = comparePaneMarkdown(chunk, pair);
    expect(panes.original).toBe('Hello Alice');
    expect(panes.translation).toBe('Привет Алиса');
    expect(panes.ready).toBe(true);
    expect(panes.original).not.toBe(panes.translation);
  });

  it('strips a leaked harness tag from a stored translation', () => {
    const chunk = { markdown: 'Hello Alice' };
    const pair = {
      original: 'Hello Alice',
      translation: '<<<TRANSLATION>>>\nПривет Алиса\n<<<END_TRANSLATION>>>',
    };
    const panes = comparePaneMarkdown(chunk, pair);
    expect(panes.translation).toBe('Привет Алиса');
    expect(panes.translation).not.toContain('TRANSLATION');
  });
});

describe('liveFollowIndex', () => {
  const done = (...indexes: number[]) => indexes.map((index) => ({ index }));

  it('stays one behind the in-flight chunk so the last translation is on screen', () => {
    expect(liveFollowIndex(1, done(0), 5)).toBe(0);
    expect(liveFollowIndex(3, done(0, 1, 2), 5)).toBe(2);
  });

  it('clamps to the first chunk while chunk 0 is still in flight', () => {
    expect(liveFollowIndex(0, [], 5)).toBe(0);
  });

  it('keeps the live index when that slot is already translated', () => {
    expect(liveFollowIndex(4, done(0, 1, 2, 3, 4), 5)).toBe(4);
    expect(liveFollowIndex(4, done(0, 1, 2, 3, 4), 5)).not.toBe(3);
  });
});
