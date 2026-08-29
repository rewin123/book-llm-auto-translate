import { describe, expect, it } from 'vitest';
import { mergeGlossary } from '../../src/glossary/index.ts';
import { translateUserPrompt } from '../../src/llm/prompts.ts';

describe('glossary', () => {
  it('keeps existing rows when the model rediscovers the same source name', () => {
    const merged = mergeGlossary(
      [{ src: 'Alice', dst: 'Алиса' }],
      [{ src: 'Alice', dst: 'Алисия' }, { src: 'Dinah', dst: 'Дина' }],
    );
    expect(merged).toEqual([
      { src: 'Alice', dst: 'Алиса' },
      { src: 'Dinah', dst: 'Дина' },
    ]);
  });

  it('gives an earlier big chunk priority when the same name is translated twice', () => {
    const seed = [{ src: 'Queen', dst: 'Королева' }];
    const early = [{ src: 'Alice', dst: 'Алиса' }, { src: 'Queen', dst: 'Ферзь' }];
    const late = [{ src: 'Alice', dst: 'Алисия' }, { src: 'Dinah', dst: 'Дина' }];
    const merged = mergeGlossary(mergeGlossary(seed, early), late);
    expect(merged).toEqual([
      { src: 'Queen', dst: 'Королева' },
      { src: 'Alice', dst: 'Алиса' },
      { src: 'Dinah', dst: 'Дина' },
    ]);
  });

  it('puts every glossary row in the translate prompt, including names absent from the chunk', () => {
    const user = translateUserPrompt({
      markdown: 'Alice sat down.',
      glossary: [
        { src: 'Alice', dst: 'Алиса' },
        { src: 'Cheshire Cat', dst: 'Чеширский кот' },
      ],
      lastTwo: [],
    });
    expect(user).toContain('complete list');
    expect(user).toContain('Alice — Алиса');
    expect(user).toContain('Cheshire Cat — Чеширский кот');
  });
});
