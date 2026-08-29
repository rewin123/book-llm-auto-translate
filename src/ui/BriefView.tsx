import { useMemo, useState } from 'react';
import type { Chunk } from '../ebook/types.ts';
import type { GlossaryEntry } from '../glossary/index.ts';
import type { JobEvent } from '../job/types.ts';
import { fmt, useT } from '../i18n/index.ts';
import { markdownToPlainText } from '../ebook/markdown.ts';
import { ArrowRight, ChevronRight } from './icons.tsx';
import { GlossaryTable } from './GlossaryTable.tsx';

const WIDE_BRIEF = '(min-width: 901px)';

type Props = {
  chunks: Chunk[];
  events: JobEvent[];
  guide: string;
  setGuide: (v: string) => void;
  defaultGuide: string;
  glossary: GlossaryEntry[];
  setGlossary: (next: GlossaryEntry[]) => void;
  busy: boolean;
  onContinue: () => void;
};

export function BriefView(props: Props) {
  const { t } = useT();
  // Desktop keeps the sample pane open beside the editor; phones start collapsed
  // so the guidelines stay on screen.
  const [sampledOpen, setSampledOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(WIDE_BRIEF).matches,
  );

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

  return (
    <div className="stack">
      <p className="hint" style={{ margin: 0, maxWidth: '54rem' }}>
        {t.briefIntro}
      </p>

      <div className={`brief-grid${sampled.length > 0 ? ' has-sampled' : ''}`}>
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
            className="brief-guide"
            value={props.guide}
            placeholder={t.styleBriefEmpty}
            onChange={(e) => props.setGuide(e.target.value)}
          />
        </div>

        {sampled.length > 0 && (
          <details
            className="disclosure brief-sampled"
            open={sampledOpen}
            onToggle={(e) => {
              const next = e.currentTarget.open;
              if (next !== sampledOpen) setSampledOpen(next);
            }}
          >
            <summary>
              <span className="chev">
                <ChevronRight />
              </span>
              <strong>{t.sampledTitle}</strong>
              <span>{fmt(t.sampledHint, { n: sampled.length })}</span>
            </summary>
            <div className="body">
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
                      {fmt(t.chunkHeading, { n: index + 1, total: props.chunks.length })}
                      {chunk.chapterTitle.trim() ? ` · ${chunk.chapterTitle}` : ''}
                    </div>
                    <div className="serif" style={{ fontSize: '0.95rem', lineHeight: 1.55 }}>
                      {markdownToPlainText(chunk.markdown).slice(0, 150).trim()}…
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>

      <GlossaryTable entries={props.glossary} onChange={props.setGlossary} />

      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-6)',
            flexWrap: 'wrap',
          }}
        >
          <p className="hint" style={{ margin: 0, maxWidth: '40rem' }}>
            {t.verifyNextHint}
          </p>
          <button
            className="btn btn-primary"
            type="button"
            disabled={props.busy || props.chunks.length === 0}
            onClick={props.onContinue}
            style={{ padding: '12px 20px' }}
          >
            {t.continueToVerify}
            <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}
