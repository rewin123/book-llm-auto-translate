import { storageKeys } from '../storage/keys.ts';
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PREVIOUS_DEFAULT_MODEL,
  defaultStoredProviders,
  type StoredProviders,
} from '../llm/presets.ts';

export function loadProviders(): StoredProviders {
  try {
    const raw = localStorage.getItem(storageKeys.providers);
    if (!raw) return defaultStoredProviders();
    return migrateProviders(JSON.parse(raw) as Partial<StoredProviders>);
  } catch {
    return defaultStoredProviders();
  }
}

/** Deep-merge stored keys onto current defaults and bump the old DeepSeek Flash id. */
export function migrateProviders(stored: Partial<StoredProviders>): StoredProviders {
  const defaults = defaultStoredProviders();
  const models = { ...defaults.models, ...stored.models };
  if (!models.deepseek || models.deepseek === DEEPSEEK_PREVIOUS_DEFAULT_MODEL) {
    models.deepseek = DEEPSEEK_DEFAULT_MODEL;
  }
  return {
    ...defaults,
    ...stored,
    apiKeys: { ...defaults.apiKeys, ...stored.apiKeys },
    models,
    customBaseURL: stored.customBaseURL ?? defaults.customBaseURL,
  };
}

export function saveProviders(value: StoredProviders) {
  localStorage.setItem(storageKeys.providers, JSON.stringify(value));
}
