import { describe, expect, it } from 'vitest';
import { estimateCost } from '../../src/job/cost.ts';
import type { Chunk } from '../../src/ebook/types.ts';

function latinChunks(count: number, chars: number): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    documentPath: `c${i}.xhtml`,
    chapterTitle: 'One',
    markdown: 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars),
  }));
}

/**
 * The output estimate used the *source* sample's script, so for the default
 * `en → ru` pair it priced Russian output at Latin density and undercut the more
 * expensive side of the price sheet by about half. The error inverted for
 * `ru → en`, so the figure was wrong in both directions.
 */
describe('output token density follows the target language', () => {
  it('counts a dense target as about twice the tokens of a Latin one', async () => {
    const chunks = latinChunks(20, 5000);
    const toRussian = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'ru' });
    const toGerman = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'de' });
    const ratio = toRussian.outputTokens / toGerman.outputTokens;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.1);
  });

  it('treats CJK targets as dense too', async () => {
    const chunks = latinChunks(10, 4000);
    const toJapanese = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'ja' });
    const toSpanish = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'es' });
    expect(toJapanese.outputTokens).toBeGreaterThan(toSpanish.outputTokens);
  });

  it('accepts a region-tagged target', async () => {
    const chunks = latinChunks(5, 2000);
    const tagged = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'zh-Hans' });
    const plain = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'zh' });
    expect(tagged.outputTokens).toBe(plain.outputTokens);
  });
});

/**
 * The style-agent pass and the whole Guideline Verifier pass were missing, so the
 * figure shown before the user commits could be roughly half the real bill.
 */
describe('the estimate covers every pass that runs', () => {
  it('prices more input than the translate pass alone would need', async () => {
    const chunks = latinChunks(20, 5000);
    const estimate = await estimateCost(chunks, 'mock', 'mock-reverse', { targetLang: 'ru' });
    // 20 chunks x (1250 source + 1500 guide + 800 glossary + ~3750 previous two)
    const translateOnly = 20 * (1250 + 1500 + 800 + 3750);
    expect(estimate.inputTokens).toBeGreaterThan(translateOnly);
  });

  it('scales with the book', async () => {
    const small = await estimateCost(latinChunks(5, 5000), 'mock', 'mock-reverse', {
      targetLang: 'ru',
    });
    const large = await estimateCost(latinChunks(50, 5000), 'mock', 'mock-reverse', {
      targetLang: 'ru',
    });
    expect(large.inputTokens).toBeGreaterThan(small.inputTokens * 5);
  });

  it('handles an empty book without dividing by zero', async () => {
    const estimate = await estimateCost([], 'mock', 'mock-reverse', { targetLang: 'ru' });
    expect(Number.isFinite(estimate.inputTokens)).toBe(true);
    expect(estimate.chunks).toBe(0);
  });
});
