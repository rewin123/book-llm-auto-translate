import type { Chunk } from '../ebook/types.ts';
import type { JobFailure, JobPhase } from '../job/types.ts';
import type { JobSnapshot } from '../job/runner.ts';
import { fmt, formatDuration, formatUsd, shortLanguageName, useT } from '../i18n/index.ts';
import { BookIcon, DownloadIcon, PauseIcon, PlayIcon, StopIcon, WarnIcon } from './icons.tsx';
import { ChapterRail } from './ChapterRail.tsx';
import { CompareView } from './CompareView.tsx';
import { DetailsDrawer, LiveStatus, eventText } from './DetailsDrawer.tsx';
import { FailureBanner } from './FailureBanner.tsx';
import { GlossaryTable } from './GlossaryTable.tsx';

type Props = {
  snap: JobSnapshot;
  sourceLang: string;
  targetLang: string;
  providerLabel: string;
  busy: boolean;
  index: number;
  pinned: boolean;
  onIndexChange: (i: number, pinned: boolean) => void;
  onPause: () => void;
  onStop: () => void;
  onResume: () => void;
  onRetryKept: () => void;
  onContinueTrial: () => void;
  onDownloadPartial: () => void;
  onFixSettings: (target: 'model' | 'advanced' | 'cors') => void;
  failure: JobFailure | null;
};

const RUNNING: JobPhase[] = ['translate', 'style', 'glossary'];

export function RunView(props: Props) {
  const { t, locale } = useT();
  const { snap } = props;
  const running = RUNNING.includes(snap.phase);
  const done = snap.translated.length;
  const pct = snap.total ? Math.round((done / snap.total) * 100) : 0;
  const lastEvent = snap.events[snap.events.length - 1];
  const trialFinished =
    snap.phase === 'paused' && done > 0 && done < snap.total && snap.trialLimit !== null;

  const chapterCount = countChapters(snap.chunks);
  const currentChapter = countChapters(snap.chunks.slice(0, Math.max(snap.liveIndex, 1)));

  return (
    <div className="run">
      <div className="run-bar">
        <div className="run-bar-top">
          <div className="run-title">
            <span className="hint" style={{ display: 'flex', flexShrink: 0 }}>
              <BookIcon />
            </span>
            <strong>{snap.title}</strong>
            <span className="pill">
              {shortLanguageName(props.sourceLang, locale)} →{' '}
              {shortLanguageName(props.targetLang, locale)}
            </span>
            <span className="pill">{props.providerLabel}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span className="status-pill" data-state={snap.phase}>
              <span className="dot" />
              {statusLabel(snap.phase, t)}
            </span>
            {running && (
              <>
                <button className="btn btn-sm" type="button" onClick={props.onPause}>
                  <PauseIcon />
                  {t.pause}
                </button>
                <button className="btn btn-sm" type="button" onClick={props.onStop}>
                  <StopIcon />
                  {t.stop}
                </button>
              </>
            )}
            {snap.phase === 'paused' && !trialFinished && (
              <button className="btn btn-sm btn-primary" type="button" disabled={props.busy} onClick={props.onResume}>
                <PlayIcon />
                {t.resume}
              </button>
            )}
            {(snap.phase === 'paused' || snap.phase === 'error') && (
              <button className="btn btn-sm" type="button" onClick={props.onDownloadPartial}>
                <DownloadIcon size={14} />
                {t.downloadPartial}
              </button>
            )}
          </div>
        </div>

        <div className="run-bar-progress">
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.statusTranslating}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="run-meta">
            <span>
              <strong style={{ color: 'var(--ink)' }}>
                {fmt(t.progressOf, { done: snap.translated.length, total: snap.total })}
              </strong>
              {chapterCount > 0 && (
                <> · {fmt(t.chapterOf, { n: Math.max(currentChapter, 1), total: chapterCount })}</>
              )}
              {snap.etaMs != null && running && <> · {fmt(t.timeLeft, { time: formatDuration(snap.etaMs, t) })}</>}
            </span>
            <span className="run-meta-right">
              {snap.keptOriginal > 0 && (
                <span className="warn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <WarnIcon size={13} />
                  {fmt(t.keptCount, { n: snap.keptOriginal })}
                </span>
              )}
              {snap.cost?.usd != null && done > 0 && (
                <span>
                  {fmt(t.spentSoFar, {
                    cost: formatUsd((snap.cost.usd / Math.max(snap.total, 1)) * done, t),
                  })}
                </span>
              )}
              {snap.elapsedMs > 0 && done > 0 && (
                <span>{fmt(t.perChunk, { secs: Math.round(snap.elapsedMs / done / 1000) })}</span>
              )}
            </span>
          </div>
        </div>
      </div>

      <LiveStatus text={lastEvent ? eventText(lastEvent, t) : ''} />

      <div className="run-body">
        <ChapterRail
          chunks={snap.chunks}
          translated={snap.translated}
          liveIndex={snap.liveIndex}
          currentIndex={props.index}
          onJump={(i) => props.onIndexChange(i, true)}
        />

        <div className="run-main">
          {props.failure && (
            <FailureBanner
              failure={props.failure}
              provider={props.providerLabel}
              onRetry={props.onResume}
              onFixSettings={props.onFixSettings}
              busy={props.busy}
            />
          )}

          {trialFinished && (
            <div className="card banner">
              <div style={{ flexGrow: 1 }}>
                <strong>{fmt(t.trialFinished, { n: done })}</strong>
                <p>{t.trialFinishedBody}</p>
                <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={props.busy}
                    onClick={props.onContinueTrial}
                  >
                    {t.trialContinue}
                  </button>
                </div>
              </div>
            </div>
          )}

          <CompareView
            chunks={snap.chunks}
            translated={snap.translated}
            liveIndex={snap.liveIndex}
            followLive={running}
            sourceLang={props.sourceLang}
            targetLang={props.targetLang}
            index={props.index}
            pinned={props.pinned}
            onIndexChange={props.onIndexChange}
          />

          <GlossaryTable entries={snap.glossary} readOnly />

          {snap.keptOriginal > 0 && (
            <div
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}
            >
              <span className="warn" style={{ display: 'flex' }}>
                <WarnIcon size={16} />
              </span>
              <span style={{ flexGrow: 1, fontSize: 'var(--text-sm)', minWidth: 240 }}>
                <strong>{fmt(t.issuesTitle, { n: snap.keptOriginal })}</strong>{' '}
                <span className="hint">{t.issuesBody}</span>
              </span>
              <div className="actions">
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => {
                    const first = snap.translated.find((p) => p.usedOriginal);
                    if (first) props.onIndexChange(first.index, true);
                  }}
                >
                  {t.issuesReview}
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={props.busy || running}
                  onClick={props.onRetryKept}
                >
                  {t.issuesRetry}
                </button>
              </div>
            </div>
          )}

          <DetailsDrawer events={snap.events} />
        </div>
      </div>
    </div>
  );
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

function statusLabel(phase: JobPhase, t: ReturnType<typeof useT>['t']): string {
  switch (phase) {
    case 'style':
      return t.statusStyle;
    case 'review':
      return t.statusReview;
    case 'glossary':
      return t.statusGlossary;
    case 'glossaryReview':
      return t.statusGlossaryReview;
    case 'translate':
      return t.statusTranslating;
    case 'paused':
      return t.statusPaused;
    case 'done':
      return t.statusDone;
    case 'error':
      return t.statusStopped;
    default:
      return t.statusIdle;
  }
}
