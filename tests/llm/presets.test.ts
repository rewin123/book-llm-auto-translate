import { describe, expect, it } from 'vitest';
import { CORS_OPENROUTER_FALLBACK, DEEPSEEK_DEFAULT_MODEL, PROVIDER_PRESETS } from '../../src/llm/presets.ts';
import { isZeroCost } from '../../src/llm/modelsDev.ts';

describe('free provider presets', () => {
  it('includes NVIDIA NIM and Groq as free OpenAI-compatible endpoints', () => {
    const nvidia = PROVIDER_PRESETS.find((p) => p.id === 'nvidia');
    const groq = PROVIDER_PRESETS.find((p) => p.id === 'groq');
    expect(nvidia?.baseURL).toBe('https://integrate.api.nvidia.com/v1');
    expect(nvidia?.defaultModel).toContain('nemotron');
    expect(nvidia?.tier).toBe('free');
    expect(groq?.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(groq?.cors).toBe('ok');
    expect(groq?.tier).toBe('free');
  });

  it('points a CORS-blocked NVIDIA run at OpenRouter’s free Nemotron', () => {
    expect(CORS_OPENROUTER_FALLBACK.nvidia).toBe('nvidia/nemotron-3-nano-30b-a3b:free');
  });

  it('treats NVIDIA, Groq, and OpenRouter :free models as $0', () => {
    expect(isZeroCost('nvidia', 'nvidia/nemotron-3-nano-30b-a3b')).toBe(true);
    expect(isZeroCost('groq', 'openai/gpt-oss-120b')).toBe(true);
    expect(isZeroCost('openrouter', 'nvidia/nemotron-3-nano-30b-a3b:free')).toBe(true);
    expect(isZeroCost('openrouter', 'deepseek/deepseek-v4-flash')).toBe(false);
    expect(isZeroCost('deepseek', 'deepseek-v4-flash')).toBe(false);
    expect(isZeroCost('deepseek', DEEPSEEK_DEFAULT_MODEL)).toBe(false);
  });

  it('defaults DeepSeek to the V4.1 Flash beta id', () => {
    const deepseek = PROVIDER_PRESETS.find((p) => p.id === 'deepseek');
    expect(deepseek?.defaultModel).toBe(DEEPSEEK_DEFAULT_MODEL);
  });
});
