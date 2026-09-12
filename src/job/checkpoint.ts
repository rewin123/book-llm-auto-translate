import { z } from 'zod';
import type { Checkpoint } from './types.ts';

const DB_NAME = 'booktrans-v1';
const STORE = 'jobs';
const KEY = 'current';

/**
 * Shape version of a stored checkpoint.
 *
 * Bump this whenever `Checkpoint` changes in a way an older record cannot
 * satisfy. A record from a different version is discarded as stale rather than
 * trusted: `loadCheckpoint` used to blind-cast, and `restore` assumed every
 * stored pair had a string `translation` — so a record whose shape had moved on
 * threw out of a click handler and, with no error boundary, blanked the app on
 * every reload until site data was cleared by hand.
 */
export const CHECKPOINT_VERSION = 2;

const chunkSchema = z.object({
  index: z.number(),
  documentPath: z.string(),
  chapterTitle: z.string(),
  markdown: z.string(),
  joinWith: z.union([z.literal('space'), z.literal('line')]).optional(),
});

const pairSchema = z.object({
  index: z.number(),
  original: z.string(),
  translation: z.string(),
});

/**
 * Validates only the fields `restore` actually dereferences. Everything else is
 * carried through untouched, so adding an optional field does not need a bump.
 */
const checkpointSchema = z.object({
  version: z.literal(CHECKPOINT_VERSION),
  fileName: z.string(),
  fileBytes: z.instanceof(Uint8Array),
  title: z.string(),
  format: z.union([z.literal('epub'), z.literal('fb2')]),
  chunks: z.array(chunkSchema),
  styleGuide: z.string(),
  translated: z.array(pairSchema),
  index: z.number(),
});

type StoredCheckpoint = Checkpoint & { version: number };

/**
 * Accepts a stored record only if it carries this version and the fields
 * `JobRunner.restore` dereferences, returning `null` for anything else so a
 * record left by another build is discarded rather than trusted.
 */
export function parseCheckpointRecord(raw: unknown): Checkpoint | null {
  if (raw === null || raw === undefined) return null;
  if (!checkpointSchema.safeParse(raw).success) return null;
  // The parse confirms what `restore` relies on; the rest is used as stored.
  return raw as Checkpoint;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another tab holding the database open during an upgrade would otherwise
    // leave this promise pending for ever.
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

/**
 * Runs `fn` against the database and always closes the connection.
 *
 * Closing only on the success path leaked a connection on every failed write,
 * and enough of those would block a later version upgrade indefinitely.
 */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const record: StoredCheckpoint = { ...cp, version: CHECKPOINT_VERSION };
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Checkpoint write aborted'));
      }),
  );
}

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  if (typeof indexedDB === 'undefined') return null;
  const raw = await withDb(
    (db) =>
      new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
  return parseCheckpointRecord(raw);
}

export async function clearCheckpoint(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await withDb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Checkpoint delete aborted'));
      }),
  );
}
