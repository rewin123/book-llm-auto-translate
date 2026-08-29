import { useState } from 'react';
import type { Chunk } from '../ebook/types.ts';
import type { GlossaryEntry } from '../glossary/index.ts';
import type { CostEstimate } from '../job/types.ts';
import { scaleCost } from '../job/cost.ts';
import { approxUsd, fmt, formatDuration, useT } from '../i18n/index.ts';
import { ArrowRight } from './icons.tsx';
import { GlossaryTable } from './GlossaryTable.tsx';

type Props = {
  chunks: Chunk[];
  glossary: GlossaryEntry[];
  setGlossary: (next: GlossaryEntry[]) => void;
  cost: CostEstimate | null;
  busy: boolean;
  firstChapterChunks: number;
  onTranslate: (chunkLimit: number) => void;
};

export function GlossaryView(props: Props) {
  const { t } = useT();
  const total = props.chunks.length;
  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  const n = clampLimit(limitDraft ?? total, total);
  const shown = props.cost ? scaleCost(props.cost, n) : null;
  const firstChapter = props.firstChapterChunks;
  const showFirst = firstChapter > 0 && firstChapter < total;

  return (
    <div className="stack">
      <p className="hint" style={{ margin: 0, maxWidth: '54rem' }}>
        {t.glossaryReviewIntro}
      </p>

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
                  value={limitDraft ?? total}
                  onChange={(e) => setLimitDraft(Number(e.target.value))}
                  onBlur={() => setLimitDraft(n)}
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
                    onClick={() => setLimitDraft(firstChapter)}
                  >
                    {fmt(t.chunkLimitFirst, { n: firstChapter })}
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  type="button"
                  aria-pressed={n === total}
                  onClick={() => setLimitDraft(total)}
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
