export type ProviderId =
  | 'mock'
  | 'nvidia'
  | 'groq'
  | 'openrouter'
  | 'deepseek'
  | 'openai'
  | 'xai'
  | 'custom';

/** DeepSeek V4.1 Flash beta (API id expires 2026-09-10). */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4.1-flash-expires-on-0910';
/** Previous preset default; loadProviders upgrades this stored id. */
export const DEEPSEEK_PREVIOUS_DEFAULT_MODEL = 'deepseek-v4-flash';

export type CorsStatus = 'ok' | 'often-blocked' | 'local';

export type ProviderTier = 'demo' | 'free' | 'paid' | 'local';

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  baseURL: string;
  defaultModel: string;
  cors: CorsStatus;
  corsNote: string;
  needsKey: boolean;
  tier: ProviderTier;
  /** Where to mint a key. Shown next to free providers. */
  docsURL?: string;
  headers?: Record<string, string>;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'mock',
    label: 'Mock (offline demo)',
    baseURL: '',
    defaultModel: 'mock-reverse',
    cors: 'ok',
    corsNote: 'No network. Reverses text nodes for tests and GitHub Pages demo.',
    needsKey: false,
    tier: 'demo',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM (free)',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/nemotron-3-nano-30b-a3b',
    cors: 'often-blocked',
    corsNote:
      'Free Developer Program key (nvapi-). Hosted NIM often omits CORS. From the browser, use OpenRouter model nvidia/nemotron-3-nano-30b-a3b:free.',
    needsKey: true,
    tier: 'free',
    docsURL: 'https://build.nvidia.com/settings/api-keys',
  },
  {
    id: 'groq',
    label: 'Groq (free tier)',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    cors: 'ok',
    corsNote: 'ACAO: * (measured 2026-08-28). Free developer key, rate-limited.',
    needsKey: true,
    tier: 'free',
    docsURL: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (paid + free)',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-nano-30b-a3b:free',
    cors: 'ok',
    corsNote: 'ACAO: * (measured 2026-07-30). Models ending in :free are $0.',
    needsKey: true,
    tier: 'free',
    docsURL: 'https://openrouter.ai/keys',
    headers: {
      'HTTP-Referer': 'https://github.com/booktrans/book-llm-auto-translate',
      'X-Title': 'Book LLM Auto-Translate',
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
    cors: 'ok',
    corsNote: 'Echoes Origin (measured 2026-07-30).',
    needsKey: true,
    tier: 'paid',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    cors: 'ok',
    corsNote: 'ACAO: * (measured 2026-07-30).',
    needsKey: true,
    tier: 'paid',
  },
  {
    id: 'xai',
    label: 'xAI / Grok',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    cors: 'often-blocked',
    corsNote: 'xAI often omits CORS. Prefer OpenRouter model x-ai/grok-* from the browser.',
    needsKey: true,
    tier: 'paid',
  },
  {
    id: 'custom',
    label: 'OpenAI-compatible (Ollama, LM Studio, …)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    cors: 'local',
    corsNote: 'Enable CORS on the local server (e.g. OLLAMA_ORIGINS=*).',
    needsKey: false,
    tier: 'local',
  },
];

/** Browser-reachable stand-in when a hosted API omits CORS. */
export const CORS_OPENROUTER_FALLBACK: Partial<Record<ProviderId, string>> = {
  nvidia: 'nvidia/nemotron-3-nano-30b-a3b:free',
  xai: 'x-ai/grok-4',
};

export type StoredProviders = {
  activeId: ProviderId;
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  customBaseURL: string;
};

export const defaultStoredProviders = (): StoredProviders => ({
  activeId: 'deepseek',
  apiKeys: {},
  models: {
    deepseek: DEEPSEEK_DEFAULT_MODEL,
    groq: 'openai/gpt-oss-120b',
    nvidia: 'nvidia/nemotron-3-nano-30b-a3b',
    openrouter: 'nvidia/nemotron-3-nano-30b-a3b:free',
  },
  customBaseURL: 'http://localhost:11434/v1',
});
