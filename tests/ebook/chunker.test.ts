import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_CHARS,
  chunkMarkdown,
  chunksIntact,
  nextWordCut,
  noChunkSplitsFence,
  noChunkSplitsWord,
} from '../../src/ebook/chunk.ts';

describe('markdown chunker', () => {
  it('concatenates back to the chapter and never splits a fence', () => {
    const chapter = [
      '# Title\n\n',
      'First paragraph with *emphasis* and a [link](n.html).\n\n',
      'Second paragraph.\n\n',
      '![cover](images/cover.png)\n\n',
      'A slightly longer closing paragraph so packing has a chance to flush.\n',
    ].join('');
    const chunks = chunkMarkdown(chapter, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunksIntact(chapter, chunks)).toBe(true);
    expect(noChunkSplitsFence(chunks)).toBe(true);
    expect(noChunkSplitsWord(chapter, chunks)).toBe(true);
  });

  it('splits an oversized paragraph on word boundaries', () => {
    const p = `${'alpha beta gamma delta epsilon '.repeat(8)}`;
    const chunks = chunkMarkdown(p, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunksIntact(p, chunks)).toBe(true);
    expect(noChunkSplitsWord(p, chunks)).toBe(true);
  });

  it('does not cut a word in half at the character limit', () => {
    expect(DEFAULT_CHUNK_CHARS).toBe(5000);
    const src = 'alpha beta gamma';
    expect(src.slice(0, nextWordCut(src, 0, 8))).toBe('alpha ');
    expect(src.slice(nextWordCut(src, 0, 8))).toBe('beta gamma');
  });

  it('keeps an image target on one side of a cut', () => {
    const src = `${'word '.repeat(10)}![alt](images/cover.png) trailing text here`;
    const chunks = chunkMarkdown(src, 30);
    expect(chunksIntact(src, chunks)).toBe(true);
    expect(chunks.some((c) => c.includes('](images/cover.png)'))).toBe(true);
    expect(chunks.join('')).toContain('![alt](images/cover.png)');
  });
});
