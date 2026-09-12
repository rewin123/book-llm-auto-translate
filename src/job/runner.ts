import { packBook, parseBook } from '../ebook/index.ts';
import type { Chunk, PackedBook, ParsedBook } from '../ebook/types.ts';
import { extractGlossaryNode, lastTwoFor } from '../graph/glossary.ts';
import { translateChunkNode } from '../graph/nodes.ts';
import { mergeGlossary, upsertGlossary, type GlossaryEntry } from '../glossary/index.ts';
import { createLlmClient, stripHarnessMarkers } from '../llm/index.ts';
import type { StoredProviders } from '../llm/presets.ts';
import { runReviewAgent } from '../review/agent.ts';
import { applyChunkEdit } from '../review/edit.ts';
import { runStyleAgent } from '../style/agent.ts';
import { longestChunkIndex } from '../verify/chunk.ts';
import { editStyleGuideline } from '../verify/guide.ts';
import { classifyFailure, isAbortError, type RetryHandler } from '../llm/net.ts';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_GLOSSARY_BATCH,
  DEFAULT_REVIEW_BATCH,
} from '../storage/setup.ts';
import { saveCheckpoint } from './checkpoint.ts';
import { estimateCost, etaFromTimings } from './cost.ts';
import {
  groupBigChunks,
  groupReviewWindows,
  splitTranslateWindows,
  type TranslateWindow,
} from './windows.ts';
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
  glossaryIndex: number;
  glossaryTotal: number;
  liveIndex: number;
  verifyIndex: number;
  verifyPair: TranslatedPair | null;
  reviewIndex: number;
  reviewTotal: number;
  pausedDuring: 'style' | 'glossary' | 'translate' | 'verify' | 'translateReview' | null;
};

export type RunnerListener = (s: JobSnapshot) => void;

export class JobRunner {
  phase: JobPhase = 'idle';
  index = 0;
  book: ParsedBook | null = null;
  settings: JobSettings | null = null;
  styleGuide = '';
  glossary: GlossaryEntry[] = [];
  glossarySeed: GlossaryEntry[] = [];
  glossaryByBig: Record<string, GlossaryEntry[]> = {};
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
  glossaryBatch = DEFAULT_GLOSSARY_BATCH;
  reviewBatch = DEFAULT_REVIEW_BATCH;
  glossaryIndex = 0;
  glossaryTotal = 0;
  verifyIndex = 0;
  verifyPair: TranslatedPair | null = null;
  reviewIndex = 0;
  reviewTotal = 0;
  /** Chunk indices the review pass has already committed. */
  reviewedChunks: Record<string, true> = {};
  pausedDuring: 'style' | 'glossary' | 'translate' | 'verify' | 'translateReview' | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  /**
   * Bumped by every `prepare` call. A slow parse that finishes after a newer one
   * must not install its book: the small file used to win the race for the UI
   * while the big one overwrote `this.book`, so the app showed one book and
   * translated — and packed — the other.
   */
  private prepareToken = 0;
  /**
   * When the clock started for the current pass, or null while idle.
   *
   * `elapsedMs` used to be the *sum* of per-chunk latencies, which under
   * `concurrency: 4` counted four windows' waiting as four times the time that
   * actually passed — a 20-minute run was reported as "1 h 30 m" — and the review
   * pass added its whole window durations to the same counter.
   */
  private activeSince: number | null = null;

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

  /** Wall-clock time spent on this job, including the pass running right now. */
  get elapsedTotalMs(): number {
    return this.elapsedMs + (this.activeSince === null ? 0 : Date.now() - this.activeSince);
  }

  private startClock() {
    if (this.activeSince === null) this.activeSince = Date.now();
  }

