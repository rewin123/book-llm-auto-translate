import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { GlossaryEntry } from '../glossary/index.ts';
import { isAbortError, withNetworkRetry, type RetryHandler } from '../llm/net.ts';
import { createSdkModel } from '../llm/openai.ts';
import { reviewAgentSystemPrompt, reviewAgentUserPrompt } from '../llm/prompts.ts';
import type { StoredProviders } from '../llm/presets.ts';

export type ReviewTools = {
  readOriginalChunk: (id: number) => string;
  readTranslatedChunk: (id: number) => string;
  editTranslatedChunk: (id: number, oldStr: string, newStr: string) => string;
};

/**
 * Two reads plus a couple of edit attempts per chunk, with headroom for the
 * neighbour reads the task asks for. Capped so a confused agent cannot spend
 * the budget of a whole chapter on one window.
 */
function stepBudget(chunkCount: number): number {
  return Math.min(60, 6 + chunkCount * 5);
}

export async function runReviewAgent(opts: {
  stored: StoredProviders;
  abortSignal: AbortSignal;
  sourceLang: string;
  targetLang: string;
  styleGuide: string;
  glossary: GlossaryEntry[];
  /** 0-based chunk ids this agent may edit, in reading order. */
  ids: number[];
  chunkCount: number;
  tools: ReviewTools;
  onRetry?: RetryHandler;
}): Promise<void> {
  if (opts.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (opts.ids.length === 0) return;

  if (opts.stored.activeId === 'mock') {
    opts.tools.readTranslatedChunk(opts.ids[0]!);
    return;
  }

  const { model } = createSdkModel(opts.stored);
  try {
    await withNetworkRetry(
      () =>
        generateText({
          model,
          abortSignal: opts.abortSignal,
          timeout: { stepMs: 180_000, toolMs: 180_000 },
          maxRetries: 1,
          instructions: reviewAgentSystemPrompt({
            sourceLang: opts.sourceLang,
            targetLang: opts.targetLang,
            styleGuide: opts.styleGuide,
            glossary: opts.glossary,
            chunkCount: opts.chunkCount,
          }),
          prompt: reviewAgentUserPrompt({ ids: opts.ids, chunkCount: opts.chunkCount }),
          tools: {
            read_original_chunk: tool({
              description: 'Return the source text of one chunk by its 0-based id.',
              inputSchema: z.object({ id: z.number().int() }),
              execute: async ({ id }: { id: number }) => opts.tools.readOriginalChunk(id),
            }),
            read_translated_chunk: tool({
              description:
                'Return the current translation of one chunk by its 0-based id. Call again after an edit to see the result.',
              inputSchema: z.object({ id: z.number().int() }),
              execute: async ({ id }: { id: number }) => opts.tools.readTranslatedChunk(id),
            }),
            edit_translated_chunk: tool({
              description:
                'Replace a unique substring inside the translation of one chunk. old must occur exactly once in that chunk. Returns ok or err.',
              inputSchema: z.object({
                id: z.number().int(),
                old: z.string(),
                new: z.string(),
              }),
              execute: async ({
                id,
                old: oldStr,
                new: newStr,
              }: {
                id: number;
                old: string;
                new: string;
              }) => opts.tools.editTranslatedChunk(id, oldStr, newStr),
            }),
          },
          stopWhen: stepCountIs(stepBudget(opts.ids.length)),
        }),
      { signal: opts.abortSignal, onRetry: opts.onRetry },
    );
  } catch (err) {
    if (isAbortError(err) && !opts.abortSignal.aborted) {
      throw new Error('The model took too long to answer.');
    }
    throw err;
  }
}
