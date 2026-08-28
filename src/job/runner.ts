import { packBook, parseBook } from '../ebook/index.ts';
import type { PackedBook, ParsedBook } from '../ebook/types.ts';
import { mergeAfterChunk, translateChunkNode } from '../graph/nodes.ts';
import type { GlossaryEntry } from '../glossary/index.ts';
import { createLlmClient } from '../llm/index.ts';
import type { StoredProviders } from '../llm/presets.ts';
import { runStyleAgent } from '../style/agent.ts';
import { classifyFailure, isAbortError, type RetryHandler } from '../llm/net.ts';
import { saveCheckpoint } from './checkpoint.ts';
import { estimateCost, etaFromTimings } from './cost.ts';
import type {
  Checkpoint,
  CostEstimate,
  JobEvent,
  JobFailure,
  JobPhase,
  JobRunnerOptions,
  JobSettings,
  LogKey,
  TranslatedPair,
} from './types.ts';

export type JobSnapshot = {
  phase: JobPhase;
  index: number;
  total: number;
  events: JobEvent[];
  styleGuide: string;
  cost: CostEstimate | null;
  packed: PackedBook | null;
  translated: TranslatedPair[];
  chunks: ParsedBook['chunks'];
  glossary: GlossaryEntry[];
  title: string;
  failure: JobFailure | null;
  /** Set while a bounded trial run is in effect. */
  trialLimit: number | null;
  elapsedMs: number;
  etaMs: number | null;
  keptOriginal: number;
};

export type RunnerListener = (s: JobSnapshot) => void;

export class JobRunner {
  phase: JobPhase = 'idle';
  index = 0;
  book: ParsedBook | null = null;
  settings: JobSettings | null = null;
  styleGuide = '';
  glossary: GlossaryEntry[] = [];
  translated: TranslatedPair[] = [];
  events: JobEvent[] = [];
  cost: CostEstimate | null = null;
  packed: PackedBook | null = null;
  stored: StoredProviders | null = null;
  abort: AbortController | null = null;
  failure: JobFailure | null = null;
  trialLimit: number | null = null;
  elapsedMs = 0;
  concurrency = 1;

  listener: RunnerListener;
  logLimit: number;

  constructor(listener: RunnerListener, logLimit = 40) {
    this.listener = listener;
    this.logLimit = logLimit;
  }

  /**
   * Changing how much log to keep must never cost the user their job. This is a
   * setter precisely so the runner is not rebuilt (and the book, guide, glossary
   * and translations dropped) when the preference changes mid-run.
   */
  setLogLimit(limit: number) {
    this.logLimit = limit;
    this.emit();
  }

  get keptOriginal(): number {
    return this.translated.filter((t) => t.usedOriginal).length;
  }

  emit() {
    const total = this.book?.chunks.length ?? 0;
    this.listener({
      phase: this.phase,
      index: this.index,
      total,
      events: this.events.slice(-this.logLimit),
      styleGuide: this.styleGuide,
      cost: this.cost,
      packed: this.packed,
      translated: this.translated,
      chunks: this.book?.chunks ?? [],
      glossary: this.glossary,
      title: this.book?.title ?? '',
      failure: this.failure,
      trialLimit: this.trialLimit,
      elapsedMs: this.elapsedMs,
      etaMs: etaFromTimings(
        this.translated.map((t) => t.ms ?? 0),
        Math.max(0, (this.trialLimit ?? total) - this.index),
      ),
      keptOriginal: this.keptOriginal,
    });
  }

  log(kind: JobEvent['kind'], key: LogKey, params?: JobEvent['params'], xml?: string) {
    this.events.push({ ts: Date.now(), kind, key, params, xml });
    this.emit();
  }

  /** For text that comes from a provider and cannot be translated by us. */
  logRaw(kind: JobEvent['kind'], message: string) {
    this.events.push({ ts: Date.now(), kind, message });
    this.emit();
  }

  async persist() {
    if (!this.book || !this.settings) return;
    const cp: Checkpoint = {
      fileName: this.book.fileName,
      fileBytes: this.book.sourceBytes,
      title: this.book.title,
      format: this.book.format,
      settings: this.settings,
      chunks: this.book.chunks,
      styleGuide: this.styleGuide,
      glossary: this.glossary,
      translated: this.translated,
      index: this.index,
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      savedAt: Date.now(),
    };
    try {
      await saveCheckpoint(cp);
    } catch {
      // A full quota should not take the run down with it; the work is still
      // in memory and the user can download what exists.
    }
  }

  /** True while there is translated work that re-parsing would throw away. */
  get hasProgress(): boolean {
    return this.translated.length > 0 || this.styleGuide !== '';
  }

