import { useEffect, useRef, useState } from 'react';
import type { Chunk } from '../ebook/types.ts';
import type { LlmCallAttempt, TranslatedPair } from '../job/types.ts';
import { fmt, shortLanguageName, useT } from '../i18n/index.ts';
import { comparePaneMarkdown, reviewDiffHtml } from './compareText.ts';
import { markupToSafeHtml } from './sanitize.ts';
import { CheckIcon, ChevronLeft, ChevronRight, InfoIcon, WarnIcon } from './icons.tsx';

export type CompareMode = 'both' | 'translation' | 'original';

type Props = {
  chunks: Chunk[];
  translated: TranslatedPair[];
  liveIndex: number;
  followLive: boolean;
  sourceLang: string;
  targetLang: string;
  index: number;
  onIndexChange: (i: number, pinned: boolean) => void;
  pinned: boolean;
  /** Side-by-side original translation vs seam-review rewrite, with a word diff. */
  reviewDiff?: boolean;
};

/**
 * Shows the source and the translation together. `TranslatedPair` has always
 * carried both, but the old preview rendered one on top of the other, so a
 * translation could never actually be compared with what it came from.
 */
export function CompareView(props: Props) {
  const { t, locale } = useT();
  const [mode, setMode] = useState<CompareMode>('both');
  const scrollRef = useRef<HTMLDivElement>(null);

  const max = Math.max(props.chunks.length - 1, 0);
  const idx = Math.min(Math.max(props.index, 0), max);
  const chunk = props.chunks[idx];
  const pair = props.translated.find((p) => p.index === idx);
  const panes = chunk ? comparePaneMarkdown(chunk, pair) : null;
  const review = props.reviewDiff && pair ? reviewDiffHtml(pair) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft') props.onIndexChange(Math.max(idx - 1, 0), true);
      if (e.key === 'ArrowRight') props.onIndexChange(Math.min(idx + 1, max), true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, max, props]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [idx]);

  if (!chunk || !panes) return null;

  const showOriginal = mode !== 'translation';
  const showTranslation = mode !== 'original';
  const ready = panes.ready;
  const kept = pair?.usedOriginal === true;

  return (
    <>
      <div className="compare-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span className="hint">
            {fmt(t.chunkHeading, { n: idx + 1, total: props.chunks.length })}
            {chunk.chapterTitle.trim() ? ` · ${chunk.chapterTitle}` : ''}
          </span>
          {kept ? (
            <span className="pill warn">
              <WarnIcon size={12} />
              {fmt(t.chunkKept, { lang: shortLanguageName(props.sourceLang, locale) })}
            </span>
          ) : review ? (
            <span className={review.changed ? 'pill ok' : 'pill'}>
              {review.changed ? t.reviewEdited : t.reviewNoEdits}
            </span>
          ) : ready ? (
            <span className="pill ok">
              <CheckIcon size={12} />
              {t.validated}
            </span>
          ) : (
            <span className="pill">{t.chunkPending}</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div className="segmented" role="group" aria-label={t.compareBoth}>
            <button type="button" aria-pressed={mode === 'both'} onClick={() => setMode('both')}>
              {t.compareBoth}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'translation'}
              onClick={() => setMode('translation')}
            >
              {t.compareTranslation}
            </button>
          </div>
          <button
            className="btn btn-sm"
            type="button"
            aria-label={t.prev}
            title={t.prev}
            disabled={idx <= 0}
            onClick={() => props.onIndexChange(idx - 1, true)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="btn btn-sm"
            type="button"
            aria-label={t.next}
            title={t.next}
            disabled={idx >= max}
            onClick={() => props.onIndexChange(idx + 1, true)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {props.pinned && props.followLive && props.liveIndex > 0 && (
        <div className="notice">
          <span className="hint" style={{ display: 'flex' }}>
            <InfoIcon />
          </span>
          <span className="grow">{fmt(t.pinnedNotice, { n: idx + 1 })}</span>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => props.onIndexChange(Math.max(props.liveIndex - 1, 0), false)}
          >
            {fmt(t.jumpLive, { n: props.liveIndex })}
          </button>
        </div>
      )}

      <div
        className={`compare-panes ${mode === 'both' ? '' : 'single'}`}
        ref={scrollRef}
      >
        {showOriginal && (
          <section key={`orig-${idx}`}>
            <div className="pane-cap">
              <span>
                {review
                  ? t.reviewBefore
                  : fmt(t.original, { lang: shortLanguageName(props.sourceLang, locale) })}
              </span>
            </div>
            <article
              className="page"
              dangerouslySetInnerHTML={{
                __html: review ? review.before : markupToSafeHtml(panes.original),
              }}
            />
          </section>
        )}
        {showTranslation && (
          <section key={`tr-${idx}`}>
            <div className="pane-cap">
              <span>
                {review
                  ? t.reviewAfter
                  : fmt(t.translation, { lang: shortLanguageName(props.targetLang, locale) })}
              </span>
              {ready && !kept && !review && (
                <span className="ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <CheckIcon size={12} />
                  {t.validated}
                </span>
              )}
            </div>
            <article
              key={`tr-html-${idx}-${ready ? 'ready' : 'pending'}-${review?.changed ? 'diff' : 'same'}`}
              className={`page ${ready ? '' : 'is-pending'}`}
              dangerouslySetInnerHTML={{
                __html: review ? review.after : markupToSafeHtml(panes.translation),
              }}
            />
          </section>
        )}
      </div>

      {pair?.llmCalls && pair.llmCalls.length > 0 && <LlmCallLog calls={pair.llmCalls} />}
    </>
  );
}

function LlmCallLog({ calls }: { calls: LlmCallAttempt[] }) {
  const { t } = useT();
  return (
    <details className="disclosure llm-call-log">
      <summary>
        <span className="chev">
          <ChevronRight />
        </span>
        <strong>{t.llmCallLog}</strong>
        <span>{t.llmCallLogHint}</span>
      </summary>
      <div className="body">
        {calls.map((call, i) => (
          <div key={i} className="llm-call-attempt">
            {calls.length > 1 && (
              <div className="pane-cap">{fmt(t.llmCallAttempt, { n: i + 1, total: calls.length })}</div>
            )}
            <section>
              <div className="pane-cap">{t.llmCallInstructions}</div>
              <pre>{call.instructions}</pre>
            </section>
            <section>
              <div className="pane-cap">{t.llmCallUser}</div>
              <pre>{call.user}</pre>
            </section>
            <section>
              <div className="pane-cap">{t.llmCallResponse}</div>
              <pre>{call.response}</pre>
            </section>
          </div>
        ))}
      </div>
    </details>
  );
}
