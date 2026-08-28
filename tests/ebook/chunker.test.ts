import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_CHARS,
  chunkMarkup,
  chunksIntact,
  nextWordCut,
  noChunkSplitsTag,
  noChunkSplitsWord,
} from '../../src/ebook/chunk.ts';

describe('chunker', () => {
  it('concatenates back to the chapter and never splits a tag', () => {
    const chapter = [
      '<h1 id="c1">Title</h1>',
      '<p>First paragraph with <em>emphasis</em> and a <a href="n.html">link</a>.</p>',
      '<p>Second paragraph.</p>',
      '<p><img src="images/cover.png" alt="cover" id="img1"/></p>',
      '<p>A slightly longer closing paragraph so packing has a chance to flush.</p>',
    ].join('');
    const chunks = chunkMarkup(chapter, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunksIntact(chapter, chunks)).toBe(true);
    expect(noChunkSplitsTag(chunks)).toBe(true);
    expect(noChunkSplitsWord(chapter, chunks)).toBe(true);
  });

  it('splits an oversized paragraph on word boundaries', () => {
    const p = `<p>${'alpha beta gamma delta epsilon '.repeat(8)}</p>`;
    const chunks = chunkMarkup(p, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunksIntact(p, chunks)).toBe(true);
    expect(noChunkSplitsTag(chunks)).toBe(true);
    expect(noChunkSplitsWord(p, chunks)).toBe(true);
    expect(chunks.some((c) => c.includes('<p>'))).toBe(true);
  });

  it('does not cut a word in half at the character limit', () => {
    expect(DEFAULT_CHUNK_CHARS).toBe(5000);
    const src = 'alpha beta gamma';
    // 8 chars would land inside "beta" (index of 't')
    expect(src.slice(0, nextWordCut(src, 0, 8))).toBe('alpha ');
    expect(src.slice(nextWordCut(src, 0, 8))).toBe('beta gamma');
  });
});
