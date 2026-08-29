import type { Checkpoint } from '../job/types.ts';
import { fmt, formatAgo, shortLanguageName, useT } from '../i18n/index.ts';
import { BookIcon } from './icons.tsx';

/** Replaces a banner that printed the raw phase enum and no timestamp. */
export function ResumeBanner(props: {
  checkpoint: Checkpoint;
  onResume: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const { t, locale } = useT();
  const cp = props.checkpoint;
  const done = cp.translated.length;
  const pct = cp.chunks.length ? Math.round((done / cp.chunks.length) * 100) : 0;
  const state =
    cp.phase === 'review' || cp.phase === 'style'
      ? t.statusReview
      : cp.phase === 'verify' || cp.phase === 'verifyReview'
        ? t.statusVerifyReview
        : cp.phase === 'glossary' || cp.phase === 'glossaryReview'
        ? t.statusGlossary
        : t.statusPaused;

  return (
    <div className="card banner">
      <span className="banner-icon hint">
        <BookIcon />
      </span>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <strong>{t.resumeBanner}</strong>
        <p>
          <span className="serif" style={{ color: 'var(--ink)' }}>
            {cp.title}
          </span>{' '}
          ·{' '}
          {fmt(t.resumeMeta, {
            state,
            ago: cp.savedAt ? formatAgo(cp.savedAt, t) : '',
            index: done,
            total: cp.chunks.length,
            from: shortLanguageName(cp.settings.sourceLang, locale),
            to: shortLanguageName(cp.settings.targetLang, locale),
          })}
        </p>
        <div className="progress" style={{ marginTop: 'var(--space-3)', maxWidth: 280 }}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
          <button className="btn btn-primary" type="button" disabled={props.busy} onClick={props.onResume}>
            {t.resumeAction}
          </button>
          <button className="btn" type="button" onClick={props.onDiscard}>
            {t.resumeDiscard}
          </button>
        </div>
      </div>
    </div>
  );
}
