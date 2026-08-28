import { classifyFailure, isAbortError, type FailureKind } from './net.ts';
import { chatCompletions, resolveProvider } from './openai.ts';
import type { StoredProviders } from './presets.ts';

export type ConnectionResult =
  | { ok: true; model: string; ms: number }
  | { ok: false; kind: FailureKind; detail: string; status: number | null };

/**
 * One cheap round-trip that proves the key, the model name and — for a browser,
 * the part nobody can check from the docs — that the provider allows the call
 * at all. Run before a book is committed rather than discovering it at chunk 1.
 */
export async function testConnection(
  stored: StoredProviders,
  signal?: AbortSignal,
): Promise<ConnectionResult> {
  const { preset, baseURL, model, apiKey } = resolveProvider(stored);
  const started = Date.now();

  if (preset.id === 'mock') {
    return { ok: true, model: preset.defaultModel, ms: 0 };
  }
  if (preset.needsKey && !apiKey) {
    return { ok: false, kind: 'auth', detail: 'missing-key', status: null };
  }

  try {
    await chatCompletions({
      providerId: preset.id,
      baseURL,
      apiKey,
      model,
      messages: [{ role: 'user', content: 'ping' }],
      headers: preset.headers,
      maxTokens: 1,
      timeoutMs: 20_000,
      maxAttempts: 1,
      abortSignal: signal,
    });
    return { ok: true, model, ms: Date.now() - started };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // A model that answers with an empty body still proves reachability: the
    // request was accepted, it just had no room to say anything at max_tokens 1.
    if (/Empty model response/i.test(message)) {
      return { ok: true, model, ms: Date.now() - started };
    }
    const verdict = classifyFailure(err);
    const kind =
      verdict.kind === 'request' && /model|not found|does not exist/i.test(message)
        ? 'request'
        : verdict.kind;
    return { ok: false, kind, detail: message.slice(0, 300), status: verdict.status };
  }
}
