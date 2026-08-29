import { useCallback, useEffect, useState } from 'react';
import { JobRunner, type JobSnapshot } from '../job/runner.ts';

const EMPTY: JobSnapshot = {
  phase: 'idle',
  index: 0,
  total: 0,
  events: [],
  styleGuide: '',
  cost: null,
  packed: null,
  translated: [],
  chunks: [],
  glossary: [],
  title: '',
  failure: null,
  trialLimit: null,
  elapsedMs: 0,
  etaMs: null,
  keptOriginal: 0,
  glossaryIndex: 0,
  glossaryTotal: 0,
  liveIndex: 0,
  verifyIndex: 0,
  verifyPair: null,
};

/**
 * Owns the single JobRunner for the session.
 *
 * The runner is created once and never rebuilt. It used to be a `useMemo` keyed
 * on the log-size preference, so editing that field mid-run silently constructed
 * a fresh runner and dropped the book, style brief, glossary and every finished
 * translation while the stale snapshot kept the UI looking healthy.
 */
export function useJob(logLimit: number) {
  const [snap, setSnap] = useState<JobSnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);
  // Lazy initialiser: constructed once for the life of the component, and never
  // rebuilt by a dependency change.
  const [runner] = useState(() => new JobRunner((s) => setSnap(s), logLimit));

  useEffect(() => {
    runner.setLogLimit(logLimit);
  }, [runner, logLimit]);

  /** Serialises long runner calls and keeps a single "working" flag for the UI. */
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { runner, snap, busy, run, setSnap };
}
