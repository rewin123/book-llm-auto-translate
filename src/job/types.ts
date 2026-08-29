import type { Chunk } from '../ebook/types.ts';
import type { GlossaryEntry } from '../glossary/index.ts';
import type { ProviderId } from '../llm/presets.ts';
import type { FailureKind } from '../llm/net.ts';

export type JobPhase =
  | 'idle'
  | 'style'
  | 'review'
  | 'glossary'
  | 'glossaryReview'
  | 'translate'
  | 'paused'
  | 'done'
  | 'error';

export type JobSettings = {
  sourceLang: string;
  targetLang: string;
  chunkChars: number;
  logLimit: number;
  providerId: ProviderId;
  model: string;
  /** Parallel sequential translate windows. */
  concurrency: number;
  /** Standard chunks packed into one glossary LLM call. */
  glossaryBatch: number;
  /** Reserved for a future review pass. Stored so the UI can collect it now. */
  reviewBatch: number;
};

/** One LLM round-trip for a chunk, stored raw so it can be inspected later. */
export type LlmCallAttempt = {
  instructions: string;
  user: string;
  response: string;
};

export type TranslatedPair = {
  index: number;
  original: string;
  translation: string;
  /** Validation never passed, so the source text was kept in the output. */
  usedOriginal?: boolean;
  /** Validator verdict when `usedOriginal`. */
  reason?: string;
  /** Wall time of the accepted call, used for the running ETA. */
  ms?: number;
  /** Every attempt for this chunk (including failed validation retries). */
  llmCalls?: LlmCallAttempt[];
};

/**
 * Keys into `Messages.log`. An event carries a key so the log can follow the
 * UI locale; `message` stays for text that comes from a provider verbatim.
 */
export type LogKey =
  | 'parsed'
  | 'restored'
  | 'styleReady'
  | 'translating'
  | 'chunkDone'
  | 'keptOriginal'
  | 'retryingChunk'
  | 'trialDone'
  | 'packed'
  | 'pausedStyle'
  | 'pausedChunk'
  | 'offlineWait'
  | 'retryNetwork'
  | 'retryRate'
  | 'retryServer'
  | 'readChunk'
  | 'glossaryChunk'
  | 'glossaryReady'
  | 'pausedGlossary'
  | 'windowStarted';

export type JobEvent = {
  ts: number;
  kind: 'info' | 'style' | 'chunk' | 'error' | 'cost';
  /** Rendered through the catalog when present. */
  key?: LogKey;
  params?: Record<string, string | number>;
  /** Verbatim text (provider errors, cost line) when there is no key. */
  message?: string;
  xml?: string;
};

/** What stopped the job, in terms the UI can act on. */
export type JobFailure = {
  kind: FailureKind;
  status: number | null;
  /** Raw provider text, shown as supporting detail rather than as the headline. */
  detail: string;
};

export type CostEstimate = {
  chunks: number;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
  /** Rough wall-clock guess, refined by real chunk timings once a run starts. */
  etaMs: number | null;
  model: string;
  priceKnown: boolean;
};

export type Checkpoint = {
  fileName: string;
  fileBytes: Uint8Array;
  title: string;
  format: 'epub' | 'fb2';
  settings: JobSettings;
  chunks: Chunk[];
  styleGuide: string;
  glossary: GlossaryEntry[];
  /** Per-big-chunk extracts, kept so a paused glossary pass can resume. */
  glossaryByBig?: Record<string, GlossaryEntry[]>;
  /** Manual seed rows, merged ahead of every auto extract (highest priority). */
  glossarySeed?: GlossaryEntry[];
  translated: TranslatedPair[];
  index: number;
  phase: JobPhase;
  /** Time already spent translating, so a resumed job reports honest totals. */
  elapsedMs?: number;
  savedAt?: number;
  /** Which pass to continue after a pause. */
  pausedDuring?: 'style' | 'glossary' | 'translate';
};

export type JobRunnerOptions = {
  concurrency?: number;
  glossarySnapshot?: GlossaryEntry[];
  /** Stop after this many chunks instead of running to the end (trial runs). */
  limit?: number;
};
