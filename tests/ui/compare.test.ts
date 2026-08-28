import { describe, expect, it } from 'vitest';
import { comparePaneMarkdown } from '../../src/ui/compareText.ts';

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

  it('shows source on both sides while a chunk is still pending', () => {
    const chunk = { markdown: 'Hello Alice' };
    const panes = comparePaneMarkdown(chunk, undefined);
    expect(panes.original).toBe('Hello Alice');
    expect(panes.translation).toBe('Hello Alice');
    expect(panes.ready).toBe(false);
  });
});
