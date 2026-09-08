import { PROVIDER_PRESETS, type ProviderId } from './presets.ts';

function rowId(row: unknown): string | null {
  if (typeof row === 'string' && row.trim()) return row.trim();
  if (!row || typeof row !== 'object') return null;
  const rec = row as { id?: unknown; name?: unknown };
  if (typeof rec.id === 'string' && rec.id.trim()) return rec.id.trim();
  if (typeof rec.name === 'string' && rec.name.trim()) return rec.name.trim();
  return null;
}

/** OpenAI `{ data: [{ id }] }`, plus Ollama `{ models: [{ name }] }` and string rows. */
export function parseModelsResponse(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const rec = json as { data?: unknown; models?: unknown };
  const rows = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.models) ? rec.models : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = rowId(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function fetchProviderModels(opts: {
  providerId: ProviderId;
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (opts.providerId === 'mock') return [];
  const base = opts.baseURL.replace(/\/$/, '');
  if (!base) return [];
  const preset = PROVIDER_PRESETS.find((p) => p.id === opts.providerId);
  if (preset?.needsKey && !opts.apiKey) return [];

  try {
    const timeout = AbortSignal.timeout(4000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await fetch(`${base}/models`, {
      method: 'GET',
      signal,
      headers: {
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        ...opts.headers,
      },
    });
    if (!res.ok) return [];
    return parseModelsResponse(await res.json());
  } catch {
    // CORS-blocked hosts (NVIDIA, xAI) and down local servers look the same here.
    return [];
  }
}
