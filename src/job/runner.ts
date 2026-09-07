import { packBook, parseBook } from '../ebook/index.ts';
import type { Chunk, PackedBook, ParsedBook } from '../ebook/types.ts';
import { extractGlossaryNode, lastTwoFor } from '../graph/glossary.ts';
import { translateChunkNode } from '../graph/nodes.ts';
import { mergeGlossary, upsertGlossary, type GlossaryEntry } from '../glossary/index.ts';
import { createLlmClient, stripHarnessMarkers } from '../llm/index.ts';
import type { StoredProviders } from '../llm/presets.ts';
import { runReviewAgent } from '../review/agent.ts';
import { applyReviewEdit, applyReviewedTranslation } from '../review/edit.ts';
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
  splitReviewWaves,
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
  reviewedByWindow: Record<string, true> = {};
  pausedDuring: 'style' | 'glossary' | 'translate' | 'verify' | 'translateReview' | null = null;
  private persistChain: Promise<void> = Promise.resolve();

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
      const windows = groupReviewWindows(this.book.chunks.length, this.reviewBatch);
      for (const w of windows) {
        if (!this.reviewedByWindow[String(w.id)]) return w.from;
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
      chunks: this.book.chunks,
      styleGuide: this.styleGuide,
      glossary: this.glossary,
      glossaryByBig: this.glossaryByBig,
      glossarySeed: this.glossarySeed,
      translated: this.translated,
      index: this.index,
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      savedAt: Date.now(),
      pausedDuring: this.pausedDuring ?? undefined,
      verifyIndex: this.verifyIndex,
      verifyPair: this.verifyPair ?? undefined,
      reviewedByWindow: this.reviewedByWindow,
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
    this.settings = settings;
    this.stored = stored;
    this.concurrency = settings.concurrency || DEFAULT_CONCURRENCY;
    this.glossaryBatch = settings.glossaryBatch || DEFAULT_GLOSSARY_BATCH;
    this.reviewBatch = settings.reviewBatch || DEFAULT_REVIEW_BATCH;
    this.book = await parseBook(file, settings.chunkChars, {
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
    });
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
    this.reviewedByWindow = {};
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
    this.reviewedByWindow = cp.reviewedByWindow ?? {};
    const reviewWindows = groupReviewWindows(this.book.chunks.length, this.reviewBatch);
    this.reviewTotal = reviewWindows.length;
    this.reviewIndex = reviewWindows.filter((w) => this.reviewedByWindow[String(w.id)]).length;
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
    this.reviewedByWindow = {};
    this.emit();
  }

  async runStyle() {
    if (!this.book || !this.settings || !this.stored) return;
    this.abort = new AbortController();
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
      this.glossary = mergeGlossary([], this.glossarySeed);
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
    this.abort = new AbortController();
    this.phase = 'verify';
    this.pausedDuring = 'verify';
    this.failure = null;
    this.emit();
    try {
      await this.translateVerifyChunk(this.abort.signal);
      this.phase = 'verifyReview';
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
    this.abort = new AbortController();
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
    if (
      (this.phase === 'translate' || this.phase === 'translateReview') &&
      this.abort &&
      !this.abort.signal.aborted
    ) {
      return;
    }
    const concurrency = opts?.concurrency ?? this.concurrency;
    if (opts?.glossarySnapshot) this.glossary = opts.glossarySnapshot;
    const total = this.book.chunks.length;
    const limit = opts?.limit != null ? Math.min(opts.limit, total) : total;
    this.trialLimit = limit < total ? limit : null;
    this.abort = new AbortController();
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
        this.log('info', 'trialDone', { n: this.translated.length, total });
        await this.persist();
        return;
      }

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
      this.elapsedMs += ms;
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

  private commitReviewSlice(slice: Chunk[], parts: string[]) {
    let changed = false;
    for (let i = 0; i < slice.length; i++) {
      const pair = this.translated.find((t) => t.index === slice[i]!.index);
      if (!pair) continue;
      const next = applyReviewedTranslation(pair, stripHarnessMarkers(parts[i]!));
      if (next === pair) continue;
      this.commitPair(next);
      changed = true;
    }
    if (changed) this.emit();
  }

  private invalidateReviewWindows(indices: number[]) {
    if (!this.book || indices.length === 0) return;
    const hit = new Set(indices);
    for (const w of groupReviewWindows(this.book.chunks.length, this.reviewBatch)) {
      for (let i = w.from; i < w.to; i++) {
        if (hit.has(i)) {
          delete this.reviewedByWindow[String(w.id)];
          break;
        }
      }
    }
    this.reviewIndex = Object.keys(this.reviewedByWindow).length;
  }

  /**
   * Post-translate seam review. Windows of `reviewBatch` chunks overlap by one
   * so every chunk boundary is visible. Even/odd waves run in parallel so two
   * agents never write the same overlap chunk at once.
   */
  async runTranslateReview() {
    if (!this.book || !this.settings || !this.stored) return;
    if (this.phase === 'translateReview' && this.abort && !this.abort.signal.aborted) return;
    if (this.translated.length < this.book.chunks.length) return;
    this.abort = new AbortController();
    this.phase = 'translateReview';
    this.pausedDuring = 'translateReview';
    this.failure = null;
    const windows = groupReviewWindows(this.book.chunks.length, this.reviewBatch);
    this.reviewTotal = windows.length;
    this.reviewIndex = windows.filter((w) => this.reviewedByWindow[String(w.id)]).length;
    this.emit();
    const signal = this.abort.signal;
    try {
      const { even, odd } = splitReviewWaves(windows);
      await this.runReviewWave(even, signal);
      await this.runReviewWave(odd, signal);
      await this.pack();
      this.phase = 'done';
      this.log('info', 'reviewReady', { n: windows.length });
      this.log('info', 'packed', { file: this.packed?.fileName ?? '' });
      await this.persist();
    } catch (err) {
      await this.handleFailure(err, 'pausedReview');
    }
  }

  private async runReviewWave(windows: TranslateWindow[], signal: AbortSignal) {
    const pending = windows.filter((w) => !this.reviewedByWindow[String(w.id)]);
    if (pending.length === 0) return;
    const slots = splitTranslateWindows(pending.length, this.concurrency);
    await Promise.all(slots.map((slot) => this.runReviewSlot(pending, slot, signal)));
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
    const key = String(window.id);
    if (this.reviewedByWindow[key]) return;

    const slice = this.book.chunks.slice(window.from, window.to);
    const originals: string[] = [];
    const parts: string[] = [];
    for (const chunk of slice) {
      const pair = this.translated.find((t) => t.index === chunk.index);
      originals.push(pair?.original ?? chunk.markdown);
      parts.push(stripHarnessMarkers(pair?.translation ?? chunk.markdown));
    }
    const originalJoined = originals.join('');

    this.log('info', 'reviewWindow', {
      n: window.id + 1,
      total: this.reviewTotal,
      from: window.from + 1,
      to: window.to,
    });

    const started = Date.now();
    await runReviewAgent({
      stored: this.stored,
      abortSignal: signal,
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang,
      styleGuide: this.styleGuide,
      glossary: this.glossary,
      original: originalJoined,
      translation: parts.join(''),
      from: window.from,
      to: window.to,
      chunkCount: this.book.chunks.length,
      onRetry: (info) => this.logRetry(info),
      tools: {
        readTranslate: () => parts.join(''),
        editTranslate: (oldStr, newStr) => {
          const result = applyReviewEdit(parts, originalJoined, oldStr, newStr);
          if (result === 'ok') this.commitReviewSlice(slice, parts);
          return result;
        },
      },
    });

    this.commitReviewSlice(slice, parts);

    this.reviewedByWindow[key] = true;
    this.reviewIndex = Object.keys(this.reviewedByWindow).length;
    this.elapsedMs += Date.now() - started;
    await this.persist();
    this.emit();
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
        this.elapsedMs += ms;
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
          this.invalidateReviewWindows([idx]);
        }
        await this.persist();
        this.emit();
      }
      if (this.index >= this.book.chunks.length) {
        await this.runTranslateReview();
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
