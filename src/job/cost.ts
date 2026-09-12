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

/**
 * The style and verifier passes were missing from the estimate entirely, so the
 * figure shown before the user commits could be roughly half the real bill.
 *
 * `runStyle` reads up to ten chunks across a handful of steps, and each step
 * resends the accumulated tool results — so its input grows with the square of
 * the step count rather than linearly.
 */
const STYLE_READS = 10;
const STYLE_STEPS = 6;
const STYLE_OUT_TOKENS = 900;

function styleAgentInputTokens(avgChars: number, sample: string, chunkCount: number): number {
  const reads = Math.min(STYLE_READS, Math.max(chunkCount, 1));
  const perRead = charsToTokens(avgChars, sample);
  // Step k resends the k reads so far, hence the triangular number.
  const resends = (STYLE_STEPS * (STYLE_STEPS + 1)) / 2;
  return STYLE_GUIDE_TOKENS * STYLE_STEPS + perRead * reads * (resends / STYLE_STEPS);
}

/**
 * The reviewer no longer gets the window inlined: it pulls each chunk's source
 * and translation through tools, and every step resends the transcript so far.
 * Cost therefore grows with the square of the step count, like the style agent.
 */
function reviewInputTokens(
  avgChars: number,
  sample: string,
  avgOutTokens: number,
  windowChunks: number,
): number {
  // Two reads per chunk, plus a step to write the note and a little slack for
  // edits and the neighbour reads the task asks for.
  const reads = windowChunks * 2 + 2;
  const steps = reads + 2;
  const perRead = (charsToTokens(avgChars, sample) + avgOutTokens) / 2;
  const resends = (steps * (steps + 1)) / 2;
  return (
    (STYLE_GUIDE_TOKENS + GLOSSARY_CAP_TOKENS) * steps + perRead * reads * (resends / steps)
  );
}

/**
 * The Guideline Verifier translates the longest chunk and then holds a chat, and
 * every turn re-embeds that chunk's original *and* translation.
 */
const VERIFY_TURNS = 4;
const VERIFY_OUT_TOKENS = 1200;

function verifyInputTokens(avgChars: number, sample: string, avgOutTokens: number): number {
  const perTurn = STYLE_GUIDE_TOKENS + charsToTokens(avgChars, sample) + avgOutTokens;
  return perTurn * VERIFY_TURNS;
}

export type CostOptions = {
  concurrency?: number;
  glossaryBatch?: number;
  reviewBatch?: number;
  /** Needed to price the output, which is written in the target's script. */
  targetLang?: string;
};

/**
 * Latin text runs ~4 characters per token, but Cyrillic and CJK are far denser.
 * Undercounting there made the estimate read as much cheaper than the bill.
 */
export function charsToTokens(chars: number, sample = ''): number {
  return Math.max(1, Math.ceil(chars / (isDenseScript(sample) ? 2 : 4)));
}

function isDenseScript(sample: string): boolean {
  return /[Ѐ-ӿ぀-ヿ一-鿿가-힯]/.test(sample);
}

/** Languages written in a script that packs roughly two characters per token. */
const DENSE_LANGS = new Set(['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'zh', 'ja', 'ko']);

/**
 * Characters per token for a language we have no text of yet.
 *
 * The output estimate used the *source* sample, so for the default `en → ru`
 * pair it counted Russian output at Latin density and undercut the more
 * expensive side of the price sheet by about half. The error inverted for
 * `ru → en`, so the figure was wrong in both directions.
 */
function charsPerTokenForLang(lang: string): number {
  return DENSE_LANGS.has(lang.toLowerCase().split('-')[0] ?? '') ? 2 : 4;
}

function charsToTokensForLang(chars: number, lang: string): number {
  return Math.max(1, Math.ceil(chars / charsPerTokenForLang(lang)));
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

  // The target language decides the output density. Falling back to the source
  // sample is only for callers that do not know the pair.
  const targetLang = opts.targetLang ?? '';
  const outTokens = (chars: number) =>
    targetLang ? charsToTokensForLang(chars, targetLang) : charsToTokens(chars, sample);

  const last2 = charsToTokens(avgChars, sample) + outTokens(avgChars);
  const perIn = charsToTokens(avgChars, sample) + STYLE_GUIDE_TOKENS + GLOSSARY_CAP_TOKENS + last2;
  const perOut = Math.ceil(outTokens(avgChars) * 1.15);
  const glossaryIn = glossaryCalls * (STYLE_GUIDE_TOKENS + charsToTokens(avgChars * glossaryBatch, sample));
  const glossaryOut = glossaryCalls * GLOSSARY_OUT_TOKENS;
  // A read returns the original *or* the translation, so the two densities are
  // averaged rather than both counted at the source's.
  const reviewIn =
    reviewCalls * reviewInputTokens(avgChars, sample, outTokens(avgChars), reviewBatch);
  const reviewOut = reviewCalls * REVIEW_OUT_TOKENS;
  const styleIn = styleAgentInputTokens(avgChars, sample, chunks.length);
  const verifyIn = verifyInputTokens(avgChars, sample, outTokens(avgChars));
  const inputTokens = Math.round(
    perIn * chunks.length + glossaryIn + reviewIn + styleIn + verifyIn,
  );
  const outputTokens = Math.round(
    perOut * chunks.length + glossaryOut + reviewOut + STYLE_OUT_TOKENS + VERIFY_OUT_TOKENS,
  );
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
