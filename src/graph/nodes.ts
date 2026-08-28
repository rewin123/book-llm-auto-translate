import { validateTranslation } from '../ebook/validate.ts';
import type { Chunk } from '../ebook/types.ts';
import { glossaryForChunk, mergeGlossary, type GlossaryEntry } from '../glossary/index.ts';
import { parseTranslateOutput, type LlmClient } from '../llm/client.ts';
import { translateSystemPrompt, translateUserPrompt } from '../llm/prompts.ts';
import { outputTokenBudget } from '../llm/openai.ts';
import type { TranslatedPair } from '../job/types.ts';

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
}): Promise<{ xml: string; glossary: GlossaryEntry[]; usedOriginal: boolean; reason?: string }> {
  const retries = opts.retries ?? 2;
  let lastReason = 'unknown';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { text } = await opts.client.complete({
      model: opts.client.model,
      abortSignal: opts.abortSignal,
      // Sized from this chunk: a fixed cap truncated long chunks, which then
      // failed well-formedness and silently fell back to the original.
      maxTokens: outputTokenBudget(opts.chunk.xml.length),
      messages: [
        {
          role: 'system',
          content: translateSystemPrompt({
            sourceLang: opts.sourceLang,
            targetLang: opts.targetLang,
            styleGuide: opts.styleGuide,
          }),
        },
        {
          role: 'user',
          content: translateUserPrompt({
            xml: opts.chunk.xml,
            glossary: glossaryForChunk(opts.glossary, opts.chunk.xml),
            lastTwo: opts.lastTwo,
          }),
        },
      ],
    });
    const parsed = parseTranslateOutput(text);
    const check = validateTranslation(opts.chunk.xml, parsed.xml);
    if (check.ok) {
      return { xml: parsed.xml, glossary: parsed.glossary, usedOriginal: false };
    }
    lastReason = check.reason;
  }
  return {
    xml: opts.chunk.xml,
    glossary: [],
    usedOriginal: true,
    reason: lastReason,
  };
}

export function mergeAfterChunk(
  glossary: GlossaryEntry[],
  updates: GlossaryEntry[],
): GlossaryEntry[] {
  return mergeGlossary(glossary, updates);
}
