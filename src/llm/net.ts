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

/**
 * The HTTP status, read from the error object only.
 *
 * This used to fall back to scraping any of those numbers out of the message
 * text, which misread ordinary prose: "maximum context length is 16385 tokens,
 * however you requested 16400 tokens (400 in the messages…)" became a 400, and a
 * token count containing 503 made a permanent failure look retriable for eleven
 * attempts.
 */
/**
 * Our own step/tool timeout firing, not a dropped connection.
 *
 * The AI SDK aborts with `new DOMException('… timeout of Nms exceeded',
 * 'TimeoutError')`. It matters which one this is: replaying an agent run means
 * resending the whole style guide, glossary and window, and re-applying edits
 * against text a previous attempt already changed, so it gets a small budget
 * rather than the full reconnect budget a network blip deserves.
 */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'TimeoutError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout of \d+\s*ms exceeded/i.test(msg);
}

export function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const rec = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown } | null;
  };
  if (typeof rec.status === 'number') return rec.status;
  if (typeof rec.statusCode === 'number') return rec.statusCode;
  // Some SDK errors carry the Response rather than a flat status.
  const nested = rec.response?.status;
  return typeof nested === 'number' ? nested : null;
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
const CUT_OFF_RE = /empty model response|invalid json/i;

/**
 * Reconnects after a drop, not counting the first try. A browser CORS rejection
 * looks like `Failed to fetch` too, so this is a ceiling rather than infinity:
 * a real outage usually comes back within these retries; a blocked origin will
 * fail out after the same budget.
 */
export const CONNECTION_RETRIES = 10;

/**
 * Attempts allowed after our own step timeout. One retry covers a genuine hang;
 * more would mean minutes of replayed agent runs, each billed in full.
 */
const TIMEOUT_ATTEMPTS = 2;

function connectionAttempts(): number {
  return 1 + CONNECTION_RETRIES;
}

/**
 * Classifies a failure and says how hard to try again.
 *
 * Only a genuinely offline browser retries without a cap, because there the
 * connection really is expected to come back. Timeouts, `Failed to fetch`,
 * resets and empty/cut-off bodies share the same reconnect budget.
 */
export function classifyFailure(err: unknown): {
  kind: FailureKind;
  status: number | null;
  retryable: boolean;
  maxAttempts: number;
} {
  const status = errorStatus(err);
  const msg = messageOf(err);
  const reconnect = connectionAttempts();

  if (status === 401 || status === 403) {
    return { kind: 'auth', status, retryable: false, maxAttempts: 1 };
  }
  // Checked before the status branches: a context overflow is permanent however
  // the provider labels it, and retrying it eleven times only wastes the budget
  // while hiding the one message that tells the user to reduce the chunk size.
  if (CONTEXT_RE.test(msg)) {
    return { kind: 'context', status, retryable: false, maxAttempts: 1 };
  }
  if (status === 429) {
    // A provider asking for longer than our whole budget is telling us to come
    // back later, not to keep knocking: surface it instead of grinding.
    const requested = requestedRetryAfterMs(err);
    if (requested !== null && requested > LADDER_BUDGET_MS) {
      return { kind: 'rate', status, retryable: false, maxAttempts: 1 };
    }
    return { kind: 'rate', status, retryable: true, maxAttempts: reconnect };
  }
  if (status !== null && status >= 500) {
    return { kind: 'server', status, retryable: true, maxAttempts: reconnect };
  }
  if (status !== null && status >= 400) {
    return { kind: 'request', status, retryable: false, maxAttempts: 1 };
  }
  if (isOffline()) {
    return { kind: 'network', status: null, retryable: true, maxAttempts: Number.POSITIVE_INFINITY };
  }
  if (isTimeoutError(err)) {
    return { kind: 'network', status: null, retryable: true, maxAttempts: TIMEOUT_ATTEMPTS };
  }
  if (isAbortError(err)) {
    // Request timeout (not the user hitting Pause). Treat as a dropped call.
    return { kind: 'network', status: null, retryable: true, maxAttempts: reconnect };
  }
  if (CUT_OFF_RE.test(msg) || NETWORK_RE.test(msg)) {
    return { kind: 'network', status: null, retryable: true, maxAttempts: reconnect };
  }
  if (err instanceof TypeError || FETCH_RE.test(msg)) {
    // Online, yet the request never reached anyone: a dropped socket or CORS.
    // Both get the same reconnect budget; after that the UI can still offer
    // the CORS fallback because the kind stays `cors`.
    return { kind: 'cors', status: null, retryable: true, maxAttempts: reconnect };
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

/**
 * Waits `ms`, or until the connection returns when `wakeOnline` is set.
 *
 * Subscribing to `online` unconditionally cut every backoff short, rate limits
 * included: a Wi-Fi flap during a 30-second cooldown after a 429 resent the
 * request milliseconds later, earned another 429, and each further flap shortened
 * the next wait the same way — spending the whole attempt budget without ever
 * honouring the limit. Only a wait that exists *because* we are offline should
 * end early.
 */
export function sleepOrOnline(ms: number, signal?: AbortSignal, wakeOnline = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErr());
      return;
    }
    const listening = wakeOnline && typeof window !== 'undefined';
    const finish = () => {
      clearTimeout(t);
      if (listening) window.removeEventListener('online', onOnline);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onOnline = () => finish();
    const onAbort = () => {
      clearTimeout(t);
      if (listening) window.removeEventListener('online', onOnline);
      reject(abortErr());
    };
    const t = setTimeout(finish, ms);
    if (listening) window.addEventListener('online', onOnline);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 15_000, 20_000, 30_000, 30_000, 30_000, 30_000];

/** Total wall time the default ladder spans — the real retry budget. */
const LADDER_BUDGET_MS = DEFAULT_DELAYS.reduce((a, b) => a + b, 0);

/** Upper bound on honouring a `Retry-After`; beyond this the wait is capped. */
const MAX_RETRY_AFTER_MS = 120_000;

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
    // This one really is an offline wait, so it may end as soon as we are back.
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
      const retryAfterMs = errorRetryAfterMs(err);
      // A provider-supplied delay replaces the ladder, so the fixed attempt
      // budget no longer matches the time it covers. A `Retry-After: 2` on a
      // per-minute limit used to burn all eleven attempts in ~22s — well inside
      // the window that had to pass — and the job died on a limit the default
      // ladder would have waited out. Budget by elapsed time instead.
      const max =
        opts.maxAttempts ??
        (retryAfterMs !== null && Number.isFinite(verdict.maxAttempts)
          ? Math.max(verdict.maxAttempts, Math.ceil(LADDER_BUDGET_MS / retryAfterMs) + 1)
          : verdict.maxAttempts);
      if (!isRetryableError(err, opts.signal) || attempt + 1 >= max) throw err;
      attempt += 1;
      const delayMs = retryAfterMs ?? delays[Math.min(attempt - 1, delays.length - 1)]!;
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
    const target = err as Error & { retryAfterMs: number; retryAfterRequestedMs: number };
    target.retryAfterMs = Math.min(ms, MAX_RETRY_AFTER_MS);
    // What the provider actually asked for. Clamping alone was silent, so a
    // daily quota saying "come back in an hour" was retried eleven times over
    // 22 minutes against something that would not reset.
    target.retryAfterRequestedMs = ms;
  }
  return err;
}

function requestedRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const ms = (err as { retryAfterRequestedMs?: unknown }).retryAfterRequestedMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null;
}
