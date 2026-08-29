import { stepCountIs, streamText, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import type { GlossaryEntry } from '../glossary/index.ts';
import { isAbortError } from '../llm/net.ts';
import { createSdkModel } from '../llm/openai.ts';
import { improveAgentSystemPrompt } from '../llm/prompts.ts';
import type { StoredProviders } from '../llm/presets.ts';

export type ImproveTools = {
  editStyleGuideline: (oldStr: string, newStr: string) => string;
  addOrReplaceGlossary: (src: string, dst: string) => string;
  doTranslate: () => Promise<{ original: string; translate: string }>;
};

export type ImproveStreamEvent =
  | { type: 'tool'; name: string; id: string }
  | { type: 'text'; delta: string };

export type ImproveTurnResult = {
  text: string;
  messages: ModelMessage[];
  toolNames: string[];
};

const MOCK_REPLY =
  'Demo provider only reverses text, so I cannot judge literary quality. Name a glossary pair as Source -> Target and I will record it and retranslate, or continue when you are ready.';

export async function runImproveTurn(opts: {
  stored: StoredProviders;
  abortSignal: AbortSignal;
  sourceLang: string;
  targetLang: string;
  chunkIndex: number;
  chunkCount: number;
  styleGuide: string;
  glossary: GlossaryEntry[];
  original: string;
  translation: string;
  messages: ModelMessage[];
  userText: string;
  tools: ImproveTools;
  onEvent?: (event: ImproveStreamEvent) => void;
}): Promise<ImproveTurnResult> {
  const userMessage: ModelMessage = { role: 'user', content: opts.userText };
  const nextMessages = [...opts.messages, userMessage];

  if (opts.stored.activeId === 'mock') {
    return mockImproveTurn(opts, nextMessages, userMessage);
  }

  const { model } = createSdkModel(opts.stored);
  const seenTools = new Set<string>();
  const toolNames: string[] = [];
  const announce = (name: string, id: string) => {
    if (seenTools.has(id)) return;
    seenTools.add(id);
    toolNames.push(name);
    opts.onEvent?.({ type: 'tool', name, id });
  };

  try {
    const result = streamText({
      model,
      abortSignal: opts.abortSignal,
      timeout: { stepMs: 180_000, toolMs: 180_000 },
      maxRetries: 1,
      instructions: improveAgentSystemPrompt({
        sourceLang: opts.sourceLang,
        targetLang: opts.targetLang,
        chunkIndex: opts.chunkIndex,
        chunkCount: opts.chunkCount,
        styleGuide: opts.styleGuide,
        glossary: opts.glossary,
        original: opts.original,
        translation: opts.translation,
      }),
      messages: nextMessages,
      tools: {
        edit_style_guideline: tool({
          description:
            'Replace a unique substring in the style guideline. old_str must occur exactly once.',
          inputSchema: z.object({
            old_str: z.string(),
            new_str: z.string(),
          }),
          execute: async ({ old_str, new_str }: { old_str: string; new_str: string }) =>
            opts.tools.editStyleGuideline(old_str, new_str),
        }),
        add_or_replace_glossary: tool({
          description: 'Insert or overwrite a glossary row keyed by the source-language form.',
          inputSchema: z.object({
            src_lang_value: z.string(),
            dst_lang_value: z.string(),
          }),
          execute: async ({
            src_lang_value,
            dst_lang_value,
          }: {
            src_lang_value: string;
            dst_lang_value: string;
          }) => opts.tools.addOrReplaceGlossary(src_lang_value, dst_lang_value),
        }),
        do_translate: tool({
          description:
            'Retranslate the current sample chunk with the latest style guide and glossary.',
          inputSchema: z.object({
            reason: z
              .string()
              .optional()
              .describe('Why this retranslation is needed. Ignored by the tool.'),
          }),
          execute: async () => opts.tools.doTranslate(),
        }),
      },
      stopWhen: stepCountIs(8),
    });

    for await (const part of result.fullStream) {
      if (part.type === 'tool-input-start') {
        announce(part.toolName, part.id);
      } else if (part.type === 'tool-call') {
        announce(part.toolName, part.toolCallId);
      } else if (part.type === 'text-delta' && part.text) {
        opts.onEvent?.({ type: 'text', delta: part.text });
      } else if (part.type === 'error') {
        const err = part.error;
        throw err instanceof Error ? err : new Error(String(err));
      } else if (part.type === 'abort') {
        throw new DOMException('Aborted', 'AbortError');
      }
    }

    const text = (await result.text).trim();
    const responseMessages = await result.responseMessages;
    return {
      text,
      messages: [...nextMessages, ...responseMessages],
      toolNames,
    };
  } catch (err) {
    if (isAbortError(err) && !opts.abortSignal.aborted) {
      throw new Error('The model took too long to answer.');
    }
    throw err;
  }
}

async function mockImproveTurn(
  opts: {
    tools: ImproveTools;
    abortSignal: AbortSignal;
    onEvent?: (event: ImproveStreamEvent) => void;
  },
  nextMessages: ModelMessage[],
  userMessage: ModelMessage,
): Promise<ImproveTurnResult> {
  if (opts.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');
  const text = typeof userMessage.content === 'string' ? userMessage.content : '';
  const pair = /^(.+?)\s*(?:->|→)\s*(.+)$/m.exec(text.trim());
  if (pair) {
    const src = pair[1]!.trim();
    const dst = pair[2]!.trim();
    opts.onEvent?.({ type: 'tool', name: 'add_or_replace_glossary', id: 'mock-glossary' });
    const glossaryMsg = opts.tools.addOrReplaceGlossary(src, dst);
    opts.onEvent?.({ type: 'tool', name: 'do_translate', id: 'mock-translate' });
    await opts.tools.doTranslate();
    const reply = `${glossaryMsg} Retranslated the sample.`;
    opts.onEvent?.({ type: 'text', delta: reply });
    return {
      text: reply,
      messages: [...nextMessages, { role: 'assistant', content: reply }],
      toolNames: ['add_or_replace_glossary', 'do_translate'],
    };
  }
  opts.onEvent?.({ type: 'text', delta: MOCK_REPLY });
  return {
    text: MOCK_REPLY,
    messages: [...nextMessages, { role: 'assistant', content: MOCK_REPLY }],
    toolNames: [],
  };
}
