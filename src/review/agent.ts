import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { GlossaryEntry } from '../glossary/index.ts';
import { isAbortError, withNetworkRetry, type RetryHandler } from '../llm/net.ts';
import { createSdkModel } from '../llm/openai.ts';
import { reviewAgentSystemPrompt, reviewAgentUserPrompt } from '../llm/prompts.ts';
import type { StoredProviders } from '../llm/presets.ts';

export type ReviewTools = {
  readTranslate: () => string;
  editTranslate: (oldStr: string, newStr: string) => string;
};

export async function runReviewAgent(opts: {
  stored: StoredProviders;
  abortSignal: AbortSignal;
  sourceLang: string;
  targetLang: string;
  styleGuide: string;
  glossary: GlossaryEntry[];
  original: string;
  translation: string;
  from: number;
  to: number;
  chunkCount: number;
  tools: ReviewTools;
  onRetry?: RetryHandler;
}): Promise<void> {
  if (opts.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');

  if (opts.stored.activeId === 'mock') {
    opts.tools.readTranslate();
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
            from: opts.from,
            to: opts.to,
            chunkCount: opts.chunkCount,
          }),
          prompt: reviewAgentUserPrompt({
            original: opts.original,
            translation: opts.translation,
          }),
          tools: {
            read_translate: tool({
              description:
                'Return the current translation of this window. Call after edits to see the result.',
              inputSchema: z.object({}),
              execute: async () => opts.tools.readTranslate(),
            }),
            edit_translate: tool({
              description:
                'Replace a unique substring in the current translation. old must occur exactly once. Returns ok or err.',
              inputSchema: z.object({
                old: z.string(),
                new: z.string(),
              }),
              execute: async ({ old: oldStr, new: newStr }: { old: string; new: string }) =>
                opts.tools.editTranslate(oldStr, newStr),
            }),
          },
          stopWhen: stepCountIs(16),
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
