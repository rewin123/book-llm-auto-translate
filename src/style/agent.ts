import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { Chunk } from '../ebook/types.ts';
import type { LlmClient } from '../llm/client.ts';
import { withNetworkRetry, type RetryHandler } from '../llm/net.ts';
import { createSdkModel } from '../llm/openai.ts';
import { formatChapterList } from '../ebook/chapters.ts';
import { styleAgentSystemPrompt, styleAgentUserPrompt } from '../llm/prompts.ts';
import type { StoredProviders } from '../llm/presets.ts';
import type { JobEvent } from '../job/types.ts';

const DEFAULT_GUIDE = `## Work
Literary prose. Match the source genre and period.

## Narrative
Keep the source tense and narrative distance. Preserve intentional repetition.

## Register
Match narrator vs dialogue. Preserve T–V (ты/вы, tu/vous) once chosen.

## Dialogue
Use target-language quotation conventions. Do not flatten character voices.

## Names
Transliterate personal names consistently; do not translate them unless they are transparent titles.

## Idioms
Prefer a natural target equivalent over a calque, unless wordplay is load-bearing.

## Typography
Never break markdown, link targets, or image paths.

## Do / Don't
- Do keep *emphasis*.
- Don't drop images or links.
`;

export async function runStyleAgent(opts: {
  client: LlmClient;
  stored: StoredProviders;
  chunks: Chunk[];
  sourceLang: string;
  targetLang: string;
  abortSignal: AbortSignal;
  onEvent: (e: JobEvent) => void;
  onRetry?: RetryHandler;
}): Promise<string> {
  const total = opts.chunks.length;
  const read = (idx: number) => {
    if (idx < 0 || idx >= total) return `error: idx ${idx} out of range 0..${total - 1}`;
    opts.onEvent({
      ts: Date.now(),
      kind: 'style',
      key: 'readChunk',
      params: { idx },
    });
    return opts.chunks[idx]!.markdown;
  };

  if (opts.client.id === 'mock') {
    read(0);
    if (total > 1) read(Math.max(0, total - 1));
    return DEFAULT_GUIDE;
  }

  const { model } = createSdkModel(opts.stored);
  const result = await withNetworkRetry(
    () =>
      generateText({
        model,
        abortSignal: opts.abortSignal,
        instructions: styleAgentSystemPrompt({
          sourceLang: opts.sourceLang,
          targetLang: opts.targetLang,
          totalChunks: total,
        }),
        prompt: styleAgentUserPrompt({
          totalChunks: total,
          chapterList: formatChapterList(opts.chunks),
        }),
        tools: {
          read_chunk: tool({
            description: 'Read source markdown for chunk idx (0-based). Not a translation.',
            inputSchema: z.object({ idx: z.number().int() }),
            execute: async ({ idx }: { idx: number }) => read(idx),
          }),
        },
        stopWhen: stepCountIs(12),
      }),
    { signal: opts.abortSignal, onRetry: opts.onRetry },
  );
  return result.text.trim() || DEFAULT_GUIDE;
}