  private stopClock() {
    if (this.activeSince === null) return;
    this.elapsedMs += Date.now() - this.activeSince;
    this.activeSince = null;
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
      // Fresh arrays, because `commitPair` replaces, pushes and sorts in place.
      // Handing React the live references meant their identity never changed, so
      // a `useMemo` keyed on them went stale: the chapter rail kept showing the
      // old kept-original count after a retry, and showed no progress at all for
      // windows past the first when running in parallel.
      translated: [...this.translated],
      chunks: this.book ? [...this.book.chunks] : [],
      glossary: [...this.glossary],
      title: this.book?.title ?? '',
      failure: this.failure,
      trialLimit: this.trialLimit,
      elapsedMs: this.elapsedTotalMs,
      etaMs: etaFromTimings(
        this.translated.map((t) => t.ms ?? 0),
        this.phase === 'translateReview'
          ? Math.max(0, this.reviewTotal - this.reviewIndex)
          : Math.max(0, (this.trialLimit ?? total) - this.translated.length),
        this.concurrency,
      ),
      keptOriginal: this.keptOriginal,
      glossaryIndex: this.glossaryIndex,
      glossaryTotal: this.glossaryTotal,
      liveIndex: this.liveIndex,
      verifyIndex: this.verifyIndex,
      verifyPair: this.verifyPair,
      reviewIndex: this.reviewIndex,
      reviewTotal: this.reviewTotal,
      pausedDuring: this.pausedDuring,
    });
  }

  get liveIndex(): number {
    if (this.phase === 'translateReview' && this.book) {
      for (let i = 0; i < this.book.chunks.length; i++) {
        if (!this.reviewedChunks[String(i)]) return i;
      }
    }
    const done = new Set(this.translated.map((t) => t.index));
    const end = this.trialLimit ?? this.book?.chunks.length ?? 0;
    for (let i = 0; i < end; i++) {
      if (!done.has(i)) return i;
    }
    return Math.max((this.book?.chunks.length ?? 1) - 1, 0);
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
      // Snapshots, not the live arrays. IndexedDB clones at `put` time, which is
      // after the queued writes drain, so a record could pair a newer
      // `translated` with an older `index` and `phase` — and a resume then
      // reasoned from a stale count against fresh data.
      chunks: [...this.book.chunks],
      styleGuide: this.styleGuide,
      glossary: [...this.glossary],
      glossaryByBig: { ...this.glossaryByBig },
      glossarySeed: [...this.glossarySeed],
      // Without `llmCalls`. Each one holds the full instructions, the full user
      // message (glossary plus the two previous chunks in both languages) and the
      // full response — roughly 40 kB per chunk — and a checkpoint is rewritten
      // in full after *every* chunk. On a 300-chunk book that was ~12 MB per
      // write and well over a gigabyte of structured-clone traffic per run, until
      // the quota was hit and resume silently stopped working. They are only read
      // by the details panel, so they stay in memory.
      translated: this.translated.map(({ llmCalls: _calls, ...pair }) => pair),
      index: this.index,
      phase: this.phase,
      elapsedMs: this.elapsedTotalMs,
      savedAt: Date.now(),
      pausedDuring: this.pausedDuring ?? undefined,
      verifyIndex: this.verifyIndex,
      verifyPair: this.verifyPair ?? undefined,
      reviewedChunks: { ...this.reviewedChunks },
    };
    this.persistChain = this.persistChain.then(
      () => this.writeCheckpoint(cp),
      () => this.writeCheckpoint(cp),
    );
    await this.persistChain;
  }

  private async writeCheckpoint(cp: Checkpoint) {
    try {
      await saveCheckpoint(cp);
    } catch {
      // A full quota should not take the run down with it; the work is still
      // in memory and the user can download what exists.
    }
  }

  /** True while there is translated work that re-parsing would throw away. */
  get hasProgress(): boolean {
    return (
      this.translated.length > 0 ||
      this.styleGuide !== '' ||
      Object.keys(this.glossaryByBig).length > 0
    );
  }

  async prepare(
    file: File | { name: string; bytes: Uint8Array },
    settings: JobSettings,
    stored: StoredProviders,
  ) {
    if (
      this.phase === 'style' ||
      this.phase === 'review' ||
      this.phase === 'glossary' ||
      this.phase === 'glossaryReview' ||
      this.phase === 'verify' ||
      this.phase === 'verifyReview' ||
      this.phase === 'translate' ||
      this.phase === 'translateReview'
    ) {
      return;
    }
    const token = ++this.prepareToken;
    this.settings = settings;
    this.stored = stored;
    this.concurrency = settings.concurrency || DEFAULT_CONCURRENCY;
    this.glossaryBatch = settings.glossaryBatch || DEFAULT_GLOSSARY_BATCH;
    this.reviewBatch = settings.reviewBatch || DEFAULT_REVIEW_BATCH;
    const book = await parseBook(file, settings.chunkChars, {
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
    });
    if (token !== this.prepareToken) return;
    this.book = book;
    this.glossary = [];
    this.glossarySeed = [];
    this.glossaryByBig = {};
    this.glossaryIndex = 0;
    this.glossaryTotal = 0;
    this.translated = [];
    this.styleGuide = '';
    this.index = 0;
    this.packed = null;
    this.failure = null;
    this.trialLimit = null;
    this.elapsedMs = 0;
    this.verifyIndex = 0;
    this.verifyPair = null;
    this.reviewIndex = 0;
    this.reviewTotal = 0;
    this.reviewedChunks = {};
    this.phase = 'idle';
    this.log('info', 'parsed', {
      title: this.book.title,
      chunks: this.book.chunks.length,
    });
    await this.persist();
    void this.refreshCost();
  }

  /**
   * Push the settings form into an idle parsed job without re-reading the file.
   * Concurrency and glossary batch would otherwise stay at whatever prepare() saw.
   */
  applyPrefs(settings: JobSettings, stored: StoredProviders) {
    if (this.phase !== 'idle') return;
    this.settings = settings;
    this.stored = stored;
    this.concurrency = settings.concurrency || DEFAULT_CONCURRENCY;
    this.glossaryBatch = settings.glossaryBatch || DEFAULT_GLOSSARY_BATCH;
    this.reviewBatch = settings.reviewBatch || DEFAULT_REVIEW_BATCH;
  }

  /** Re-priced whenever the provider, model, or generation prefs change. */
  async refreshCost(stored?: StoredProviders) {
    if (stored) this.stored = stored;
    if (!this.book || !this.stored || !this.settings) return;
    const providerId = this.stored.activeId;
    const model = this.stored.models[providerId] || this.settings.model;
    this.cost = await estimateCost(this.book.chunks, providerId, model, {
      concurrency: this.concurrency,
      glossaryBatch: this.glossaryBatch,
      reviewBatch: this.reviewBatch,
      targetLang: this.settings?.targetLang,
    });
    this.emit();
  }

  restore(cp: Checkpoint, stored: StoredProviders) {
    this.stored = stored;
    this.concurrency = cp.settings.concurrency || DEFAULT_CONCURRENCY;
    this.glossaryBatch = cp.settings.glossaryBatch || DEFAULT_GLOSSARY_BATCH;
    this.reviewBatch = cp.settings.reviewBatch || DEFAULT_REVIEW_BATCH;
    this.settings = {
      ...cp.settings,
      concurrency: this.concurrency,
      glossaryBatch: this.glossaryBatch,
      reviewBatch: this.reviewBatch,
    };
    this.book = {
      format: cp.format,
      fileName: cp.fileName,
      chunks: cp.chunks.map((c) => {
        const raw = c as Chunk & { xml?: string };
        return {
          index: raw.index,
          documentPath: raw.documentPath,
          chapterTitle: raw.chapterTitle,
          markdown: raw.markdown || raw.xml || '',
        };
      }),
      sourceBytes: cp.fileBytes,
      title: cp.title,
      images: [],
    };
    this.styleGuide = cp.styleGuide;
    this.glossary = cp.glossary;
    this.glossarySeed = cp.glossarySeed ?? [];
    this.glossaryByBig = cp.glossaryByBig ?? {};
    this.glossaryIndex = Object.keys(this.glossaryByBig).length;
    this.glossaryTotal = groupBigChunks(this.book.chunks, this.glossaryBatch).length;
    this.translated = cp.translated.map((t) => ({
      ...t,
      translation: stripHarnessMarkers(t.translation),
    }));
    this.index = cp.index;
    this.elapsedMs = cp.elapsedMs ?? 0;
    this.failure = null;
    this.trialLimit = null;
    this.packed = null;
    this.verifyIndex = cp.verifyIndex ?? longestChunkIndex(this.book.chunks);
    this.verifyPair = cp.verifyPair
      ? { ...cp.verifyPair, translation: stripHarnessMarkers(cp.verifyPair.translation) }
      : null;
    this.reviewedChunks = cp.reviewedChunks ?? {};
    const reviewWindows = groupReviewWindows(this.book.chunks.length, this.reviewBatch);
    this.reviewTotal = reviewWindows.length;
    this.reviewIndex = reviewWindows.filter((w) => this.isWindowReviewed(w)).length;
    this.pausedDuring =
      cp.pausedDuring ??
      (cp.phase === 'glossary'
        ? 'glossary'
        : cp.phase === 'style'
          ? 'style'
          : cp.phase === 'verify' || cp.phase === 'verifyReview'
            ? 'verify'
            : cp.phase === 'translateReview'
              ? 'translateReview'
              : 'translate');
    this.phase =
      cp.phase === 'translate' ||
      cp.phase === 'glossary' ||
      cp.phase === 'style' ||
      cp.phase === 'verify' ||
      cp.phase === 'translateReview'
        ? 'paused'
        : cp.phase;
    this.log('info', 'restored', {
      title: cp.title,
      index: cp.index,
      chunks: cp.chunks.length,
    });
    void this.refreshCost();
  }

  /**
   * True while a pass owns a controller that has not been aborted, i.e. LLM
   * calls may still be in flight. Any entry point that would install a new
   * controller must refuse while this holds, or it orphans the old one.
   */
  private busyWithLiveWork(): boolean {
    return this.abort !== null && !this.abort.signal.aborted;
  }

  /**
   * Installs a controller for one verifier-chat turn.
   *
   * The verify view used to assign `runner.abort` directly, which dropped the
   * controller `runVerify` had installed without aborting it — so `pause()` only
   * reached whichever handle happened to be installed last, and an abandoned
   * retranslation could still land on a chunk the user had moved away from.
   */
  beginChatTurn(): AbortController {
    this.abort?.abort();
    this.abort = new AbortController();
    this.startClock();
    return this.abort;
  }

  /** Releases a chat turn's controller, if it is still the installed one. */
  endChatTurn(own: AbortController) {
    if (this.abort === own) this.abort = null;
  }

  /**
   * Marks the current pass finished, so the next pass in the chain may install
   * its own controller without tripping the re-entrancy guard. Only ever called
   * once the current pass's own work has completed.
   */
  private endPass() {
    this.abort = null;
    this.stopClock();
  }

  /**
   * Clears a failure so the run can be retried after the user fixes a setting,
   * keeping the book, the style guide, the glossary and every finished chunk.
   *
   * The settings screens used to call `reset()` for this, which threw all of
   * that away — on a book already 80% translated — and left the only recovery
   * path, the IndexedDB checkpoint, hidden.
   */
  clearFailure() {
    this.failure = null;
    if (this.phase === 'error') this.phase = this.translated.length > 0 ? 'paused' : 'idle';
    this.emit();
  }

  reset() {
    this.abort?.abort();
    this.phase = 'idle';
    this.index = 0;
    this.book = null;
    this.styleGuide = '';
    this.glossary = [];
    this.glossarySeed = [];
    this.glossaryByBig = {};
    this.glossaryIndex = 0;
    this.glossaryTotal = 0;
    this.translated = [];
    this.events = [];
    this.cost = null;
    this.packed = null;
    this.failure = null;
    this.trialLimit = null;
    this.elapsedMs = 0;
    this.pausedDuring = null;
    this.verifyIndex = 0;
    this.verifyPair = null;
    this.reviewIndex = 0;
    this.reviewTotal = 0;
    this.reviewedChunks = {};
    this.emit();
  }

  async runStyle() {
    if (!this.book || !this.settings || !this.stored) return;
    // Never leave a previous pass's controller unaborted: pause() and stop()
    // can only reach whichever one is installed.
    this.abort?.abort();
    this.abort = new AbortController();
    this.startClock();
    this.phase = 'style';
    this.pausedDuring = 'style';
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
      this.endPass();
      this.log('style', 'styleReady');
      void this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedStyle');
    }
  }

  approveStyle(guide: string, glossary?: GlossaryEntry[]) {
    this.styleGuide = guide;
    if (glossary) {
      this.glossarySeed = glossary.filter((e) => e.src.trim() && e.dst.trim());
      // Rebuild from the seed *and* everything the extractor already found.
      // Collapsing to the seed alone silently dropped hundreds of extracted
      // terms, so the rest of the book was translated without them.
      this.rebuildGlossary();
    }
    if (this.phase === 'style') this.phase = 'review';
    void this.persist();
    this.emit();
  }

  async resume() {
    if (this.pausedDuring === 'style' || !this.styleGuide) return this.runStyle();
    if (this.pausedDuring === 'verify') return this.runVerify({ index: this.verifyIndex });
    if (this.pausedDuring === 'translateReview') return this.runTranslateReview();
    if (this.phase === 'glossaryReview') return this.runTranslate();
    if (this.pausedDuring === 'glossary') return this.runGlossary();
    return this.runTranslate();
  }

  async runVerify(opts?: { index?: number }) {
    if (!this.book || !this.settings || !this.stored) return;
    const chunks = this.book.chunks;
    const index =
      opts?.index != null
        ? Math.min(Math.max(Math.floor(opts.index), 0), Math.max(chunks.length - 1, 0))
        : longestChunkIndex(chunks);
    this.verifyIndex = index;
    this.verifyPair = null;
    // Never leave a previous pass's controller unaborted: pause() and stop()
    // can only reach whichever one is installed.
    this.abort?.abort();
    this.abort = new AbortController();
    this.startClock();
    this.phase = 'verify';
    this.pausedDuring = 'verify';
    this.failure = null;
    this.emit();
    try {
      await this.translateVerifyChunk(this.abort.signal);
      this.phase = 'verifyReview';
      this.endPass();
      this.log('info', 'verifyReady', { n: index + 1, total: chunks.length });
      await this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedVerify');
    }
  }

  patchVerifyGuide(oldStr: string, newStr: string): string {
    const result = editStyleGuideline(this.styleGuide, oldStr, newStr);
    if (!result.ok) return result.error;
    this.styleGuide = result.guide;
    void this.persist();
    this.emit();
    return 'Style guideline updated.';
  }

  upsertVerifyGlossary(src: string, dst: string): string {
    const s = src.trim();
    const d = dst.trim();
    if (!s || !d) return 'Ignored empty glossary row.';
    this.glossary = upsertGlossary(this.glossary, s, d);
    this.glossarySeed = upsertGlossary(this.glossarySeed, s, d);
    void this.persist();
    this.emit();
    return `Glossary: ${s} → ${d}`;
  }

  async retranslateVerify(): Promise<{ original: string; translate: string }> {
    if (!this.book || !this.settings || !this.stored) {
      return { original: '', translate: '' };
    }
    if (!this.abort || this.abort.signal.aborted) this.abort = new AbortController();
    await this.translateVerifyChunk(this.abort.signal);
    await this.persist();
    const pair = this.verifyPair;
    return {
      original: pair?.original ?? '',
      translate: pair?.translation ?? '',
    };
  }

  private async translateVerifyChunk(signal: AbortSignal) {
    if (!this.book || !this.settings || !this.stored) return;
    const chunk = this.book.chunks[this.verifyIndex];
    if (!chunk) return;
    const client = createLlmClient(this.stored, (info) => this.logRetry(info));
    const originalMarkdown = chunk.markdown;
    this.log('info', 'translating', {
      n: this.verifyIndex + 1,
      total: this.book.chunks.length,
      chapter: chunk.chapterTitle,
    });
    const started = Date.now();
    const result = await translateChunkNode({
      client,
      chunk: { ...chunk, markdown: originalMarkdown },
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang,
      styleGuide: this.styleGuide,
      glossary: this.glossary,
      lastTwo: [],
      abortSignal: signal,
    });
    this.verifyPair = {
      index: this.verifyIndex,
      original: originalMarkdown,
      translation: stripHarnessMarkers(result.markdown),
      usedOriginal: result.usedOriginal,
      reason: result.reason,
      ms: Date.now() - started,
      llmCalls: result.llmCalls,
    };
    this.emit();
  }

  private rebuildGlossary() {
    const bigs = this.book ? groupBigChunks(this.book.chunks, this.glossaryBatch) : [];
    let merged = mergeGlossary([], this.glossarySeed);
    for (const big of bigs) {
      merged = mergeGlossary(merged, this.glossaryByBig[String(big.id)] ?? []);
    }
    this.glossary = merged;
  }

  async runGlossary() {
    if (!this.book || !this.settings || !this.stored) return;
    // Never leave a previous pass's controller unaborted: pause() and stop()
    // can only reach whichever one is installed.
    this.abort?.abort();
    this.abort = new AbortController();
    this.startClock();
    this.phase = 'glossary';
    this.pausedDuring = 'glossary';
    this.failure = null;
    const bigs = groupBigChunks(this.book.chunks, this.glossaryBatch);
    this.glossaryTotal = bigs.length;
    this.glossaryIndex = bigs.filter((b) => this.glossaryByBig[String(b.id)]).length;
    this.emit();
    const client = createLlmClient(this.stored, (info) => this.logRetry(info));
    const signal = this.abort.signal;
    try {
      for (const big of bigs) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const key = String(big.id);
        if (this.glossaryByBig[key]) {
          this.glossaryIndex = Math.max(this.glossaryIndex, big.id + 1);
          continue;
        }
        this.log('info', 'glossaryChunk', {
          n: big.id + 1,
          total: bigs.length,
          from: big.from + 1,
          to: big.to + 1,
        });
        const result = await extractGlossaryNode({
          client,
          markdown: big.markdown,
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          styleGuide: this.styleGuide,
          abortSignal: signal,
        });
        this.glossaryByBig[key] = result.glossary;
        this.glossaryIndex = big.id + 1;
        this.rebuildGlossary();
        await this.persist();
        this.emit();
      }
      this.rebuildGlossary();
      this.log('style', 'glossaryReady', { n: this.glossary.length });
      await this.persist();
      this.endPass();
      await this.runTranslate();
    } catch (err) {
      await this.handleFailure(err, 'pausedGlossary');
    }
  }

  async runTranslate(opts?: JobRunnerOptions) {
    if (!this.book || !this.settings || !this.stored) {
      this.logRaw('error', 'Nothing to translate — no book is loaded.');
      return;
    }
    // A live controller means work is still in flight, whatever the phase says.
    // Keying this on the phase alone let a Resume during the `error` phase start
    // a second full set of windows alongside the first.
    if (this.busyWithLiveWork()) return;
    const concurrency = opts?.concurrency ?? this.concurrency;
    if (opts?.glossarySnapshot) this.glossary = opts.glossarySnapshot;
    const total = this.book.chunks.length;
    const limit = opts?.limit != null ? Math.min(opts.limit, total) : total;
    this.trialLimit = limit < total ? limit : null;
    // Never leave a previous pass's controller unaborted: pause() and stop()
    // can only reach whichever one is installed.
    this.abort?.abort();
    this.abort = new AbortController();
    this.startClock();
    this.phase = 'translate';
    this.pausedDuring = 'translate';
    this.failure = null;
    this.concurrency = concurrency;
    this.emit();
    const client = createLlmClient(this.stored, (info) => this.logRetry(info));
    const signal = this.abort.signal;
    const windows = splitTranslateWindows(limit, concurrency);
    try {
      for (const w of windows) {
        this.log('info', 'windowStarted', {
          n: w.id + 1,
          from: w.from + 1,
          to: w.to,
          total: windows.length,
        });
      }
      await Promise.all(windows.map((w) => this.runWindow(w, total, client, signal)));

      this.index = this.translated.length;
      if (this.translated.length < total) {
        this.phase = 'paused';
        this.endPass();
        this.log('info', 'trialDone', { n: this.translated.length, total });
        await this.persist();
        return;
      }

      this.endPass();
      await this.runTranslateReview();
    } catch (err) {
      await this.handleFailure(err, 'pausedChunk');
    }
  }

  private async runWindow(
    window: { from: number; to: number },
    total: number,
    client: ReturnType<typeof createLlmClient>,
    signal: AbortSignal,
  ) {
    if (!this.book || !this.settings) return;
    const done = () => new Set(this.translated.map((t) => t.index));
    for (let i = window.from; i < window.to; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done().has(i)) continue;
      const chunk = this.book.chunks[i]!;
      const originalMarkdown = chunk.markdown;
      const lastTwo = lastTwoFor(i, this.translated);
      this.log('info', 'translating', {
        n: i + 1,
        total,
        chapter: chunk.chapterTitle,
      });
      const started = Date.now();
      const result = await translateChunkNode({
        client,
        chunk: { ...chunk, markdown: originalMarkdown },
        sourceLang: this.settings.sourceLang,
        targetLang: this.settings.targetLang,
        styleGuide: this.styleGuide,
        glossary: this.glossary,
        lastTwo,
        abortSignal: signal,
      });
      const ms = Date.now() - started;
      this.commitPair({
        index: i,
        original: originalMarkdown,
        translation: result.markdown,
        usedOriginal: result.usedOriginal,
        reason: result.reason,
        ms,
        llmCalls: result.llmCalls,
      });
      if (result.usedOriginal) {
        this.log('error', 'keptOriginal', {
          n: i + 1,
          chapter: chunk.chapterTitle,
          reason: result.reason ?? 'unknown',
        });
      } else {
        this.log('chunk', 'chunkDone', { n: i + 1, chapter: chunk.chapterTitle }, result.markdown);
      }
      await this.persist();
      this.emit();
    }
  }

  private commitPair(pair: TranslatedPair) {
    const cleaned = { ...pair, translation: stripHarnessMarkers(pair.translation) };
    const at = this.translated.findIndex((t) => t.index === cleaned.index);
    if (at >= 0) this.translated[at] = cleaned;
    else this.translated.push(cleaned);
    this.translated.sort((a, b) => a.index - b.index);
    this.index = this.translated.length;
  }

  private isWindowReviewed(window: TranslateWindow): boolean {
    for (let i = window.from; i < window.to; i++) {
      if (!this.reviewedChunks[String(i)]) return false;
    }
    return true;
  }

  private invalidateReviewedChunks(indices: number[]) {
    for (const i of indices) delete this.reviewedChunks[String(i)];
    if (!this.book) return;
    this.reviewIndex = groupReviewWindows(this.book.chunks.length, this.reviewBatch).filter((w) =>
      this.isWindowReviewed(w),
    ).length;
  }

  /**
   * Post-translate review. The book is cut into disjoint windows of
   * `reviewBatch` chunks and each window gets an agent that reads and edits
   * chunks by id. An edit is confined to the chunk it names, so nothing moves
   * across a chunk boundary and no two agents ever write the same chunk — the
   * book is only stitched back together in `pack()`, after this pass.
   */
  async runTranslateReview() {
    if (!this.book || !this.settings || !this.stored) return;
    if (this.phase === 'translateReview' && this.abort && !this.abort.signal.aborted) return;
    if (this.translated.length < this.book.chunks.length) return;
    // Never leave a previous pass's controller unaborted: pause() and stop()
    // can only reach whichever one is installed.
    this.abort?.abort();
    this.abort = new AbortController();
    this.startClock();
    this.phase = 'translateReview';
    this.pausedDuring = 'translateReview';
    this.failure = null;
    const windows = groupReviewWindows(this.book.chunks.length, this.reviewBatch);
    this.reviewTotal = windows.length;
    this.reviewIndex = windows.filter((w) => this.isWindowReviewed(w)).length;
    this.emit();
    const signal = this.abort.signal;
    try {
      const pending = windows.filter((w) => !this.isWindowReviewed(w));
      const slots = splitTranslateWindows(pending.length, this.concurrency);
      await Promise.all(slots.map((slot) => this.runReviewSlot(pending, slot, signal)));
      await this.pack();
      this.phase = 'done';
      this.endPass();
      this.log('info', 'reviewReady', { n: windows.length });
      this.log('info', 'packed', { file: this.packed?.fileName ?? '' });
      await this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedReview');
    }
  }

  private async runReviewSlot(
    windows: TranslateWindow[],
    slot: TranslateWindow,
    signal: AbortSignal,
  ) {
    for (let i = slot.from; i < slot.to; i++) {
      await this.runReviewWindow(windows[i]!, signal);
    }
  }

  private async runReviewWindow(window: TranslateWindow, signal: AbortSignal) {
    if (!this.book || !this.settings || !this.stored) return;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.isWindowReviewed(window)) return;

    const chunkCount = this.book.chunks.length;
    const ids: number[] = [];
    for (let i = window.from; i < window.to; i++) ids.push(i);
    const owned = new Set(ids);
    const pairFor = (id: number) => this.translated.find((t) => t.index === id);

    this.log('info', 'reviewWindow', {
      n: window.id + 1,
      total: this.reviewTotal,
      from: window.from + 1,
      to: window.to,
    });

    await runReviewAgent({
      stored: this.stored,
      abortSignal: signal,
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang,
      styleGuide: this.styleGuide,
      glossary: this.glossary,
      ids,
      chunkCount,
      onRetry: (info) => this.logRetry(info),
      tools: {
        readOriginalChunk: (id) => {
          const chunk = this.book?.chunks[id];
          if (!chunk) return `err: no chunk ${id}; the book has chunks 0..${chunkCount - 1}`;
          return pairFor(id)?.original ?? chunk.markdown;
        },
        readTranslatedChunk: (id) => {
          const chunk = this.book?.chunks[id];
          if (!chunk) return `err: no chunk ${id}; the book has chunks 0..${chunkCount - 1}`;
          return stripHarnessMarkers(pairFor(id)?.translation ?? chunk.markdown);
        },
        editTranslatedChunk: (id, oldStr, newStr) => {
          if (!owned.has(id)) {
            return `err: chunk ${id} is not in your task; you may edit ${ids.join(', ')}`;
          }
          const pair = pairFor(id);
          if (!pair) return `err: chunk ${id} has no translation yet`;
          const { result, pair: next } = applyChunkEdit(pair, oldStr, newStr);
          if (result === 'ok' && next !== pair) {
            this.commitPair(next);
            this.log('info', 'reviewEdit', { n: id + 1 });
            this.emit();
          }
          return result;
        },
      },
    });

    for (const id of ids) this.reviewedChunks[String(id)] = true;
    this.reviewIndex = groupReviewWindows(chunkCount, this.reviewBatch).filter((w) =>
      this.isWindowReviewed(w),
    ).length;
    await this.persist();
    this.emit();
  }

  /** Re-runs only the chunks whose translation never validated. */
  async retryKeptOriginal() {
    if (!this.book || !this.settings || !this.stored) return;
    if (this.busyWithLiveWork()) return;
    const targets = this.translated.filter((t) => t.usedOriginal).map((t) => t.index);
    if (targets.length === 0) return;
    this.abort = new AbortController();
    this.phase = 'translate';
    // Without this the field kept whatever the last pass set, so pausing here
    // sent `resume()` into the review pass instead, and the chunks still holding
    // source text were quietly packed that way.
    this.pausedDuring = 'translate';
    this.failure = null;
    this.emit();
    const client = createLlmClient(this.stored, (info) => this.logRetry(info));
    const signal = this.abort.signal;
    try {
      for (const idx of targets) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = this.book.chunks[idx]!;
        const originalMarkdown = chunk.markdown;
        this.log('info', 'retryingChunk', { n: idx + 1, chapter: chunk.chapterTitle });
        const started = Date.now();
        const result = await translateChunkNode({
          client,
          chunk: { ...chunk, markdown: originalMarkdown },
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang,
          styleGuide: this.styleGuide,
          glossary: this.glossary,
          lastTwo: lastTwoFor(idx, this.translated),
          abortSignal: signal,
        });
        const ms = Date.now() - started;
        this.commitPair({
          index: idx,
          original: originalMarkdown,
          translation: result.markdown,
          usedOriginal: result.usedOriginal,
          reason: result.reason,
          ms,
          llmCalls: result.llmCalls,
        });
        if (result.usedOriginal) {
          this.log('error', 'keptOriginal', {
            n: idx + 1,
            chapter: chunk.chapterTitle,
            reason: result.reason ?? 'unknown',
          });
        } else {
          this.log('chunk', 'chunkDone', { n: idx + 1, chapter: chunk.chapterTitle }, result.markdown);
          this.invalidateReviewedChunks([idx]);
        }
        await this.persist();
        this.emit();
      }
      if (this.index >= this.book.chunks.length) {
        this.endPass();
        await this.runTranslateReview();
      } else {
        this.phase = 'paused';
        this.endPass();
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
    const byIndex = new Map(
      this.translated.map((t) => [t.index, stripHarnessMarkers(t.translation)]),
    );
    const translations = this.book.chunks.map((c, i) => byIndex.get(i) ?? c.markdown);
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
    // `Promise.all` rejects on the first window's error while the rest are still
    // awaiting their own LLM calls. Without this they ran to the end of their
    // ranges — committing, persisting and billing — and a Resume then replaced
    // `this.abort`, leaving them unstoppable and translating chunks twice.
    this.abort?.abort();
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