  async prepare(
    file: File | { name: string; bytes: Uint8Array },
    settings: JobSettings,
    stored: StoredProviders,
  ) {
    if (this.phase === 'style' || this.phase === 'review' || this.phase === 'translate') {
      return;
    }
    this.settings = settings;
    this.stored = stored;
    this.concurrency = settings.concurrency;
    this.book = await parseBook(file, settings.chunkChars);
    this.glossary = [];
    this.translated = [];
    this.styleGuide = '';
    this.index = 0;
    this.packed = null;
    this.failure = null;
    this.trialLimit = null;
    this.elapsedMs = 0;
    this.phase = 'idle';
    this.log('info', 'parsed', {
      title: this.book.title,
      chunks: this.book.chunks.length,
    });
    await this.persist();
    void this.refreshCost();
  }

  /** Re-priced whenever the provider or model changes, so the number is never stale. */
  async refreshCost(stored?: StoredProviders) {
    if (stored) this.stored = stored;
    if (!this.book || !this.stored || !this.settings) return;
    const providerId = this.stored.activeId;
    const model = this.stored.models[providerId] || this.settings.model;
    this.cost = await estimateCost(this.book.chunks, providerId, model);
    this.emit();
  }

  restore(cp: Checkpoint, stored: StoredProviders) {
    this.stored = stored;
    this.settings = cp.settings;
    this.concurrency = cp.settings.concurrency;
    this.book = {
      format: cp.format,
      fileName: cp.fileName,
      chunks: cp.chunks,
      sourceBytes: cp.fileBytes,
      title: cp.title,
    };
    this.styleGuide = cp.styleGuide;
    this.glossary = cp.glossary;
    this.translated = cp.translated;
    this.index = cp.index;
    this.elapsedMs = cp.elapsedMs ?? 0;
    this.failure = null;
    this.trialLimit = null;
    this.packed = null;
    this.phase = cp.phase === 'translate' ? 'paused' : cp.phase;
    this.log('info', 'restored', {
      title: cp.title,
      index: cp.index,
      chunks: cp.chunks.length,
    });
    void this.refreshCost();
  }

  reset() {
    this.abort?.abort();
    this.phase = 'idle';
    this.index = 0;
    this.book = null;
    this.styleGuide = '';
    this.glossary = [];
    this.translated = [];
    this.events = [];
    this.cost = null;
    this.packed = null;
    this.failure = null;
    this.trialLimit = null;
    this.elapsedMs = 0;
    this.emit();
  }

  async runStyle() {
    if (!this.book || !this.settings || !this.stored) return;
    this.abort = new AbortController();
    this.phase = 'style';
    this.failure = null;
    this.emit();
    try {
      const client = createLlmClient(this.stored, (info) => this.logRetry(info));
      this.styleGuide = await runStyleAgent({
        client,
        stored: this.stored,
        chunks: this.book.chunks,
        sourceLang: this.settings.sourceLang,
        targetLang: this.settings.targetLang,
        abortSignal: this.abort.signal,
        onEvent: (e) => {
          this.events.push(e);
          this.emit();
        },
        onRetry: (info) => this.logRetry(info),
      });
      this.phase = 'review';
      this.log('style', 'styleReady');
      void this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedStyle');
    }
  }

  approveStyle(guide: string, glossary?: GlossaryEntry[]) {
    this.styleGuide = guide;
    if (glossary) this.glossary = glossary;
    this.phase = 'review';
    void this.persist();
    this.emit();
  }

