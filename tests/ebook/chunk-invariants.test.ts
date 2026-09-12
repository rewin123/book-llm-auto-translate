import { describe, expect, it } from 'vitest';
import {
  boundarySlack,
  chunkMarkdown,
  chunkMarkdownParts,
  chunksIntact,
  noChunkSplitsFence,
  noChunkSplitsSurrogate,
} from '../../src/ebook/chunk.ts';
import { joinMarkdown } from '../../src/ebook/markdown.ts';

const WORD = 'слово ';

/**
 * A single unmatched `<`, `](` or code fence used to mark the whole rest of a
 * chapter as "must not cut here", and the search for a safe offset ran to the
 * end of the document — so one chunk came back many times the limit and was
 * sent to the model as a single request.
 */
describe('chunk size limit', () => {
  const cases: [string, string][] = [
    ['clean prose', WORD.repeat(4000)],
    ['a bare < from a source &lt;', WORD.repeat(100) + '5 < 7 ' + WORD.repeat(3900)],
    ['an unclosed ](', WORD.repeat(100) + '](' + WORD.repeat(3900)],
    ['an unterminated code fence', '```\n' + WORD.repeat(4000)],
    ['many bare < signs', WORD.repeat(50) + ('a < b ' + WORD.repeat(200)).repeat(20)],
    ['a stray [ and ]', WORD.repeat(100) + '[x] ' + WORD.repeat(1000)],
  ];

  for (const [label, md] of cases) {
    it(`holds with ${label}`, () => {
      const chunks = chunkMarkdown(md, 5000);
      expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(5000 + boundarySlack(5000));
      expect(chunksIntact(md, chunks)).toBe(true);
    });
  }

  it('still keeps a real link target whole', () => {
    const md = `${WORD.repeat(800)}[текст](http://example.com/a/long/path.html)${WORD.repeat(800)}`;
    const chunks = chunkMarkdown(md, 5000);
    expect(chunksIntact(md, chunks)).toBe(true);
    expect(chunks.some((c) => c.includes('](http://example.com/a/long/path.html)'))).toBe(true);
  });
});

describe('chunk boundaries', () => {
  it('never splits a surrogate pair', () => {
    const md = 'aa\u{1F600}bb'.repeat(2000);
    const chunks = chunkMarkdown(md, 101);
    expect(noChunkSplitsSurrogate(chunks)).toBe(true);
    expect(chunksIntact(md, chunks)).toBe(true);
  });

  it('does not flag a backtick run in prose as a split fence', () => {
    expect(noChunkSplitsFence(['use ``` to fence'])).toBe(true);
  });

  it('still flags a genuinely split fence', () => {
    expect(noChunkSplitsFence(['```\ncode'])).toBe(false);
  });
});

describe('mid-paragraph seams', () => {
  it('flags every piece after the first when one block is split', () => {
    const parts = chunkMarkdownParts(WORD.repeat(1000), 2000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.joinWith).toBeUndefined();
    expect(parts.slice(1).every((p) => p.joinWith === 'space')).toBe(true);
  });

  it('does not flag separate blocks', () => {
    const parts = chunkMarkdownParts('# One\n\nAAA\n\n# Two\n\nBBB', 5000);
    expect(parts.every((p) => p.joinWith === undefined)).toBe(true);
  });

  it('rejoins a split paragraph as one paragraph', () => {
    const parts = chunkMarkdownParts(WORD.repeat(1000), 2000);
    const rejoined = joinMarkdown(
      parts.map((p) => p.markdown),
      parts.map((p) => p.joinWith),
    );
    expect(rejoined.trim()).not.toContain('\n\n');
  });
});

/** Randomised sweep over the characters that used to defeat the chunker. */
describe('randomised chunking', () => {
  it('respects the limit and loses nothing across many shapes', () => {
    const tokens = ['слово ', 'word ', '< ', '> ', '](', '[x] ', '```\n', '\n\n', '_a_ ', '*b* ', '\u{1F600} ', '`c` '];
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let run = 0; run < 300; run += 1) {
      let md = '';
      const len = 200 + Math.floor(rand() * 600);
      for (let i = 0; i < len; i += 1) md += tokens[Math.floor(rand() * tokens.length)]!;
      const max = 200 + Math.floor(rand() * 800);
      const chunks = chunkMarkdown(md, max);
      expect(chunksIntact(md, chunks)).toBe(true);
      expect(noChunkSplitsSurrogate(chunks)).toBe(true);
      const longest = Math.max(0, ...chunks.map((c) => c.length));
      expect(longest).toBeLessThanOrEqual(max + boundarySlack(max));
    }
  });
});
