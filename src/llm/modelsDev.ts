import { storageKeys } from '../storage/keys.ts';
import { PROVIDER_PRESETS, type ProviderId } from './presets.ts';

export type ModelCost = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  source: 'models.dev' | 'fallback' | 'unknown';
};

export type CatalogModel = {
  id: string;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
};

const FALLBACK: Record<string, { in: number; out: number }> = {
  'deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 },
};

/** Shown even if models.dev is slow or missing a slug. Free rows are $0. */
const CURATED: Partial<Record<ProviderId, CatalogModel[]>> = {
  nvidia: [
    { id: 'nvidia/nemotron-3-nano-30b-a3b', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/nemotron-3.5-lightning', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/nemotron-3-super-120b-a12b', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/nemotron-3-ultra-253b-v1', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', inputPerMillion: 0, outputPerMillion: 0 },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'openai/gpt-oss-20b', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'qwen/qwen3.6-27b', inputPerMillion: 0, outputPerMillion: 0 },
  ],
  openrouter: [
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/nemotron-3.5-lightning:free', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', inputPerMillion: 0, outputPerMillion: 0 },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', inputPerMillion: 0, outputPerMillion: 0 },
  ],
};

/** models.dev groups by provider slug; ours mostly match, except the aggregator. */
const CATALOG_KEY: Partial<Record<ProviderId, string>> = {
  deepseek: 'deepseek',
  openai: 'openai',
  openrouter: 'openrouter',
  xai: 'xai',
  nvidia: 'nvidia',
  groq: 'groq',
};

type ModelsDevFile = Record<
  string,
  {
    models?: Record<string, { cost?: { input?: number; output?: number } }>;
  }
>;

let cache: ModelsDevFile | null = null;

function readStoredCatalog(): ModelsDevFile | null {
  try {
    const raw = localStorage.getItem(storageKeys.modelsDev);
    if (!raw) return null;
    return JSON.parse(raw) as ModelsDevFile;
  } catch {
    return null;
  }
}

function writeStoredCatalog(catalog: ModelsDevFile) {
  try {
    localStorage.setItem(storageKeys.modelsDev, JSON.stringify(catalog));
  } catch {
    /* quota / private mode */
  }
}

export async function loadModelsDev(): Promise<ModelsDevFile | null> {
  if (cache) return cache;
  try {
    const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(String(res.status));
    cache = (await res.json()) as ModelsDevFile;
    writeStoredCatalog(cache);
    return cache;
  } catch {
    cache = readStoredCatalog();
    return cache;
  }
}

function isFreeModel(providerId: ProviderId, model: CatalogModel): boolean {
  if (model.id.endsWith(':free')) return true;
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  return preset?.tier === 'free' && providerId !== 'openrouter';
}

function mergeModels(providerId: ProviderId, catalog: CatalogModel[]): CatalogModel[] {
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const m of [...(CURATED[providerId] ?? []), ...catalog]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(isFreeModel(providerId, m) ? { ...m, inputPerMillion: 0, outputPerMillion: 0 } : m);
  }
  out.sort((a, b) => {
    const af = a.id.endsWith(':free') || a.inputPerMillion === 0 ? 0 : 1;
    const bf = b.id.endsWith(':free') || b.inputPerMillion === 0 ? 0 : 1;
    if (af !== bf) return af - bf;
    const ax = a.inputPerMillion ?? Number.POSITIVE_INFINITY;
    const bx = b.inputPerMillion ?? Number.POSITIVE_INFINITY;
    return ax === bx ? a.id.localeCompare(b.id) : ax - bx;
  });
  return out;
}

/**
 * Every model the catalog knows for a provider, cheapest-looking first.
 * Feeds the model combobox so a name never has to be typed from memory.
 */
export async function listModels(providerId: ProviderId): Promise<CatalogModel[]> {
  const key = CATALOG_KEY[providerId];
  const catalog = key ? await loadModelsDev() : null;
  const models = key ? catalog?.[key]?.models : undefined;
  const fromCatalog: CatalogModel[] = models
    ? Object.entries(models).map(([id, entry]) => ({
        id,
        inputPerMillion: entry.cost?.input ?? null,
        outputPerMillion: entry.cost?.output ?? null,
      }))
    : [];
  return mergeModels(providerId, fromCatalog);
}

export function isZeroCost(providerId: string, model: string): boolean {
  if (model.endsWith(':free')) return true;
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  return preset?.tier === 'free' && preset.id !== 'openrouter';
}

export async function lookupCost(providerId: string, model: string): Promise<ModelCost> {
  if (isZeroCost(providerId, model)) {
    return { inputPerMillion: 0, outputPerMillion: 0, source: 'fallback' };
  }
  const catalog = await loadModelsDev();
  if (catalog) {
    for (const prov of Object.values(catalog)) {
      const entry = prov.models?.[model];
      if (entry?.cost) {
        return {
          inputPerMillion: entry.cost.input ?? null,
          outputPerMillion: entry.cost.output ?? null,
          source: 'models.dev',
        };
      }
    }
  }
  const fb = FALLBACK[model];
  if (fb) {
    return { inputPerMillion: fb.in, outputPerMillion: fb.out, source: 'fallback' };
  }
  return { inputPerMillion: null, outputPerMillion: null, source: 'unknown' };
}
