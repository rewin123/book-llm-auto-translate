import { useState } from 'react';
import { parseGlossaryLines, type GlossaryEntry } from '../glossary/index.ts';
import { fmt, useT } from '../i18n/index.ts';
import { PlusIcon, TrashIcon } from './icons.tsx';

type Props = {
  entries: GlossaryEntry[];
  onChange: (next: GlossaryEntry[]) => void;
};

/**
 * The glossary was already built, filtered per chunk and pushed into every
 * prompt — it just had nowhere to be seen or corrected. This is that surface.
 */
export function GlossaryTable({ entries, onChange }: Props) {
  const { t } = useT();
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');

  const update = (i: number, patch: Partial<GlossaryEntry>) => {
    onChange(entries.map((e, n) => (n === i ? { ...e, ...patch } : e)));
  };

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2>
            {t.glossary}{' '}
            <span className="hint" style={{ fontWeight: 400 }}>
              {fmt(t.glossaryCount, { n: entries.length })}
            </span>
          </h2>
          <p className="hint" style={{ margin: '3px 0 0', maxWidth: '44rem' }}>
            {t.glossaryHint}
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-sm" type="button" onClick={() => setPasting((v) => !v)}>
            {t.glossaryPaste}
          </button>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => onChange([...entries, { src: '', dst: '' }])}
          >
            <PlusIcon size={13} />
            {t.glossaryAdd}
          </button>
        </div>
      </div>

      {pasting && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="glossary-paste">{t.glossaryPasteHint}</label>
          <textarea
            id="glossary-paste"
            value={draft}
            style={{ minHeight: 120, fontFamily: 'inherit' }}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="actions" style={{ marginTop: 'var(--space-2)' }}>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              onClick={() => {
                const parsed = parseGlossaryLines(draft);
                const seen = new Map(entries.map((e) => [e.src, e]));
                for (const entry of parsed) seen.set(entry.src, entry);
                onChange([...seen.values()]);
                setDraft('');
                setPasting(false);
              }}
            >
              {t.glossaryPasteApply}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setPasting(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="hint" style={{ margin: 'var(--space-4) 0 0' }}>
          {t.glossaryEmpty}
        </p>
      ) : (
        <div className="glossary" style={{ marginTop: 'var(--space-4)' }}>
          <div className="head">{t.glossarySrc}</div>
          <div className="head">{t.glossaryDst}</div>
          <div className="head" aria-hidden="true" />
          {entries.map((entry, i) => (
            <Row
              key={i}
              entry={entry}
              index={i}
              onPatch={(patch) => update(i, patch)}
              onRemove={() => onChange(entries.filter((_, n) => n !== i))}
              removeLabel={t.glossaryRemove}
              srcLabel={t.glossarySrc}
              dstLabel={t.glossaryDst}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row(props: {
  entry: GlossaryEntry;
  index: number;
  onPatch: (patch: Partial<GlossaryEntry>) => void;
  onRemove: () => void;
  removeLabel: string;
  srcLabel: string;
  dstLabel: string;
}) {
  return (
    <>
      <div>
        <input
          value={props.entry.src}
          aria-label={`${props.srcLabel} ${props.index + 1}`}
          onChange={(e) => props.onPatch({ src: e.target.value })}
        />
      </div>
      <div>
        <input
          value={props.entry.dst}
          aria-label={`${props.dstLabel} ${props.index + 1}`}
          onChange={(e) => props.onPatch({ dst: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          title={props.removeLabel}
          aria-label={`${props.removeLabel} ${props.index + 1}`}
          onClick={props.onRemove}
        >
          <TrashIcon />
        </button>
      </div>
    </>
  );
}
