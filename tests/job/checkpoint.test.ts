import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_VERSION,
  loadCheckpoint,
  parseCheckpointRecord,
  saveCheckpoint,
} from '../../src/job/checkpoint.ts';
import type { Checkpoint } from '../../src/job/types.ts';

function checkpoint(): Checkpoint {
  return {
    fileName: 'alice.epub',
    fileBytes: new Uint8Array([1, 2, 3]),
    title: 'Alice',
    format: 'epub',
    settings: {
      sourceLang: 'en',
      targetLang: 'ru',
      chunkChars: 5000,
      logLimit: 40,
      providerId: 'mock',
      model: 'mock-reverse',
      concurrency: 1,
      glossaryBatch: 4,
      reviewBatch: 5,
    },
    chunks: [{ index: 0, documentPath: 'a.xhtml', chapterTitle: 'One', markdown: 'Hello' }],
    styleGuide: 'Plain voice.',
    glossary: [],
    translated: [{ index: 0, original: 'Hello', translation: 'Привет' }],
    index: 1,
    phase: 'paused',
  };
}

/** A record as `saveCheckpoint` stores it. */
function stored(overrides: Record<string, unknown> = {}): unknown {
  return { ...checkpoint(), version: CHECKPOINT_VERSION, ...overrides };
}

describe('parseCheckpointRecord', () => {
  it('accepts a record this build wrote', () => {
    const parsed = parseCheckpointRecord(stored());
    expect(parsed?.fileName).toBe('alice.epub');
    expect(parsed?.translated[0]?.translation).toBe('Привет');
  });

  it('carries an unknown extra field through', () => {
    expect(parseCheckpointRecord(stored({ somethingNew: 42 }))).not.toBeNull();
  });

  it('accepts a chunk carrying the seam flag', () => {
    expect(
      parseCheckpointRecord(
        stored({
          chunks: [
            { index: 0, documentPath: 'a.xhtml', chapterTitle: 'One', markdown: 'Hi', joinWith: 'space' },
          ],
        }),
      ),
    ).not.toBeNull();
  });

  /**
   * Records whose shape has moved on used to be blind-cast and then dereferenced
   * by `restore`, which threw out of a click handler and — with no error boundary
   * — blanked the app on every reload until site data was cleared by hand.
   */
  for (const [label, record] of [
    ['no version at all', (() => {
      const { version: _v, ...rest } = stored() as Record<string, unknown>;
      return rest;
    })()],
    ['a different version', stored({ version: CHECKPOINT_VERSION + 1 })],
    ['pairs with no translation', stored({ translated: [{ index: 0, original: 'Hello' }] })],
    ['a pre-markdown chunk shape', stored({
      chunks: [{ index: 0, documentPath: 'a.xhtml', chapterTitle: 'One', xml: '<p/>' }],
    })],
    ['no style guide', (() => {
      const { styleGuide: _s, ...rest } = stored() as Record<string, unknown>;
      return rest;
    })()],
    ['file bytes as a plain array', stored({ fileBytes: [1, 2, 3] })],
    ['an unexpected format', stored({ format: 'mobi' })],
    ['not an object', 'nonsense'],
    ['null', null],
  ] as [string, unknown][]) {
    it(`rejects ${label}`, () => {
      expect(parseCheckpointRecord(record)).toBeNull();
    });
  }
});

describe('without IndexedDB available', () => {
  it('does not throw on save or load', async () => {
    // happy-dom provides no IndexedDB, which is the same situation as a browser
    // with storage disabled: the run must continue, only without a checkpoint.
    await expect(saveCheckpoint(checkpoint())).resolves.toBeUndefined();
    await expect(loadCheckpoint()).resolves.toBeNull();
  });
});
