import { validateTranslation } from '../ebook/validate.ts';
import type { Chunk } from '../ebook/types.ts';
import { mergeGlossary, type GlossaryEntry } from '../glossary/index.ts';
import { parseTranslateOutput, type LlmClient } from '../llm/client.ts';
import { translateSystemPrompt, translateUserPrompt } from '../llm/prompts.ts';
import { outputTokenBudget } from '../llm/openai.ts';
import type { LlmCallAttempt, TranslatedPair } from '../job/types.ts';

export async function translateChunkNode(opts: {
  client: LlmClient;
  chunk: Chunk;
  sourceLang: string;
  targetLang: string;
  styleGuide: string;
  glossary: GlossaryEntry[];
  lastTwo: TranslatedPair[];
  abortSignal: AbortSignal;
  retries?: number;
}): Promise<{
  markdown: string;
  glossary: GlossaryEntry[];
  usedOriginal: boolean;
  reason?: string;
  llmCalls: LlmCallAttempt[];
}> {
  const retries = opts.retries ?? 2;
  let lastReason = 'unknown';
  const llmCalls: LlmCallAttempt[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');
    const instructions = translateSystemPrompt({
      sourceLang: opts.sourceLang,
      targetLang: opts.targetLang,
      styleGuide: opts.styleGuide,
    });
    const user = translateUserPrompt({
      markdown: opts.chunk.markdown,
      glossary: opts.glossary,
      lastTwo: opts.lastTwo,
    });
    const { text } = await opts.client.complete({
      model: opts.client.model,
      abortSignal: opts.abortSignal,
      // Sized from this chunk: a fixed cap truncated long chunks, which then
      // failed validation and silently fell back to the original.
      maxTokens: outputTokenBudget(opts.chunk.markdown.length),
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: user },
      ],
    });
    llmCalls.push({ instructions, user, response: text });
    const parsed = parseTranslateOutput(text);
    const check = validateTranslation(opts.chunk.markdown, parsed.markdown);
    if (check.ok) {
      return { markdown: parsed.markdown, glossary: [], usedOriginal: false, llmCalls };
    }
    lastReason = check.reason;
  }
  return {
    markdown: opts.chunk.markdown,
    glossary: [],
    usedOriginal: true,
    reason: lastReason,
    llmCalls,
  };
}

export function mergeAfterChunk(
  glossary: GlossaryEntry[],
  updates: GlossaryEntry[],
): GlossaryEntry[] {
  return mergeGlossary(glossary, updates);
}
