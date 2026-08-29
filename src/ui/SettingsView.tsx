import { useState } from 'react';
import { PROVIDER_PRESETS, type StoredProviders } from '../llm/presets.ts';
import type { ConnectionResult } from '../llm/testConnection.ts';
import {
  clampBatch,
  clampConcurrency,
  DEFAULT_GLOSSARY_BATCH,
  DEFAULT_REVIEW_BATCH,
  MAX_BATCH,
  MAX_CONCURRENCY,
  type SetupPrefs,
} from '../storage/setup.ts';
import { fmt, languageName, useT } from '../i18n/index.ts';
import { ArrowRight, CheckIcon, ChevronRight, CrossIcon, InfoIcon, SwapIcon } from './icons.tsx';
import { ModelPicker } from './ModelPicker.tsx';

const LANGS = ['en', 'ru', 'de', 'fr', 'es', 'zh', 'ja', 'ko', 'it', 'pt'];

type Props = {
  bookLabel: string | null;
  parsing: boolean;
  setup: SetupPrefs;
  setSetup: (fn: (s: SetupPrefs) => SetupPrefs) => void;
  stored: StoredProviders;
  setStored: (fn: (s: StoredProviders) => StoredProviders) => void;
  connection: ConnectionResult | null;
  setConnection: (r: ConnectionResult | null) => void;
  translatedCount: number;
  onContinue: () => void;
  onBack: () => void;
};

