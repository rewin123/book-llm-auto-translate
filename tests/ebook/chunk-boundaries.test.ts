import { describe, expect, it } from 'vitest';
import { boundarySlack, chunkMarkdown, chunksIntact, nextWordCut } from '../../src/ebook/chunk.ts';

/**
 * Cutting at the nearest word boundary ignored far better places to split that
 * sat a few dozen characters away. A chunk that ends at a section or paragraph
 * break is a complete thought for the model; one that ends mid-sentence is not,
 * and its seam has to be stitched back together after translation.
 *
 * Ranked best to worst: section -> paragraph -> line -> sentence -> word.
 */
describe('boundary ranking', () => {
  /** Filler with no internal break, so only the planted boundary can be chosen. */
  const run = (n: number) => 'слово'.padEnd(6, 'x').repeat(Math.ceil(n / 6)).slice(0, n);

  it('prefers a heading over a nearer word break', () => {
    const head = `${run(200)} ${run(200)}\n`;
    const md = `${head}# Глава 2\n\nхвост текста`;
    // The ideal offset lands inside the first paragraph; the heading is later.
    const cut = nextWordCut(md, 0, head.length - 40);
    expect(md.slice(cut)).toBe('# Глава 2\n\nхвост текста');
  });

  it('prefers a paragraph break over a nearer word break', () => {
    const md = `${run(300)}\n\n${run(300)}`;
    const cut = nextWordCut(md, 0, 280);
    expect(cut).toBe(302);
    expect(md.slice(cut)).toBe(run(300));
  });

  it('prefers a line break over a sentence or word break', () => {
    const md = `Первая строка. Ещё слова тут.\nВторая строка идёт следом и она длинная.`;
    const cut = nextWordCut(md, 0, 24);
    expect(md.slice(cut)).toBe('Вторая строка идёт следом и она длинная.');
  });

  it('prefers a sentence end over a plain word break', () => {
    const md = 'Одно два три. Четыре пять шесть семь восемь девять десять.';
    const cut = nextWordCut(md, 0, 16);
    expect(md.slice(0, cut)).toBe('Одно два три. ');
  });

  it('takes a word break when nothing better is in range', () => {
    const md = `${run(100)} ${run(100)}`;
    const cut = nextWordCut(md, 0, 100);
    expect(md[cut - 1]).toBe(' ');
  });

  it('treats ! and ? as sentence ends too', () => {
    const md = 'Как дела? Всё хорошо, спасибо тебе большое за это.';
    const cut = nextWordCut(md, 0, 14);
    expect(md.slice(0, cut)).toBe('Как дела? ');
  });

  it('ranks a thematic break as a section', () => {
    const md = `${run(200)}\n---\n${run(200)}`;
    const cut = nextWordCut(md, 0, 180);
    expect(md.slice(cut).startsWith('---')).toBe(true);
  });

  it('picks the candidate closest to the ideal offset within a rank', () => {
    const md = `${run(100)}\n\n${run(100)}\n\n${run(100)}`;
    // Both paragraph breaks are in range; the second is nearer to 210.
    expect(nextWordCut(md, 0, 210)).toBe(204);
  });
});

describe('the search window', () => {
  it('does not look further than the slack allows', () => {
    // The only break sits well beyond the window, so the cut must not reach it.
    const md = 'a'.repeat(4000) + '\n\n' + 'b'.repeat(100);
    const cut = nextWordCut(md, 0, 1000);
    expect(cut).toBeLessThanOrEqual(1000 + boundarySlack(1000));
  });

  it('never returns an offset at or before the start', () => {
    const md = 'a'.repeat(5000);
    expect(nextWordCut(md, 0, 100)).toBeGreaterThan(0);
    expect(nextWordCut(md, 4990, 100)).toBe(md.length);
  });

  it('scales the window down with the chunk size', () => {
    expect(boundarySlack(5000)).toBe(1000);
    expect(boundarySlack(20_000)).toBe(1000);
    expect(boundarySlack(400)).toBe(200);
    expect(boundarySlack(1)).toBe(1);
  });
});

/**
 * A heading translated on its own, at the tail of a chunk, loses the section it
 * titles — and that section then starts without its heading.
 */
describe('headings travel with their section', () => {
  const para = (n: number) => `${'текст слово '.repeat(n).trim()}.`;
  const md = ['# Глава 1', '', para(20), '', '# Глава 2', '', para(20), '', '# Глава 3', '', para(20)].join('\n');

  it('does not leave a heading at the end of a chunk', () => {
    for (const max of [260, 300, 400, 600]) {
      for (const chunk of chunkMarkdown(md, max)) {
        expect(chunk.trimEnd().split('\n').pop()).not.toMatch(/^#{1,6} /);
      }
      expect(chunksIntact(md, chunkMarkdown(md, max))).toBe(true);
    }
  });

  it('starts the next chunk with the heading instead', () => {
    const chunks = chunkMarkdown(md, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.filter((c) => /^#{1,6} /.test(c.trimStart())).length).toBeGreaterThan(1);
  });

  it('still cuts when a heading is all there is', () => {
    const headings = ['# A', '# B', '# C'].join('\n\n');
    expect(chunksIntact(headings, chunkMarkdown(headings, 6))).toBe(true);
  });
});

/** The ranking must not cost any of the guarantees the chunker already had. */
describe('ranking keeps the existing invariants', () => {
  const prose = [
    '# Глава 1',
    '',
    'Первый абзац с несколькими предложениями. Второй тоже здесь. И третий.',
    'Мягкий перенос строки внутри абзаца.',
    '',
    'Другой абзац, ещё длиннее прежнего, с запятыми и прочим.',
    '',
    '## Подраздел',
    '',
    'Текст со ссылкой [подпись](http://example.com/a/long/path.html) в середине.',
  ].join('\n');
  const md = `${prose}\n\n`.repeat(40);

  it('loses nothing and respects the limit', () => {
    for (const max of [400, 800, 2000, 5000]) {
      const chunks = chunkMarkdown(md, max);
      expect(chunksIntact(md, chunks)).toBe(true);
      expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(max + boundarySlack(max));
    }
  });

  it('keeps link targets whole', () => {
    for (const max of [400, 800, 2000]) {
      for (const chunk of chunkMarkdown(md, max)) {
        // A chunk never ends between `](` and the closing paren.
        expect(/\]\([^)]*$/.test(chunk)).toBe(false);
      }
    }
  });

  it('ends most chunks on a real break rather than mid-sentence', () => {
    const chunks = chunkMarkdown(md, 2000);
    const clean = chunks.filter((c) => /(\n|[.!?]\s*)$/.test(c)).length;
    expect(clean / chunks.length).toBeGreaterThan(0.9);
  });
});
