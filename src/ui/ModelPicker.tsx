import { useEffect, useId, useState } from 'react';
import {
  PROVIDER_PRESETS,
  type ProviderId,
  type ProviderTier,
  type StoredProviders,
} from '../llm/presets.ts';
import { listModels, type CatalogModel } from '../llm/modelsDev.ts';
import { testConnection, type ConnectionResult } from '../llm/testConnection.ts';
import { fmt, useT, type Messages } from '../i18n/index.ts';
import { AlertIcon, CheckIcon, ChevronRight } from './icons.tsx';
import { ModelCombobox } from './ModelCombobox.tsx';

const TIER_ORDER: ProviderTier[] = ['demo', 'free', 'paid', 'local'];

const GROUP_LABEL: Record<ProviderTier, 'providerGroupDemo' | 'providerGroupFree' | 'providerGroupPaid' | 'providerGroupLocal'> = {
  demo: 'providerGroupDemo',
  free: 'providerGroupFree',
  paid: 'providerGroupPaid',
  local: 'providerGroupLocal',
};

type Props = {
  stored: StoredProviders;
  setStored: (fn: (s: StoredProviders) => StoredProviders) => void;
  connection: ConnectionResult | null;
  setConnection: (r: ConnectionResult | null) => void;
  disabled?: boolean;
};

