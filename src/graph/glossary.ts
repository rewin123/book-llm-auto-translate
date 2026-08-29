import { parseGlossaryJson, type GlossaryEntry } from '../glossary/index.ts';
import type { LlmClient } from '../llm/client.ts';
import { glossarySystemPrompt, glossaryUserPrompt } from '../llm/prompts.ts';
import { outputTokenBudget } from '../llm/openai.ts';
import type { LlmCallAttempt } from '../job/types.ts';

export async function extractGlossaryNode(opts: {
  client: LlmClient;
  markdown: string;
  sourceLang: string;
  targetLang: string;
  styleGuide: string;
  abortSignal: AbortSignal;
  retries?: number;
}): Promise<{ glossary: GlossaryEntry[]; llmCalls: LlmCallAttempt[] }> {
  const retries = opts.retries ?? 2;
  const llmCalls: LlmCallAttempt[] = [];
  let last: GlossaryEntry[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');
    const instructions = glossarySystemPrompt({
      sourceLang: opts.sourceLang,
      targetLang: opts.targetLang,
      styleGuide: opts.styleGuide,
    });
    const user = glossaryUserPrompt({
      markdown: opts.markdown,
      targetLang: opts.targetLang,
    });
    const { text } = await opts.client.complete({
      model: opts.client.model,
      abortSignal: opts.abortSignal,
      maxTokens: Math.min(2048, outputTokenBudget(Math.min(opts.markdown.length, 4000))),
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: user },
      ],
    });
    llmCalls.push({ instructions, user, response: text });
    const parsed = parseGlossaryJson(text);
    last = parsed;
    if (parsed.length > 0 || text.trim() === '{}' || text.trim() === '') {
      return { glossary: parsed, llmCalls };
    }
  }
  return { glossary: last, llmCalls };
}

export function lastTwoFor(
  index: number,
  translated: { index: number; original: string; translation: string }[],
): { index: number; original: string; translation: string }[] {
  const byIndex = new Map(translated.map((t) => [t.index, t]));
  const out = [];
  for (const i of [index - 2, index - 1]) {
    const pair = byIndex.get(i);
    if (pair) out.push(pair);
  }
  return out;
}
