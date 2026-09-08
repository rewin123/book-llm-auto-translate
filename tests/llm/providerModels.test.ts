import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseModelsResponse, fetchProviderModels } from '../../src/llm/providerModels.ts';

describe('parseModelsResponse', () => {
  it('reads OpenAI { data: [{ id }] } rows', () => {
    expect(
      parseModelsResponse({
        data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }],
      }),
    ).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('reads Ollama { models: [{ name }] } and string rows', () => {
    expect(
      parseModelsResponse({
        models: [{ name: 'llama3.1' }, 'mistral'],
      }),
    ).toEqual(['llama3.1', 'mistral']);
  });

  it('returns an empty list for junk', () => {
    expect(parseModelsResponse(null)).toEqual([]);
    expect(parseModelsResponse({ data: 'nope' })).toEqual([]);
  });
});

describe('fetchProviderModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not call mock or a keyed provider with no key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchProviderModels({ providerId: 'mock', baseURL: 'http://x/v1' })).toEqual([]);
    expect(
      await fetchProviderModels({ providerId: 'deepseek', baseURL: 'https://api.deepseek.com/v1' }),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GETs /models with the bearer key and returns ids', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'deepseek-v4.1-flash-expires-on-0910' }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchProviderModels({
        providerId: 'deepseek',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test',
      }),
    ).resolves.toEqual(['deepseek-v4.1-flash-expires-on-0910']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('returns [] when CORS or the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(
      fetchProviderModels({
        providerId: 'nvidia',
        baseURL: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-x',
      }),
    ).resolves.toEqual([]);
  });
});
