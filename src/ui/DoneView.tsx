import type { JobSnapshot } from '../job/runner.ts';
import { fmt, formatDuration, approxUsd, shortLanguageName, useT } from '../i18n/index.ts';
import { CheckIcon, DownloadIcon, WarnIcon } from './icons.tsx';
import { CompareView } from './CompareView.tsx';
import { DetailsDrawer } from './DetailsDrawer.tsx';
import { GlossaryTable } from './GlossaryTable.tsx';

type Props = {
  snap: JobSnapshot;
  sourceLang: string;
  targetLang: string;
  busy: boolean;
  index: number;
  onIndexChange: (i: number, pinned: boolean) => void;
  onDownload: () => void;
  onRetryKept: () => void;
  onStartOver: () => void;
  onExportBrief: () => void;
};

export function DoneView(props: Props) {
  const { t, locale } = useT();
  const { snap } = props;
  const translated = snap.translated.length - snap.keptOriginal;

  return (
    <div className="stack">
      <div className="card" style={{ padding: 'var(--space-8)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
          <span
            className="ok"
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CheckIcon size={22} />
          </span>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <h1 className="serif" style={{ margin: 0, fontSize: '1.6rem', fontWeight: 600 }}>
              {fmt(t.doneTitle, { title: snap.title })}
            </h1>
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {fmt(t.doneSubtitle, {
                from: shortLanguageName(props.sourceLang, locale),
                to: shortLanguageName(props.targetLang, locale),
                time: formatDuration(snap.elapsedMs, t),
              })}
            </p>
          </div>
        </div>

        <dl
          className="stats"
          style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', margin: 'var(--space-6) 0' }}
        >
          <div>
            <dt>{t.doneChunks}</dt>
            <dd>{snap.total}</dd>
          </div>
          <div>
            <dt>{t.doneTranslated}</dt>
            <dd className="ok">{translated}</dd>
          </div>
          <div>
            <dt>{t.doneKept}</dt>
            <dd className={snap.keptOriginal > 0 ? 'warn' : undefined}>{snap.keptOriginal}</dd>
          </div>
          <div>
            <dt>{t.doneTokens}</dt>
            <dd>
              {snap.cost
                ? `~${Math.round((snap.cost.inputTokens + snap.cost.outputTokens) / 1000)}k`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>{t.doneCost}</dt>
            <dd>{snap.cost ? approxUsd(snap.cost.usd, t) : '—'}</dd>
          </div>
        </dl>

        {snap.keptOriginal > 0 && (
          <div
            className="banner banner-warn"
            style={{
              border: '1px solid var(--line)',
              borderLeftWidth: 3,
              borderRadius: 'var(--radius-control)',
              background: 'var(--bg-2)',
              padding: '13px 15px',
              marginBottom: 'var(--space-5)',
            }}
          >
            <span className="banner-icon warn">
              <WarnIcon size={17} />
            </span>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <strong>{fmt(t.doneKeptTitle, { n: snap.keptOriginal })}</strong>
              <p>{t.doneKeptBody}</p>
              <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
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
                  disabled={props.busy}
                  onClick={props.onRetryKept}
                >
                  {t.issuesRetry}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={props.busy || !snap.packed}
            onClick={props.onDownload}
            style={{ padding: '12px 20px' }}
          >
            <DownloadIcon size={17} />
            {snap.packed
              ? fmt(t.download, { file: snap.packed.fileName })
              : t.preparingDownload}
          </button>
          <span style={{ flexGrow: 1 }} />
          <button className="btn" type="button" onClick={props.onStartOver}>
            {t.startOver}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{t.keepBrief}</h2>
        <p className="hint" style={{ margin: '5px 0 var(--space-4)' }}>
          {fmt(t.keepBriefBody, { n: snap.glossary.length })}
        </p>
        <div className="actions">
          <button className="btn btn-sm" type="button" onClick={props.onExportBrief}>
            {t.exportBrief}
          </button>
        </div>
      </div>

      <GlossaryTable entries={snap.glossary} readOnly />

      <div className="card">
        <CompareView
          chunks={snap.chunks}
          translated={snap.translated}
          liveIndex={snap.total}
          followLive={false}
          sourceLang={props.sourceLang}
          targetLang={props.targetLang}
          index={props.index}
          pinned={false}
          onIndexChange={props.onIndexChange}
        />
      </div>

      <DetailsDrawer events={snap.events} />
    </div>
  );
}
