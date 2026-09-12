import { storageKeys } from '../storage/keys.ts';
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PREVIOUS_DEFAULT_MODEL,
  PROVIDER_PRESETS,
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
  // An id from another build, or a preset since renamed, used to be passed
  // through and then resolve to PROVIDER_PRESETS[0] — the mock provider, which
  // "translates" by reversing the text. That passed validation and produced a
  // downloadable book of gibberish, so an unknown id falls back to the default.
  const activeId =
    stored.activeId && PROVIDER_PRESETS.some((p) => p.id === stored.activeId)
      ? stored.activeId
      : defaults.activeId;
  return {
    ...defaults,
    ...stored,
    activeId,
    apiKeys: { ...defaults.apiKeys, ...stored.apiKeys },
    models,
    customBaseURL: stored.customBaseURL ?? defaults.customBaseURL,
  };
}

export function saveProviders(value: StoredProviders): boolean {
  // Called from an effect on every change. An unguarded throw in Safari Private
  // Browsing, with site data blocked, or on a full quota escaped into React and
  // unmounted the whole tree — a blank page in exactly the privacy mode where
  // this app's "nothing leaves your browser" promise matters most.
  try {
    localStorage.setItem(storageKeys.providers, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