export function SettingsView(props: Props) {
  const { t, locale } = useT();
  const { setup, setSetup, stored, translatedCount } = props;
  const [pendingChunk, setPendingChunk] = useState<number | null>(null);

  const preset = PROVIDER_PRESETS.find((p) => p.id === stored.activeId) ?? PROVIDER_PRESETS[0]!;
  const needsKey = preset.needsKey && !stored.apiKeys[preset.id];
  const untested = !props.connection?.ok;
  const canContinue = !!props.bookLabel && !needsKey && !props.parsing;

  const applyChunk = (value: number) => {
    if (translatedCount > 0) {
      setPendingChunk(value);
      return;
    }
    setSetup((s) => ({ ...s, chunkChars: value }));
  };

  return (
    <div className="stack">
      {props.bookLabel && <p className="hint" style={{ margin: 0 }}>{props.bookLabel}</p>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
          <div style={{ flexGrow: 1 }}>
            <label htmlFor="lang-from">{t.sourceLang}</label>
            <select
              id="lang-from"
              value={setup.sourceLang}
              onChange={(e) => setSetup((s) => ({ ...s, sourceLang: e.target.value }))}
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {languageName(l, locale)}
                </option>
              ))}
            </select>
          </div>
          <button
            className="icon-btn"
            type="button"
            title={t.swap}
            aria-label={t.swap}
            style={{ marginBottom: 1 }}
            onClick={() =>
              setSetup((s) => ({ ...s, sourceLang: s.targetLang, targetLang: s.sourceLang }))
            }
          >
            <SwapIcon />
          </button>
          <div style={{ flexGrow: 1 }}>
            <label htmlFor="lang-to">{t.targetLang}</label>
            <select
              id="lang-to"
              value={setup.targetLang}
              onChange={(e) => setSetup((s) => ({ ...s, targetLang: e.target.value }))}
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {languageName(l, locale)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <ModelPicker
        stored={stored}
        setStored={props.setStored}
        connection={props.connection}
        setConnection={props.setConnection}
      />

      <div className="card">
        <h2>{t.generationTitle}</h2>
        <p className="hint" style={{ margin: '4px 0 var(--space-4)' }}>
          {t.generationHint}
        </p>
        <div className="row-3">
          <div>
            <label htmlFor="parallel-n">{t.parallelN}</label>
            <input
              id="parallel-n"
              type="number"
              min={1}
              max={MAX_CONCURRENCY}
              step={1}
              value={setup.concurrency}
              onChange={(e) =>
                setSetup((s) => ({ ...s, concurrency: clampConcurrency(Number(e.target.value)) }))
              }
            />
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {t.parallelNHint}
            </p>
          </div>
          <div>
            <label htmlFor="chunk-size">{t.chunkSize}</label>
            <input
              id="chunk-size"
              type="number"
              min={800}
              max={20000}
              step={100}
              value={pendingChunk ?? setup.chunkChars}
              onChange={(e) => applyChunk(Number(e.target.value))}
            />
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {t.chunkSizeHint}
            </p>
          </div>
          <div>
            <label htmlFor="glossary-batch">{t.glossaryBatch}</label>
            <input
              id="glossary-batch"
              type="number"
              min={1}
              max={MAX_BATCH}
              step={1}
              value={setup.glossaryBatch}
              onChange={(e) =>
                setSetup((s) => ({
                  ...s,
                  glossaryBatch: clampBatch(Number(e.target.value), DEFAULT_GLOSSARY_BATCH),
                }))
              }
            />
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {t.glossaryBatchHint}
            </p>
          </div>
          <div>
            <label htmlFor="review-batch">{t.reviewBatch}</label>
            <input
              id="review-batch"
              type="number"
              min={1}
              max={MAX_BATCH}
              step={1}
              value={setup.reviewBatch}
              onChange={(e) =>
                setSetup((s) => ({
                  ...s,
                  reviewBatch: clampBatch(Number(e.target.value), DEFAULT_REVIEW_BATCH),
                }))
              }
            />
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {t.reviewBatchHint}
            </p>
          </div>
        </div>

        {pendingChunk !== null && (
          <div
            className="card banner banner-warn"
            role="alertdialog"
            aria-label={fmt(t.chunkWarnTitle, { n: translatedCount })}
            style={{ marginTop: 'var(--space-4)' }}
          >
            <div>
              <strong>{fmt(t.chunkWarnTitle, { n: translatedCount })}</strong>
              <p>{t.chunkWarnBody}</p>
              <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    setSetup((s) => ({ ...s, chunkChars: pendingChunk }));
                    setPendingChunk(null);
                  }}
                >
                  {t.chunkWarnConfirm}
                </button>
                <button className="btn" type="button" onClick={() => setPendingChunk(null)}>
                  {t.cancel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <details className="disclosure">
        <summary>
          <span className="chev">
            <ChevronRight />
          </span>
          <strong>{t.advanced}</strong>
          <span>{t.advancedHint}</span>
        </summary>
        <div className="body">
          <div>
            <label htmlFor="log-limit">{t.logLimit}</label>
            <input
              id="log-limit"
              type="number"
              min={5}
              max={200}
              value={setup.logLimit}
              onChange={(e) => setSetup((s) => ({ ...s, logLimit: Number(e.target.value) }))}
            />
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {t.logLimitHint}
            </p>
          </div>
        </div>
      </details>

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
          <ul className="checklist">
            <Item ok={!!props.bookLabel}>{props.bookLabel ? t.readyBookShort : t.notReadyBook}</Item>
            <Item ok>
              {fmt(t.readyLangs, {
                from: languageName(setup.sourceLang, locale),
                to: languageName(setup.targetLang, locale),
              })}
            </Item>
            <Item ok={needsKey ? false : untested ? 'warn' : true}>
              {needsKey ? (
                <>
                  <strong>{fmt(t.notReadyKey, { provider: preset.label })}</strong>{' '}
                  {t.notReadyKeyAction}
                </>
              ) : untested ? (
                t.notReadyModel
              ) : (
                fmt(t.readyModel, { provider: preset.label })
              )}
            </Item>
          </ul>

          <div className="actions">
            <button className="btn" type="button" onClick={props.onBack}>
              {t.back}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!canContinue}
              onClick={props.onContinue}
              style={{ padding: '12px 20px' }}
            >
              {t.continueToBrief}
              <ArrowRight />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Item({ ok, children }: { ok: boolean | 'warn'; children: React.ReactNode }) {
  return (
    <li data-ok={String(ok)}>
      <span className="mark">
        {ok === true ? <CheckIcon /> : ok === 'warn' ? <InfoIcon /> : <CrossIcon />}
      </span>
      <span>{children}</span>
    </li>
  );
}
