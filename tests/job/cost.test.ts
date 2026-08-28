import { describe, expect, it } from 'vitest';
import { scaleCost } from '../../src/job/cost.ts';
import type { CostEstimate } from '../../src/job/types.ts';

const full: CostEstimate = {
  chunks: 10,
  inputTokens: 1000,
  outputTokens: 200,
  usd: 1,
  etaMs: 90_000,
  model: 'mock',
  priceKnown: true,
};

describe('scaleCost', () => {
  it('returns the same estimate when the limit is the whole book', () => {
    expect(scaleCost(full, 10)).toEqual(full);
  });

  it('scales tokens, money and time to a prefix of the book', () => {
    expect(scaleCost(full, 4)).toEqual({
      ...full,
      chunks: 4,
      inputTokens: 400,
      outputTokens: 80,
      usd: 0.4,
      etaMs: 36_000,
    });
  });
});
