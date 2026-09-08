import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PREVIOUS_DEFAULT_MODEL,
  defaultStoredProviders,
} from '../../src/llm/presets.ts';
import { migrateProviders } from '../../src/storage/providers.ts';

describe('migrateProviders', () => {
  it('upgrades the previous DeepSeek Flash default', () => {
    const next = migrateProviders({
      activeId: 'deepseek',
      models: { deepseek: DEEPSEEK_PREVIOUS_DEFAULT_MODEL, groq: 'openai/gpt-oss-20b' },
    });
    expect(next.models.deepseek).toBe(DEEPSEEK_DEFAULT_MODEL);
    expect(next.models.groq).toBe('openai/gpt-oss-20b');
  });

  it('fills a missing DeepSeek model from the current default', () => {
    const next = migrateProviders({ activeId: 'openai', models: { openai: 'gpt-4.1-mini' } });
    expect(next.models.deepseek).toBe(DEEPSEEK_DEFAULT_MODEL);
    expect(next.models.openai).toBe('gpt-4.1-mini');
    expect(next.activeId).toBe('openai');
  });

  it('leaves a custom DeepSeek id alone', () => {
    const next = migrateProviders({ models: { deepseek: 'deepseek-v4-pro' } });
    expect(next.models.deepseek).toBe('deepseek-v4-pro');
  });

  it('matches defaultStoredProviders for an empty store', () => {
    expect(migrateProviders({})).toEqual(defaultStoredProviders());
  });
});
