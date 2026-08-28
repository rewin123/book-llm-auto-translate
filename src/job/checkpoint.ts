import type { Checkpoint } from './types.ts';

const DB_NAME = 'booktrans-v1';
const STORE = 'jobs';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(cp, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  const value = await new Promise<Checkpoint | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Checkpoint) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

export async function clearCheckpoint(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
