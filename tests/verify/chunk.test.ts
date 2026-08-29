import { describe, expect, it } from 'vitest';
import type { Chunk } from '../../src/ebook/types.ts';
import { longestChunkIndex } from '../../src/verify/chunk.ts';

function chunk(index: number, markdown: string): Chunk {
  return { index, documentPath: 'ch.xhtml', chapterTitle: 'Ch', markdown };
}

describe('longestChunkIndex', () => {
  it('picks the longest markdown and the earlier index on a tie', () => {
    expect(longestChunkIndex([chunk(0, 'aa'), chunk(1, 'bbbb'), chunk(2, 'ccc')])).toBe(1);
    expect(longestChunkIndex([chunk(0, 'aaaa'), chunk(1, 'bbbb'), chunk(2, 'cc')])).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(longestChunkIndex([])).toBe(0);
  });
});
