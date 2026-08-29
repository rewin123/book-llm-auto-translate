import { describe, expect, it } from 'vitest';
import { chapterChunkRanges, formatChapterList } from '../../src/ebook/chapters.ts';
import type { Chunk } from '../../src/ebook/types.ts';

function chunk(index: number, title: string, path = 'ch.xhtml'): Chunk {
  return { index, documentPath: path, chapterTitle: title, markdown: `c${index}` };
}

describe('chapter ranges', () => {
  it('groups consecutive chunks that share a title', () => {
    const ranges = chapterChunkRanges([
      chunk(0, 'Opening'),
      chunk(1, 'Opening'),
      chunk(2, 'Redemption'),
      chunk(3, 'Redemption'),
      chunk(4, 'Redemption'),
    ]);
    expect(ranges).toEqual([
      { title: 'Opening', documentPath: 'ch.xhtml', from: 0, to: 1 },
      { title: 'Redemption', documentPath: 'ch.xhtml', from: 2, to: 4 },
    ]);
  });

  it('formats 1-based ranges for the style-agent user message', () => {
    const list = formatChapterList([chunk(0, 'Искупление'), chunk(1, 'Искупление'), chunk(2, '')]);
    expect(list).toContain('# Искупление (chunks from 1 to 2)');
    expect(list).toContain('# Untitled 2 (chunks from 3 to 3)');
  });
});
