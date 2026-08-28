import { useEffect, useMemo, useState } from 'react';
import type { Chunk } from '../ebook/types.ts';
import type { GlossaryEntry } from '../glossary/index.ts';
import type { CostEstimate, JobEvent } from '../job/types.ts';
import { scaleCost } from '../job/cost.ts';
import { approxUsd, fmt, formatDuration, useT } from '../i18n/index.ts';
import { extractPlainText } from '../ebook/xml.ts';
import { ArrowRight } from './icons.tsx';
import { GlossaryTable } from './GlossaryTable.tsx';

type Props = {
  chunks: Chunk[];
  events: JobEvent[];
  guide: string;
  setGuide: (v: string) => void;
  defaultGuide: string;
  glossary: GlossaryEntry[];
  setGlossary: (next: GlossaryEntry[]) => void;
  cost: CostEstimate | null;
  busy: boolean;
  onTranslate: (chunkLimit: number) => void;
  firstChapterChunks: number;
};

export function BriefView(props: Props) {
  const { t } = useT();
  const total = props.chunks.length;
  const [limit, setLimit] = useState(total);

  useEffect(() => {
    setLimit(total);
  }, [total]);

  const sampled = useMemo(() => {
    const seen = new Set<number>();
    for (const e of props.events) {
      if (e.key === 'readChunk' && typeof e.params?.idx === 'number') seen.add(e.params.idx);
    }
    return [...seen]
      .filter((i) => i >= 0 && i < props.chunks.length)
      .slice(0, 6)
      .map((i) => ({ index: i, chunk: props.chunks[i]! }));
  }, [props.events, props.chunks]);

  const edited = props.guide !== props.defaultGuide && props.defaultGuide !== '';
  const n = clampLimit(limit, total);
  const shown = props.cost ? scaleCost(props.cost, n) : null;
  const firstChapter = props.firstChapterChunks;
  const showFirst =
    firstChapter > 0 && firstChapter < total;

  return (
    <div className="stack">
      <p className="hint" style={{ margin: 0, maxWidth: '54rem' }}>
        {t.briefIntro}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: sampled.length > 0 ? '1.45fr 1fr' : 'minmax(0, 1fr)',
          gap: 'var(--space-4)',
          alignItems: 'start',
        }}
        className="brief-grid"
      >
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <h2>
              {t.styleBrief}{' '}
              {edited && (
                <span
                  className="pill"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--cta-ink)',
                    borderColor: 'var(--accent)',
                    fontWeight: 600,
                  }}
                >
                  {t.edited}
                </span>
              )}
            </h2>
            <button
              className="btn btn-sm"
              type="button"
              disabled={!props.defaultGuide || !edited}
              onClick={() => props.setGuide(props.defaultGuide)}
            >
              {t.reset}
            </button>
          </div>
          <label htmlFor="style-guide" className="sr-only">
            {t.styleBrief}
          </label>
          <textarea
            id="style-guide"
            value={props.guide}
            placeholder={t.styleBriefEmpty}
            onChange={(e) => props.setGuide(e.target.value)}
            style={{ minHeight: 380 }}
          />
        </div>

        {sampled.length > 0 && (
          <div className="card">
            <h2>{t.sampledTitle}</h2>
            <p className="hint" style={{ margin: '3px 0 var(--space-4)' }}>
              {fmt(t.sampledHint, { n: sampled.length })}
            </p>
            <div className="stack" style={{ gap: 'var(--space-3)' }}>
              {sampled.map(({ index, chunk }) => (
                <div
                  key={index}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-control)',
                    padding: '11px 13px',
                    background: 'var(--bg)',
                  }}
                >
                  <div className="hint" style={{ fontSize: 'var(--text-2xs)', marginBottom: 5 }}>
                    {fmt(t.chunkHeading, { n: index + 1, total: props.chunks.length })} ·{' '}
                    {chunk.chapterTitle}
                  </div>
                  <div className="serif" style={{ fontSize: '0.95rem', lineHeight: 1.55 }}>
                    {extractPlainText(chunk.xml).slice(0, 150).trim()}…
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <GlossaryTable entries={props.glossary} onChange={props.setGlossary} />

      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-8)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flexGrow: 1, minWidth: 260 }}>
            <div style={{ maxWidth: 280, marginBottom: 'var(--space-4)' }}>
              <label htmlFor="chunk-limit">{t.chunkLimit}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  id="chunk-limit"
                  type="number"
                  min={1}
                  max={total}
                  step={1}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  onBlur={() => setLimit(n)}
                  style={{ flex: '1 1 8rem' }}
                />
                <span className="hint" style={{ flexShrink: 0 }}>
                  {fmt(t.chunkLimitOf, { total })}
                </span>
              </div>
              <div className="actions" style={{ marginTop: 'var(--space-2)' }}>
                {showFirst && (
                  <button
                    className="btn btn-sm"
                    type="button"
                    aria-pressed={n === firstChapter}
                    onClick={() => setLimit(firstChapter)}
                  >
                    {fmt(t.chunkLimitFirst, { n: firstChapter })}
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  type="button"
                  aria-pressed={n === total}
                  onClick={() => setLimit(total)}
                >
                  {fmt(t.chunkLimitAll, { n: total })}
                </button>
              </div>
              <p className="hint" style={{ margin: '6px 0 0' }}>
                {t.chunkLimitHint}
              </p>
            </div>

            <dl
              className="stats"
              style={{
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                margin: '0 0 var(--space-3)',
              }}
            >
              <div>
                <dt>{t.costChunks}</dt>
                <dd>{shown?.chunks ?? n}</dd>
              </div>
              <div>
                <dt>{t.costTokens}</dt>
                <dd>
                  {shown
                    ? `~${Math.round((shown.inputTokens + shown.outputTokens) / 1000)}k`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{t.costCost}</dt>
                <dd>{shown ? approxUsd(shown.usd, t) : '—'}</dd>
              </div>
              <div>
                <dt>{t.costTime}</dt>
                <dd>{shown?.etaMs ? `~${formatDuration(shown.etaMs, t)}` : '—'}</dd>
              </div>
            </dl>
            <p className="hint" style={{ margin: 0, maxWidth: '46rem' }}>
              {fmt(t.costNote, { n, model: shown?.model ?? props.cost?.model ?? '' })}
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              minWidth: 240,
              flexShrink: 0,
            }}
          >
            <button
              className="btn btn-primary"
              type="button"
              disabled={props.busy || total === 0}
              onClick={() => props.onTranslate(n)}
              style={{ padding: '12px 20px' }}
            >
              {n >= total ? t.translateAll : fmt(t.translateCount, { n })}
              <ArrowRight />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clampLimit(raw: number, total: number): number {
  if (!Number.isFinite(raw) || total < 1) return Math.max(total, 0);
  return Math.min(total, Math.max(1, Math.round(raw)));
}
