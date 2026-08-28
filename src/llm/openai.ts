import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mockClient, type ChatResponse, type LlmClient } from './client.ts';
import { attachRetryAfter, attachStatus, withNetworkRetry, type RetryHandler } from './net.ts';
import { PROVIDER_PRESETS, type ProviderId, type StoredProviders } from './presets.ts';

/** Enough headroom for a translation that legitimately grows past its source. */
const MIN_OUTPUT_TOKENS = 2048;
const MAX_OUTPUT_TOKENS = 32_768;

export function outputTokenBudget(sourceChars: number): number {
  const estimated = Math.ceil((sourceChars / 4) * 2.2) + 512;
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, estimated));
}

export function resolveProvider(stored: StoredProviders) {
  const preset = PROVIDER_PRESETS.find((p) => p.id === stored.activeId) ?? PROVIDER_PRESETS[0]!;
  const baseURL = (preset.id === 'custom' ? stored.customBaseURL : preset.baseURL).replace(/\/$/, '');
  return {
    preset,
    baseURL,
    model: stored.models[preset.id] || preset.defaultModel,
    apiKey: stored.apiKeys[preset.id] || '',
  };
}

export function createLlmClient(stored: StoredProviders, onRetry?: RetryHandler): LlmClient {
  const { preset, baseURL, model, apiKey } = resolveProvider(stored);
  if (preset.id === 'mock') return mockClient();

  return {
    id: preset.id,
    model,
    async complete(req): Promise<ChatResponse> {
      const instructions = req.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const rest = req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));
      const messages = [
        ...(instructions ? [{ role: 'system' as const, content: instructions }] : []),
        ...rest,
      ];
      const text = await chatCompletions({
        providerId: preset.id,
        baseURL,
        apiKey,
        model: req.model || model,
        messages,
        headers: preset.headers,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        abortSignal: req.abortSignal,
        onRetry,
      });
      return { text, toolCalls: [] };
    },
  };
}

export function createSdkModel(stored: StoredProviders) {
  const { preset, baseURL, model, apiKey } = resolveProvider(stored);
  const provider = createOpenAICompatible({
    name: preset.id,
    baseURL,
    apiKey: apiKey || 'no-key',
    headers: preset.headers,
  });
  return { model: provider.chatModel(model), modelId: model, preset };
}

/**
 * Provider-specific body fields.
 *
 * `thinking` is a DeepSeek extension — without it DeepSeek V4 spends the whole
 * call reasoning and returns no translation. Sending it to OpenAI, which
 * rejects unknown body params with a 400, breaks every request, so it is
 * scoped to the provider that needs it.
 */
function providerExtras(providerId: ProviderId): Record<string, unknown> {
  if (providerId === 'deepseek') return { thinking: { type: 'disabled' } };
  return {};
}

export async function chatCompletions(opts: {
  providerId: ProviderId;
  baseURL: string;
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onRetry?: RetryHandler;
  maxAttempts?: number;
}): Promise<string> {
  const url = `${opts.baseURL.replace(/\/$/, '')}/chat/completions`;
  return withNetworkRetry(
    async () => {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
      const signal = opts.abortSignal ? AbortSignal.any([opts.abortSignal, timeout]) : timeout;
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
          ...opts.headers,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          stream: false,
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
          ...providerExtras(opts.providerId),
          max_tokens: opts.maxTokens ?? MIN_OUTPUT_TOKENS * 4,
        }),
      });

      const raw = await res.text();
      let json: {
        error?: { message?: string };
        choices?: { message?: { content?: string | Array<{ type?: string; text?: string }> } }[];
      };
      try {
        json = JSON.parse(raw) as typeof json;
      } catch {
        throw attachRetryAfter(
          attachStatus(
            new Error(res.ok ? `Invalid JSON from ${url}` : `${res.status} ${raw.slice(0, 400)}`),
            res.status,
          ),
          res.headers.get('retry-after'),
        );
      }
      if (!res.ok) {
        throw attachRetryAfter(
          attachStatus(
            new Error(json.error?.message || `${res.status} ${raw.slice(0, 400)}`),
            res.status,
          ),
          res.headers.get('retry-after'),
        );
      }
      const content = json.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content;
      if (Array.isArray(content)) {
        const joined = content.map((p) => p.text ?? '').join('');
        if (joined.trim()) return joined;
      }
      throw new Error('Empty model response (no message.content)');
    },
    { signal: opts.abortSignal, onRetry: opts.onRetry, maxAttempts: opts.maxAttempts },
  );
}
