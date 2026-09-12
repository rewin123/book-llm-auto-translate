import { useState } from 'react';
import { parseGlossaryLines, type GlossaryEntry } from '../glossary/index.ts';
import { fmt, useT } from '../i18n/index.ts';
import { PlusIcon, TrashIcon } from './icons.tsx';

type Props = {
  entries: GlossaryEntry[];
  onChange?: (next: GlossaryEntry[]) => void;
  /** When set, every row is listed but cannot be edited (live translation). */
  readOnly?: boolean;
};

/**
 * The glossary is built by the model and must stay complete: every row is
 * listed here, and every translate call receives the same full list.
 */
export function GlossaryTable({ entries, onChange, readOnly = false }: Props) {
  const { t } = useT();
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');
  const canEdit = Boolean(onChange) && !readOnly;

  const update = (i: number, patch: Partial<GlossaryEntry>) => {
    onChange?.(entries.map((e, n) => (n === i ? { ...e, ...patch } : e)));
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
        {canEdit && (
          <div className="actions">
            <button className="btn btn-sm" type="button" onClick={() => setPasting((v) => !v)}>
              {t.glossaryPaste}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => onChange?.([...entries, { src: '', dst: '' }])}
            >
              <PlusIcon size={13} />
              {t.glossaryAdd}
            </button>
          </div>
        )}
      </div>

      {canEdit && pasting && (
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
                // Merge by source term, but only for rows that have one. Keying
                // every row collapsed the user's blank "Add" placeholders into a
                // single entry and overwrote matching rows without a word.
                const byTerm = new Map<string, number>();
                const next = [...entries];
                next.forEach((e, i) => {
                  if (e.src.trim()) byTerm.set(e.src, i);
                });
                for (const entry of parsed) {
                  const at = byTerm.get(entry.src);
                  if (at === undefined) {
                    byTerm.set(entry.src, next.length);
                    next.push(entry);
                  } else {
                    next[at] = entry;
                  }
                }
                onChange?.(next);
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
        <div className="glossary-scroll" style={{ marginTop: 'var(--space-4)' }}>
          <div className={`glossary${canEdit ? '' : ' is-readonly'}`}>
            <div className="head">{t.glossarySrc}</div>
            <div className="head">{t.glossaryDst}</div>
            {canEdit && <div className="head" aria-hidden="true" />}
            {entries.map((entry, i) => (
              <Row
                // Keyed by position only. Including the edited value meant the
                // key changed on every keystroke, so React remounted the input
                // and the caret jumped out of the field after one character.
                key={i}
                entry={entry}
                index={i}
                readOnly={!canEdit}
                onPatch={(patch) => update(i, patch)}
                onRemove={() => onChange?.(entries.filter((_, n) => n !== i))}
                removeLabel={t.glossaryRemove}
                srcLabel={t.glossarySrc}
                dstLabel={t.glossaryDst}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row(props: {
  entry: GlossaryEntry;
  index: number;
  readOnly: boolean;
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
          readOnly={props.readOnly}
          aria-label={`${props.srcLabel} ${props.index + 1}`}
          onChange={(e) => props.onPatch({ src: e.target.value })}
        />
      </div>
      <div>
        <input
          value={props.entry.dst}
          readOnly={props.readOnly}
          aria-label={`${props.dstLabel} ${props.index + 1}`}
          onChange={(e) => props.onPatch({ dst: e.target.value })}
        />
      </div>
      {!props.readOnly && (
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
      )}
    </>
  );
}
