import { describe, expect, it } from 'vitest';
import { groupBigChunks, splitTranslateWindows } from '../../src/job/windows.ts';
import type { Chunk } from '../../src/ebook/types.ts';

function chunks(n: number): Chunk[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    documentPath: 'a',
    chapterTitle: 'A',
    markdown: `[${i}]`,
  }));
}

describe('groupBigChunks', () => {
  it('packs standard chunks into batches and keeps a short tail', () => {
    const bigs = groupBigChunks(chunks(10), 4);
    expect(bigs.map((b) => [b.id, b.from, b.to, b.markdown])).toEqual([
      [0, 0, 3, '[0][1][2][3]'],
      [1, 4, 7, '[4][5][6][7]'],
      [2, 8, 9, '[8][9]'],
    ]);
  });

  it('treats a batch of 1 as one call per chunk', () => {
    expect(groupBigChunks(chunks(3), 1)).toHaveLength(3);
  });
});

describe('splitTranslateWindows', () => {
  it('uses ceil(n / parallel) so 10/4 yields four windows', () => {
    expect(splitTranslateWindows(10, 4)).toEqual([
      { id: 0, from: 0, to: 3 },
      { id: 1, from: 3, to: 6 },
      { id: 2, from: 6, to: 9 },
      { id: 3, from: 9, to: 10 },
    ]);
  });

  it('keeps a single sequential window when parallel is 1', () => {
    expect(splitTranslateWindows(10, 1)).toEqual([{ id: 0, from: 0, to: 10 }]);
  });

  it('does not create empty windows when parallel exceeds the book', () => {
    expect(splitTranslateWindows(3, 5)).toEqual([
      { id: 0, from: 0, to: 1 },
      { id: 1, from: 1, to: 2 },
      { id: 2, from: 2, to: 3 },
    ]);
  });

  it('returns nothing for an empty book', () => {
    expect(splitTranslateWindows(0, 4)).toEqual([]);
  });
});
