import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDemoEpub } from './ebook/demoBook.ts';
import { BookParseError, type ParseErrorCode } from './ebook/index.ts';
import type { Chunk } from './ebook/types.ts';
import { I18nContext, catalogs, fmt, useT } from './i18n/index.ts';
import { clearCheckpoint, loadCheckpoint } from './job/checkpoint.ts';
import type { Checkpoint, JobSettings } from './job/types.ts';
import type { GlossaryEntry } from './glossary/index.ts';
import { CORS_OPENROUTER_FALLBACK, PROVIDER_PRESETS, type StoredProviders } from './llm/presets.ts';
import type { ConnectionResult } from './llm/testConnection.ts';
import { loadProviders, saveProviders } from './storage/providers.ts';
import {
  clampBatch,
  clampConcurrency,
  DEFAULT_GLOSSARY_BATCH,
  DEFAULT_REVIEW_BATCH,
  loadSetup,
  saveSetup,
  type SetupPrefs,
} from './storage/setup.ts';
import { detectLocale, detectTheme, persistLocale, persistTheme, type Locale, type Theme } from './storage/prefs.ts';
import { useJob } from './state/useJob.ts';
import { AppHeader, Stepper, type Step } from './ui/Shell.tsx';
import { stepForPhase } from './ui/steps.ts';
import { SetupView } from './ui/SetupView.tsx';
import { SettingsView } from './ui/SettingsView.tsx';
import { BriefView } from './ui/BriefView.tsx';
import { VerifyView } from './ui/VerifyView.tsx';
import { RunView } from './ui/RunView.tsx';
import { DoneView } from './ui/DoneView.tsx';
import { liveFollowIndex } from './ui/compareText.ts';
import { ResumeBanner } from './ui/ResumeBanner.tsx';
import { DetailsDrawer } from './ui/DetailsDrawer.tsx';
import type { BookInfo } from './ui/BookDrop.tsx';
import { OfflineIcon, PauseIcon } from './ui/icons.tsx';

type PickedFile = File | { name: string; bytes: Uint8Array };

