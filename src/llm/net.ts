/** What went wrong, in a form the UI can turn into an actionable message. */
export type FailureKind =
  | 'auth'
  | 'cors'
  | 'rate'
  | 'context'
  | 'request'
  | 'server'
  | 'network'
  | 'unknown';

export type RetryHandler = (info: {
  attempt: number;
  delayMs: number;
  waitingForOnline: boolean;
  error: unknown;
  kind: FailureKind;
}) => void;

export function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && err.name === 'AbortError';
}

export function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const rec = err as { status?: unknown; statusCode?: unknown };
  if (typeof rec.status === 'number') return rec.status;
  if (typeof rec.statusCode === 'number') return rec.statusCode;
  const msg = err instanceof Error ? err.message : String(err);
  const m = /\b(400|429|500|502|503|504|401|403|404)\b/.exec(msg);
  return m ? Number(m[1]) : null;
}

export function errorRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const ms = (err as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const CONTEXT_RE =
  /context length|context_length|maximum context|too many tokens|reduce the length|input is too long|prompt is too long/i;
const NETWORK_RE =
  /network request failed|err_connection|econnreset|etimedout|enotfound|socket|fetch failed|connection (?:reset|closed|refused|aborted)|net::/i;
const FETCH_RE = /failed to fetch|networkerror|load failed/i;

/**
 * Classifies a failure and says how hard to try again.
 *
 * The important cases: a browser CORS rejection looks exactly like a network
 * blip (`TypeError: Failed to fetch`) but retrying it forever is pointless, so
 * it gets a low ceiling. Only a genuinely offline browser retries without a cap,
 * because there the connection really is expected to come back.
 */
export function classifyFailure(err: unknown): {
  kind: FailureKind;
  status: number | null;
  retryable: boolean;
  maxAttempts: number;
} {
  const status = errorStatus(err);
  const msg = messageOf(err);

  if (status === 401 || status === 403) {
    return { kind: 'auth', status, retryable: false, maxAttempts: 1 };
  }
  if (status === 429) {
    return { kind: 'rate', status, retryable: true, maxAttempts: 8 };
  }
  if (status !== null && status >= 500) {
    return { kind: 'server', status, retryable: true, maxAttempts: 8 };
  }
  if (CONTEXT_RE.test(msg)) {
    return { kind: 'context', status, retryable: false, maxAttempts: 1 };
  }
  if (status !== null && status >= 400) {
    return { kind: 'request', status, retryable: false, maxAttempts: 1 };
  }
  if (isOffline()) {
    return { kind: 'network', status: null, retryable: true, maxAttempts: Number.POSITIVE_INFINITY };
  }
  if (err instanceof TypeError || FETCH_RE.test(msg)) {
    // Online, yet the request never reached anyone: almost always CORS or a
    // wrong base URL. Try a couple of times in case it was a blip, then stop.
    return { kind: 'cors', status: null, retryable: true, maxAttempts: 3 };
  }
  if (NETWORK_RE.test(msg)) {
    return { kind: 'network', status: null, retryable: true, maxAttempts: 8 };
  }
  return { kind: 'unknown', status, retryable: false, maxAttempts: 1 };
}

export function isRetryableError(err: unknown, userSignal?: AbortSignal): boolean {
  if (userSignal?.aborted) return false;
  if (isAbortError(err)) return !userSignal?.aborted;
  return classifyFailure(err).retryable;
}

function abortErr(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export function waitUntilOnline(signal?: AbortSignal, onWait?: () => void): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  onWait?.();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErr());
      return;
    }
    const done = () => {
      window.removeEventListener('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onOnline = () => done();
    const onAbort = () => {
      window.removeEventListener('online', onOnline);
      reject(abortErr());
    };
    window.addEventListener('online', onOnline);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function sleepOrOnline(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErr());
      return;
    }
    const finish = () => {
      clearTimeout(t);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onOnline = () => finish();
    const onAbort = () => {
      clearTimeout(t);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      reject(abortErr());
    };
    const t = setTimeout(finish, ms);
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 15_000];

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  opts: {
    signal?: AbortSignal;
    onRetry?: RetryHandler;
    /** Overrides the per-failure ceiling. */
    maxAttempts?: number;
    delays?: number[];
  } = {},
): Promise<T> {
  const delays = opts.delays ?? DEFAULT_DELAYS;
  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) throw abortErr();
    await waitUntilOnline(opts.signal, () => {
      opts.onRetry?.({
        attempt,
        delayMs: 0,
        waitingForOnline: true,
        error: new Error('offline'),
        kind: 'network',
      });
    });
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) && opts.signal?.aborted) throw err;
      const verdict = classifyFailure(err);
      const max = opts.maxAttempts ?? verdict.maxAttempts;
      if (!isRetryableError(err, opts.signal) || attempt + 1 >= max) throw err;
      attempt += 1;
      const delayMs = errorRetryAfterMs(err) ?? delays[Math.min(attempt - 1, delays.length - 1)]!;
      opts.onRetry?.({ attempt, delayMs, waitingForOnline: false, error: err, kind: verdict.kind });
      await sleepOrOnline(delayMs, opts.signal);
    }
  }
}

export function attachStatus(err: Error, status: number): Error {
  (err as Error & { status: number }).status = status;
  return err;
}

/** Honours a provider's `Retry-After` instead of guessing a backoff. */
export function attachRetryAfter(err: Error, header: string | null): Error {
  if (!header) return err;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  if (Number.isFinite(ms) && ms > 0) {
    (err as Error & { retryAfterMs: number }).retryAfterMs = Math.min(ms, 120_000);
  }
  return err;
}
