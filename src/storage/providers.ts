import { storageKeys } from '../storage/keys.ts';
import { defaultStoredProviders, type StoredProviders } from '../llm/presets.ts';

export function loadProviders(): StoredProviders {
  try {
    const raw = localStorage.getItem(storageKeys.providers);
    if (!raw) return defaultStoredProviders();
    return { ...defaultStoredProviders(), ...JSON.parse(raw) };
  } catch {
    return defaultStoredProviders();
  }
}

export function saveProviders(value: StoredProviders) {
  localStorage.setItem(storageKeys.providers, JSON.stringify(value));
}