export function ModelPicker({ stored, setStored, connection, setConnection, disabled }: Props) {
  const { t } = useT();
  const listId = useId();
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelsFor, setModelsFor] = useState<ProviderId | null>(null);
  const [testing, setTesting] = useState(false);

  const preset = PROVIDER_PRESETS.find((p) => p.id === stored.activeId) ?? PROVIDER_PRESETS[0]!;
  const model = stored.models[preset.id] ?? preset.defaultModel;
  const apiKey = stored.apiKeys[preset.id] ?? '';
  const visibleModels = modelsFor === preset.id ? models : [];
  const loadingModels = modelsFor !== preset.id;

  // Curated + models.dev first; `/models` joins in once a key (or custom URL) is set.
  useEffect(() => {
    let live = true;
    void listModels(preset.id, {
      baseURL: preset.id === 'custom' ? stored.customBaseURL : preset.baseURL,
      apiKey,
      headers: preset.headers,
    })
      .then((list) => {
        if (!live) return;
        setModels(list);
        setModelsFor(preset.id);
      })
      .catch(() => {
        if (!live) return;
        setModels([]);
        setModelsFor(preset.id);
      });
    return () => {
      live = false;
    };
  }, [preset.id, preset.baseURL, preset.headers, apiKey, stored.customBaseURL]);

  const priced = visibleModels.find((m) => m.id === model);

  const runTest = async () => {
    setTesting(true);
    setConnection(null);
    try {
      setConnection(await testConnection(stored));
    } catch {
      /* aborted */
    } finally {
      setTesting(false);
    }
  };

  const note = presetNote(preset.id, t);

  return (
    <div className="card">
      <div className="row">
        <div>
          <label htmlFor={`${listId}-provider`}>{t.provider}</label>
          <select
            id={`${listId}-provider`}
            value={stored.activeId}
            disabled={disabled}
            onChange={(e) => {
              setConnection(null);
              setStored((s) => ({ ...s, activeId: e.target.value as ProviderId }));
            }}
          >
            {TIER_ORDER.map((tier) => {
              const items = PROVIDER_PRESETS.filter((p) => p.tier === tier);
              if (items.length === 0) return null;
              return (
                <optgroup key={tier} label={t[GROUP_LABEL[tier]]}>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>

        <div>
          <label htmlFor={`${listId}-model`}>
            {t.model} <span style={{ opacity: 0.75 }}>— {t.modelHint}</span>
          </label>
          <ModelCombobox
            id={`${listId}-model`}
            value={model}
            models={visibleModels}
            loading={loadingModels}
            disabled={disabled}
            onChange={(next) => {
              setConnection(null);
              setStored((s) => ({ ...s, models: { ...s.models, [s.activeId]: next } }));
            }}
          />
          {priced?.inputPerMillion === 0 && priced.outputPerMillion === 0 ? (
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {t.costFree}
            </p>
          ) : priced?.inputPerMillion != null && priced.outputPerMillion != null ? (
            <p className="hint" style={{ margin: '6px 0 0' }}>
              {fmt(t.modelPer, { in: priced.inputPerMillion, out: priced.outputPerMillion })}
            </p>
          ) : null}
        </div>

        {preset.id === 'custom' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`${listId}-base`}>{t.baseURL}</label>
            <input
              id={`${listId}-base`}
              value={stored.customBaseURL}
              disabled={disabled}
              onChange={(e) => {
                setConnection(null);
                setStored((s) => ({ ...s, customBaseURL: e.target.value }));
              }}
            />
          </div>
        )}

        {preset.needsKey && (
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`${listId}-key`}>{t.apiKey}</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                id={`${listId}-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                disabled={disabled}
                onChange={(e) => {
                  setConnection(null);
                  setStored((s) => ({
                    ...s,
                    apiKeys: { ...s.apiKeys, [s.activeId]: e.target.value },
                  }));
                }}
              />
              <button
                className="btn"
                type="button"
                style={{ flexShrink: 0 }}
                disabled={disabled || testing || !apiKey}
                onClick={() => void runTest()}
              >
                {testing ? t.testing : t.testConnection}
              </button>
            </div>
          </div>
        )}

        {!preset.needsKey && preset.id !== 'mock' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn" type="button" disabled={disabled || testing} onClick={() => void runTest()}>
              {testing ? t.testing : t.testConnection}
            </button>
          </div>
        )}
      </div>

      {connection && <ConnectionNote result={connection} provider={preset.label} />}

      {preset.id === 'mock' ? (
        <p className="hint" style={{ margin: 'var(--space-3) 0 0' }}>
          {t.mockNote}
        </p>
      ) : (
        <>
          {note && (
            <p className="hint" style={{ margin: 'var(--space-3) 0 0' }}>
              {preset.docsURL && (
                <>
                  <a href={preset.docsURL} target="_blank" rel="noreferrer">
                    {t.getFreeKey}
                  </a>
                  {' · '}
                </>
              )}
              {note}
            </p>
          )}
          <details className="disclosure" style={{ marginTop: 'var(--space-3)', boxShadow: 'none' }}>
            <summary>
              <span className="chev">
                <ChevronRight />
              </span>
              <span>
                {fmt(t.keyStorage, { provider: preset.label })}{' '}
                <strong>{t.keyStorageMore}</strong>
              </span>
            </summary>
            <div className="body">
              <p className="hint" style={{ margin: 0 }}>
                {t.keyStorageDetail}
              </p>
              {stored.apiKeys[preset.id] && (
                <button
                  className="btn btn-sm"
                  type="button"
                  style={{ marginTop: 'var(--space-3)' }}
                  onClick={() => {
                    setConnection(null);
                    setStored((s) => ({ ...s, apiKeys: { ...s.apiKeys, [s.activeId]: '' } }));
                  }}
                >
                  {t.clearKey}
                </button>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function presetNote(id: ProviderId, t: Messages): string | null {
  if (id === 'nvidia') return t.nvidiaNote;
  if (id === 'groq') return t.groqNote;
  if (id === 'openrouter') return t.openrouterFreeHint;
  return null;
}

function ConnectionNote({ result, provider }: { result: ConnectionResult; provider: string }) {
  const { t } = useT();
  if (result.ok) {
    return (
      <div className="notice" style={{ marginTop: 'var(--space-3)' }} role="status">
        <span className="ok" style={{ display: 'flex' }}>
          <CheckIcon size={16} />
        </span>
        <span>
          <strong>{t.connOk}</strong>{' '}
          <span className="hint">{fmt(t.connOkDetail, { model: result.model, ms: result.ms })}</span>
        </span>
      </div>
    );
  }
  const copy = t.err[result.kind];
  return (
    <div className="notice" style={{ marginTop: 'var(--space-3)' }} role="alert">
      <span className="error" style={{ display: 'flex' }}>
        <AlertIcon size={16} />
      </span>
      <span>
        <strong>{fmt(copy.title, { provider })}</strong> <span className="hint">{copy.body}</span>
      </span>
    </div>
  );
}
