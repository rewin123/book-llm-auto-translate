import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PREVIOUS_DEFAULT_MODEL,
} from '../../src/llm/presets.ts';
import { filterModels, mergeModelLists } from '../../src/llm/modelsDev.ts';

describe('mergeModelLists', () => {
  it('puts live /models ids first and fills Flash fallback prices', () => {
    const merged = mergeModelLists(
      'deepseek',
      [{ id: 'deepseek-v4-pro', inputPerMillion: 1, outputPerMillion: 2 }],
      [DEEPSEEK_DEFAULT_MODEL, 'deepseek-v4-pro'],
    );
    expect(merged.map((m) => m.id)).toEqual([
      DEEPSEEK_DEFAULT_MODEL,
      'deepseek-v4-pro',
      DEEPSEEK_PREVIOUS_DEFAULT_MODEL,
    ]);
    expect(merged[0]).toMatchObject({
      id: DEEPSEEK_DEFAULT_MODEL,
      inputPerMillion: 0.14,
      outputPerMillion: 0.28,
    });
    expect(merged[1]).toMatchObject({ inputPerMillion: 1, outputPerMillion: 2 });
  });

  it('keeps curated DeepSeek Flash ids when the live list is empty', () => {
    const ids = mergeModelLists('deepseek', []).map((m) => m.id);
    expect(ids).toContain(DEEPSEEK_DEFAULT_MODEL);
    expect(ids).toContain(DEEPSEEK_PREVIOUS_DEFAULT_MODEL);
    expect(ids).toContain('deepseek-v4-pro');
  });
});

describe('filterModels', () => {
  const models = [
    { id: 'deepseek-v4-flash', inputPerMillion: 0.14, outputPerMillion: 0.28 },
    { id: 'deepseek-v4-pro', inputPerMillion: null, outputPerMillion: null },
  ];

  it('is a case-insensitive substring filter', () => {
    expect(filterModels(models, 'FLASH').map((m) => m.id)).toEqual(['deepseek-v4-flash']);
  });

  it('returns the full list for a blank query', () => {
    expect(filterModels(models, '  ')).toEqual(models);
  });
});