  async runTranslate(opts?: JobRunnerOptions) {
    if (!this.book || !this.settings || !this.stored) {
      this.logRaw('error', 'Nothing to translate — no book is loaded.');
      return;
    }
    const concurrency = opts?.concurrency ?? this.concurrency;
    void concurrency;
    if (opts?.glossarySnapshot) this.glossary = opts.glossarySnapshot;
    const total = this.book.chunks.length;
    const limit = opts?.limit != null ? Math.min(opts.limit, total) : total;
    this.trialLimit = limit < total ? limit : null;
    this.abort = new AbortController();
    this.phase = 'translate';
    this.failure = null;
    this.emit();
    const client = createLlmClient(this.stored, (info) => this.logRetry(info));
    const signal = this.abort.signal;
    try {
      while (this.index < limit) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = this.book.chunks[this.index]!;
        const lastTwo = this.translated.slice(-2);
        this.log('info', 'translating', {
          n: this.index + 1,
          total,
          chapter: chunk.chapterTitle,
        });
        const started = Date.now();
        const result = await translateChunkNode({
          client,
          chunk,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          styleGuide: this.styleGuide,
          glossary: this.glossary,
          lastTwo,
          abortSignal: signal,
        });
        const ms = Date.now() - started;
        this.elapsedMs += ms;
        this.glossary = mergeAfterChunk(this.glossary, result.glossary);
        this.translated.push({
          index: this.index,
          original: chunk.xml,
          translation: result.xml,
          usedOriginal: result.usedOriginal,
          reason: result.reason,
          ms,
        });
        if (result.usedOriginal) {
          this.log('error', 'keptOriginal', {
            n: this.index + 1,
            chapter: chunk.chapterTitle,
            reason: result.reason ?? 'unknown',
          });
        } else {
          this.log('chunk', 'chunkDone', { n: this.index + 1, chapter: chunk.chapterTitle }, result.xml);
        }
        this.index += 1;
        await this.persist();
        this.emit();
      }

      if (this.index < total) {
        this.phase = 'paused';
        this.log('info', 'trialDone', { n: this.index, total });
        await this.persist();
        return;
      }

      await this.pack();
      this.phase = 'done';
      this.log('info', 'packed', { file: this.packed?.fileName ?? '' });
      await this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedChunk');
    }
  }

  /** Re-runs only the chunks whose translation never validated. */
  async retryKeptOriginal() {
    if (!this.book || !this.settings || !this.stored) return;
    const targets = this.translated.filter((t) => t.usedOriginal).map((t) => t.index);
    if (targets.length === 0) return;
    this.abort = new AbortController();
    this.phase = 'translate';
    this.failure = null;
    this.emit();
    const client = createLlmClient(this.stored, (info) => this.logRetry(info));
    const signal = this.abort.signal;
    try {
      for (const idx of targets) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = this.book.chunks[idx]!;
        this.log('info', 'retryingChunk', { n: idx + 1, chapter: chunk.chapterTitle });
        const started = Date.now();
        const result = await translateChunkNode({
          client,
          chunk,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          styleGuide: this.styleGuide,
          glossary: this.glossary,
          lastTwo: this.translated.filter((t) => t.index < idx).slice(-2),
          abortSignal: signal,
        });
        const ms = Date.now() - started;
        this.elapsedMs += ms;
        this.glossary = mergeAfterChunk(this.glossary, result.glossary);
        const at = this.translated.findIndex((t) => t.index === idx);
        if (at >= 0) {
          this.translated[at] = {
            index: idx,
            original: chunk.xml,
            translation: result.xml,
            usedOriginal: result.usedOriginal,
            reason: result.reason,
            ms,
          };
        }
        if (result.usedOriginal) {
          this.log('error', 'keptOriginal', {
            n: idx + 1,
            chapter: chunk.chapterTitle,
            reason: result.reason ?? 'unknown',
          });
        } else {
          this.log('chunk', 'chunkDone', { n: idx + 1, chapter: chunk.chapterTitle }, result.xml);
        }
        await this.persist();
        this.emit();
      }
      if (this.index >= this.book.chunks.length) {
        await this.pack();
        this.phase = 'done';
        this.log('info', 'packed', { file: this.packed?.fileName ?? '' });
      } else {
        this.phase = 'paused';
      }
      await this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedChunk');
    }
  }

  /**
   * Builds the output file from whatever exists right now. Chunks that were
   * never reached keep their source text, so a paused or stopped job can still
   * be downloaded instead of being trapped until the run completes.
   */
  async pack(): Promise<PackedBook | null> {
    if (!this.book || !this.settings) return null;
    const byIndex = new Map(this.translated.map((t) => [t.index, t.translation]));
    const translations = this.book.chunks.map((c, i) => byIndex.get(i) ?? c.xml);
    this.packed = await packBook({
      book: this.book,
      translations,
      targetLang: this.settings.targetLang,
    });
    this.emit();
    return this.packed;
  }

  pause() {
    this.abort?.abort();
  }

  stop() {
    this.abort?.abort();
  }

  private async handleFailure(err: unknown, pausedKey: LogKey) {
    if (isAbortError(err)) {
      this.phase = 'paused';
      await this.persist();
      this.log('info', pausedKey, { n: this.index + 1 });
      return;
    }
    const verdict = classifyFailure(err);
    this.failure = {
      kind: verdict.kind,
      status: verdict.status,
      detail: err instanceof Error ? err.message : String(err),
    };
    this.phase = 'error';
    this.logRaw('error', this.failure.detail);
    await this.persist();
  }

  private logRetry(info: Parameters<RetryHandler>[0]) {
    if (info.waitingForOnline) {
      this.log('info', 'offlineWait');
      return;
    }
    const secs = Math.max(1, Math.round(info.delayMs / 1000));
    const key: LogKey =
      info.kind === 'rate' ? 'retryRate' : info.kind === 'server' ? 'retryServer' : 'retryNetwork';
    this.log('info', key, { attempt: info.attempt, secs });
  }
}
