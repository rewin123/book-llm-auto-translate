import type { Chunk } from '../ebook/types.ts';
import { lookupCost } from '../llm/modelsDev.ts';
import type { CostEstimate } from './types.ts';
import { groupReviewWindows } from './windows.ts';

const STYLE_GUIDE_TOKENS = 1500;
const GLOSSARY_CAP_TOKENS = 800;
const GLOSSARY_OUT_TOKENS = 400;
/** Before any real timings exist, assume a sequential call takes about this long. */
const ASSUMED_MS_PER_CHUNK = 9000;
const ASSUMED_MS_PER_GLOSSARY = 7000;
const ASSUMED_MS_PER_REVIEW = 12_000;
const REVIEW_OUT_TOKENS = 600;

export type CostOptions = {
  concurrency?: number;
  glossaryBatch?: number;
  reviewBatch?: number;
};

/**
 * Latin text runs ~4 characters per token, but Cyrillic and CJK are far denser.
 * Undercounting there made the estimate read as much cheaper than the bill.
 */
export function charsToTokens(chars: number, sample = ''): number {
  const dense = /[Ѐ-ӿ぀-ヿ一-鿿가-힯]/.test(sample);
  return Math.max(1, Math.ceil(chars / (dense ? 2 : 4)));
}

export async function estimateCost(
  chunks: Chunk[],
  providerId: string,
  model: string,
  opts: CostOptions = {},
): Promise<CostEstimate> {
  const n = Math.max(chunks.length, 1);
  const sample = chunks[0]?.markdown.slice(0, 2000) ?? '';
  const avgChars = chunks.reduce((s, c) => s + c.markdown.length, 0) / n;
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const glossaryBatch = Math.max(1, opts.glossaryBatch ?? 4);
  const reviewBatch = Math.max(1, opts.reviewBatch ?? 5);
  const glossaryCalls = Math.ceil(chunks.length / glossaryBatch);
  const reviewCalls = groupReviewWindows(chunks.length, reviewBatch).length;

  const last2 = charsToTokens(avgChars * 2, sample);
  const perIn = charsToTokens(avgChars, sample) + STYLE_GUIDE_TOKENS + GLOSSARY_CAP_TOKENS + last2;
  const perOut = Math.ceil(charsToTokens(avgChars, sample) * 1.15);
  const glossaryIn = glossaryCalls * (STYLE_GUIDE_TOKENS + charsToTokens(avgChars * glossaryBatch, sample));
  const glossaryOut = glossaryCalls * GLOSSARY_OUT_TOKENS;
  const reviewWindowChars = avgChars * reviewBatch;
  const reviewIn =
    reviewCalls *
    (STYLE_GUIDE_TOKENS + GLOSSARY_CAP_TOKENS + charsToTokens(reviewWindowChars * 2, sample));
  const reviewOut = reviewCalls * REVIEW_OUT_TOKENS;
  const inputTokens = Math.round(perIn * chunks.length + glossaryIn + reviewIn);
  const outputTokens = Math.round(perOut * chunks.length + glossaryOut + reviewOut);
  const cost = await lookupCost(providerId, model);
  let usd: number | null = null;
  if (cost.inputPerMillion != null && cost.outputPerMillion != null) {
    usd =
      (inputTokens / 1_000_000) * cost.inputPerMillion +
      (outputTokens / 1_000_000) * cost.outputPerMillion;
  }
  const translateEta = (chunks.length * ASSUMED_MS_PER_CHUNK) / concurrency;
  const reviewEta = (reviewCalls * ASSUMED_MS_PER_REVIEW) / concurrency;
  return {
    chunks: chunks.length,
    inputTokens,
    outputTokens,
    usd,
    etaMs: Math.round(glossaryCalls * ASSUMED_MS_PER_GLOSSARY + translateEta + reviewEta),
    model,
    priceKnown: cost.source !== 'unknown',
  };
}

/** Scale a whole-book estimate down to the first `chunkCount` chunks. */
export function scaleCost(cost: CostEstimate, chunkCount: number): CostEstimate {
  const total = Math.max(cost.chunks, 1);
  const n = Math.min(Math.max(Math.round(chunkCount), 0), total);
  if (n === total) return cost;
  const f = n / total;
  return {
    ...cost,
    chunks: n,
    inputTokens: Math.round(cost.inputTokens * f),
    outputTokens: Math.round(cost.outputTokens * f),
    usd: cost.usd == null ? null : cost.usd * f,
    etaMs: cost.etaMs == null ? null : Math.round(cost.etaMs * f),
  };
}

/** Mean of the most recent accepted chunks — steadier than an all-time average. */
export function etaFromTimings(
  msPerChunk: number[],
  remaining: number,
  concurrency = 1,
): number | null {
  const recent = msPerChunk.filter((m) => m > 0).slice(-8);
  if (recent.length === 0 || remaining <= 0) return null;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  return Math.round((mean * remaining) / Math.max(1, concurrency));
}