export default function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [theme, setTheme] = useState<Theme>(detectTheme);
  const t = catalogs[locale];

  const [stored, setStoredState] = useState<StoredProviders>(loadProviders);
  const [setup, setSetupState] = useState<SetupPrefs>(loadSetup);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);

  const { runner, snap, busy, run } = useJob(setup.logLimit);

  const [file, setFile] = useState<PickedFile | null>(null);
  const [book, setBook] = useState<BookInfo | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<{ code: ParseErrorCode; fileName: string } | null>(null);
  const [pending, setPending] = useState<Checkpoint | null>(null);
  const [guideDraft, setGuideDraft] = useState('');
  const [glossaryDraft, setGlossaryDraft] = useState<GlossaryEntry[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [setupStep, setSetupStep] = useState<'book' | 'settings'>('book');
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  const settingsRef = useRef<HTMLDivElement>(null);

  const preset = useMemo(
    () => PROVIDER_PRESETS.find((p) => p.id === stored.activeId) ?? PROVIDER_PRESETS[0]!,
    [stored.activeId],
  );
  const activeModel = stored.models[stored.activeId] ?? preset.defaultModel;

  const settings = useCallback(
    (): JobSettings => ({
      sourceLang: setup.sourceLang,
      targetLang: setup.targetLang,
      chunkChars: setup.chunkChars,
      logLimit: setup.logLimit,
      providerId: stored.activeId,
      model: activeModel,
      concurrency: clampConcurrency(setup.concurrency),
      glossaryBatch: clampBatch(setup.glossaryBatch, DEFAULT_GLOSSARY_BATCH),
      reviewBatch: clampBatch(setup.reviewBatch, DEFAULT_REVIEW_BATCH),
    }),
    [setup, stored.activeId, activeModel],
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => saveProviders(stored), [stored]);
  useEffect(() => saveSetup(setup), [setup]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    void loadCheckpoint().then((cp) => {
      if (cp && cp.phase !== 'done' && cp.phase !== 'idle') setPending(cp);
    });
  }, []);

  // Parse the picked file. The catch is the point: a corrupt or unsupported
  // file used to fail silently, leaving the button disabled with no reason.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setParsing(true);
    setParseError(null);
    void (async () => {
      try {
        await runner.prepare(file, settings(), stored);
        if (cancelled || !runner.book) return;
        setBook({
          fileName: runner.book.fileName,
          title: runner.book.title,
          format: runner.book.format,
          chapters: countChapters(runner.book.chunks),
          chunks: runner.book.chunks.length,
          bytes: file instanceof File ? file.size : file.bytes.length,
        });
        setPreviewIndex(0);
        setPinned(false);
      } catch (err) {
        if (cancelled) return;
        setBook(null);
        setParseError(
          err instanceof BookParseError
            ? { code: err.code, fileName: err.fileName }
            : { code: 'corrupt', fileName: file.name },
        );
      } finally {
        if (!cancelled) setParsing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-parses for a new file, split size, or language pair — not on every
    // keystroke. Languages matter because bilingual books drop target-language
    // paragraphs so the original pane stays in the source language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, setup.chunkChars, setup.sourceLang, setup.targetLang]);

  // Keeps the estimate honest when the provider, model, or generation prefs change.
  useEffect(() => {
    runner.applyPrefs(settings(), stored);
    void runner.refreshCost(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.activeId, activeModel, setup.concurrency, setup.glossaryBatch, setup.reviewBatch]);

  useEffect(() => {
    if (snap.styleGuide && !guideDraft) setGuideDraft(snap.styleGuide);
  }, [snap.styleGuide, guideDraft]);

  useEffect(() => {
    if (snap.phase === 'verify' || snap.phase === 'verifyReview') {
      setGuideDraft(snap.styleGuide);
    }
  }, [snap.styleGuide, snap.phase]);

  useEffect(() => {
    if (
      snap.phase === 'translate' ||
      snap.phase === 'paused' ||
      snap.phase === 'done' ||
      snap.phase === 'error' ||
      snap.phase === 'glossary' ||
      snap.phase === 'glossaryReview' ||
      snap.phase === 'verify' ||
      snap.phase === 'verifyReview' ||
      snap.phase === 'translateReview'
    ) {
      setGlossaryDraft(snap.glossary);
    }
  }, [snap.glossary, snap.phase]);

  useEffect(() => {
    if (snap.phase !== 'glossaryReview' || busy) return;
    void run(async () => {
      await runner.runTranslate();
    });
  }, [snap.phase, busy, run, runner]);

  const running = snap.phase === 'translate' || snap.phase === 'style' || snap.phase === 'glossary' || snap.phase === 'translateReview';

  useEffect(() => {
    if (!pinned && running && snap.translated.length > 0) {
      setPreviewIndex(liveFollowIndex(snap.liveIndex, snap.translated, snap.chunks.length));
    }
  }, [pinned, running, snap.liveIndex, snap.translated, snap.chunks.length]);

  const step: Step = stepForPhase(
    snap.phase,
    { setupStep, hasBook: Boolean(book) },
    snap.pausedDuring,
  );

  const onIndexChange = (i: number, pin: boolean) => {
    setPreviewIndex(i);
    setPinned(pin);
  };

  const startStyle = () =>
    void run(async () => {
      runner.applyPrefs(settings(), stored);
      await runner.runStyle();
    });

  const startVerify = () =>
    void run(async () => {
      runner.approveStyle(guideDraft || runner.styleGuide, glossaryDraft);
      await runner.runVerify();
    });

  const startGlossary = () =>
    void run(async () => {
      runner.approveStyle(runner.styleGuide, runner.glossary);
      await runner.runGlossary();
    });

  const resumeJob = () => void run(async () => { await runner.resume(); });

  const download = async () => {
    const packed = snap.packed ?? (await runner.pack());
    if (!packed) return;
    const blob = new Blob([packed.bytes as BlobPart], { type: packed.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = packed.fileName;
    a.click();
    // The old code leaked every object URL it created.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const exportBrief = () => {
    const payload = JSON.stringify(
      { styleGuide: guideDraft || snap.styleGuide, glossary: snap.glossary.length > 0 ? snap.glossary : glossaryDraft },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'style-brief.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const startOver = () => {
    if (snap.total > 0 && !confirm(t.startOverConfirm)) return;
    runner.reset();
    void clearCheckpoint();
    setFile(null);
    setBook(null);
    setParseError(null);
    setGuideDraft('');
    setGlossaryDraft([]);
    setPreviewIndex(0);
    setPinned(false);
    setSetupStep('book');
  };

  const fixSettings = (target: 'model' | 'advanced' | 'cors') => {
    if (target === 'cors') {
      const fallback =
        CORS_OPENROUTER_FALLBACK[stored.activeId] ?? 'nvidia/nemotron-3-nano-30b-a3b:free';
      setStoredState((s) => ({
        ...s,
        activeId: 'openrouter',
        models: { ...s.models, openrouter: fallback },
      }));
      setConnection(null);
    }
    runner.reset();
    setPending(null);
    setSetupStep('settings');
    requestAnimationFrame(() => {
      settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (target === 'advanced') {
        settingsRef.current?.querySelector('details')?.setAttribute('open', 'true');
      }
    });
  };

  const banners = (
    <>
      {!online && (
        <div className="card banner banner-danger" role="status">
          <span className="banner-icon error">
            <OfflineIcon />
          </span>
          <div>
            <strong>{t.offlineTitle}</strong>
            <p>{t.offlineHint}</p>
          </div>
        </div>
      )}
      {pending && snap.phase === 'idle' && (
        <ResumeBanner
          checkpoint={pending}
          busy={busy}
          onResume={() => {
            const cp = pending;
            setPending(null);
            setSetupState((s) => ({
              ...s,
              sourceLang: cp.settings.sourceLang,
              targetLang: cp.settings.targetLang,
              chunkChars: cp.settings.chunkChars ?? s.chunkChars,
              concurrency: cp.settings.concurrency ?? s.concurrency,
              glossaryBatch: cp.settings.glossaryBatch ?? s.glossaryBatch,
              reviewBatch: cp.settings.reviewBatch ?? s.reviewBatch,
            }));
            setGuideDraft(cp.styleGuide);
            setGlossaryDraft(cp.glossary);
            setSetupStep('settings');
            setBook({
              fileName: cp.fileName,
              title: cp.title,
              format: cp.format,
              chapters: countChapters(cp.chunks),
              chunks: cp.chunks.length,
              bytes: cp.fileBytes.length,
            });
            runner.restore(cp, stored);
            if (cp.phase !== 'review' && cp.phase !== 'style' && cp.phase !== 'verifyReview') {
              resumeJob();
            }
          }}
          onDiscard={() => {
            void clearCheckpoint();
            setPending(null);
          }}
        />
      )}
    </>
  );

  const wide = (step === 'run' || step === 'translateReview') && snap.phase !== 'done';
  const verifyLayout = step === 'verify';

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      <div className={wide ? 'shell shell-wide' : verifyLayout ? 'shell shell-verify' : 'shell'}>
        {!wide && (
          <>
            <AppHeader
              locale={locale}
              setLocale={setLocale}
              theme={theme}
              setTheme={setTheme}
              compact={step !== 'book'}
            />
            <Stepper current={step} />
          </>
        )}

        {!wide && <div className="stack">{banners}</div>}

        {snap.phase === 'idle' && setupStep === 'book' && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <SetupView
              book={book}
              parsing={parsing}
              parseError={parseError}
              onFile={(f) => setFile(f)}
              onDemo={() => {
                void buildDemoEpub().then((bytes) => {
                  setStoredState((s) => ({ ...s, activeId: 'mock' }));
                  setConnection(null);
                  setFile({ name: 'alice-excerpt.epub', bytes });
                });
              }}
              onClearError={() => setParseError(null)}
              onContinue={() => setSetupStep('settings')}
            />
          </div>
        )}

        {snap.phase === 'idle' && setupStep === 'settings' && (
          <div ref={settingsRef} style={{ marginTop: 'var(--space-4)' }}>
            <SettingsView
              bookLabel={
                book
                  ? fmt(t.readyBook, { chunks: book.chunks, chapters: book.chapters })
                  : null
              }
              parsing={parsing}
              setup={setup}
              setSetup={(fn) => setSetupState(fn)}
              stored={stored}
              setStored={(fn) => setStoredState(fn)}
              connection={connection}
              setConnection={setConnection}
              translatedCount={snap.translated.length}
              cost={snap.cost}
              onBack={() => setSetupStep('book')}
              onContinue={startStyle}
            />
          </div>
        )}

        {snap.phase === 'style' && (
          <PhaseLoading title={t.statusStyle} hint={fmt(t.sampledHint, { n: countReads(snap.events) })} onPause={() => runner.pause()} events={snap.events} />
        )}

        {snap.phase === 'review' && (
          <BriefView
            chunks={snap.chunks}
            events={snap.events}
            guide={guideDraft}
            setGuide={setGuideDraft}
            defaultGuide={snap.styleGuide}
            glossary={glossaryDraft}
            setGlossary={setGlossaryDraft}
            busy={busy}
            onContinue={startVerify}
          />
        )}

        {(snap.phase === 'verify' || snap.phase === 'verifyReview') && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <VerifyView
              runner={runner}
              chunks={snap.chunks}
              verifyIndex={snap.verifyIndex}
              verifyPair={snap.verifyPair}
              glossary={snap.glossary}
              sourceLang={setup.sourceLang}
              targetLang={setup.targetLang}
              translating={snap.phase === 'verify'}
              busy={busy}
              onChunkChange={(index) => void run(async () => { await runner.runVerify({ index }); })}
              onContinue={startGlossary}
            />
          </div>
        )}

        {(snap.phase === 'glossary' || snap.phase === 'glossaryReview') && (
          <PhaseLoading
            title={t.statusGlossary}
            hint={fmt(t.glossaryProgress, { n: snap.glossaryIndex, total: Math.max(snap.glossaryTotal, 1) })}
            onPause={() => runner.pause()}
            events={snap.events}
          />
        )}

        {wide && (
          <RunView
            snap={snap}
            sourceLang={setup.sourceLang}
            targetLang={setup.targetLang}
            providerLabel={`${preset.label} · ${activeModel}`}
            busy={busy}
            index={previewIndex}
            pinned={pinned}
            failure={snap.failure}
            onIndexChange={onIndexChange}
            onPause={() => runner.pause()}
            onStop={() => runner.stop()}
            onResume={resumeJob}
            onRetryKept={() => void run(async () => { await runner.retryKeptOriginal(); })}
            onContinueTrial={() => void run(async () => { await runner.runTranslate(); })}
            onDownloadPartial={() => void download()}
            onFixSettings={fixSettings}
          />
        )}

        {snap.phase === 'done' && (
          <DoneView
            snap={snap}
            sourceLang={setup.sourceLang}
            targetLang={setup.targetLang}
            busy={busy}
            index={previewIndex}
            onIndexChange={onIndexChange}
            onDownload={() => void download()}
            onRetryKept={() => void run(async () => { await runner.retryKeptOriginal(); })}
            onStartOver={startOver}
            onExportBrief={exportBrief}
          />
        )}
      </div>
    </I18nContext.Provider>
  );
}

function PhaseLoading({
  title,
  hint,
  events,
  onPause,
}: {
  title: string;
  hint: string;
  events: JobEventList;
  onPause: () => void;
}) {
  const { t } = useT();
  return (
    <div className="stack">
      <div className="card" aria-busy="true">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span className="spinner" />
          <div style={{ flexGrow: 1 }}>
            <strong>{title}</strong>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              {hint}
            </p>
          </div>
          <button className="btn btn-sm" type="button" onClick={onPause}>
            <PauseIcon />
            {t.pause}
          </button>
        </div>
      </div>
      <DetailsDrawer events={events} />
    </div>
  );
}

type JobEventList = Parameters<typeof DetailsDrawer>[0]['events'];

function countReads(events: JobEventList): number {
  return events.filter((e) => e.key === 'readChunk').length;
}

function countChapters(chunks: Chunk[]): number {
  let n = 0;
  let last = '';
  for (const c of chunks) {
    const key = `${c.documentPath}::${c.chapterTitle}`;
    if (key !== last) {
      n += 1;
      last = key;
    }
  }
  return n;
}
