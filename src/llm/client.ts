import { reverseMarkdownText } from '../ebook/markdown.ts';
import type { GlossaryEntry } from '../glossary/index.ts';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: { name: string; description: string; parameters: unknown }[];
  abortSignal?: AbortSignal;
  temperature?: number;
  /** Sized from the chunk rather than a fixed cap, so long chunks are not truncated. */
  maxTokens?: number;
};

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
};

export type LlmClient = {
  id: string;
  model: string;
  complete(req: ChatRequest): Promise<ChatResponse>;
};

export function mockClient(): LlmClient {
  return {
    id: 'mock',
    model: 'mock-reverse',
    async complete(req) {
      if (req.abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      const content = last?.content ?? '';
      if (req.tools?.some((t) => t.name === 'read_chunk')) {
        if (!content.includes('FINAL STYLE GUIDE') && !/style guide/i.test(
          req.messages.find((m) => m.role === 'assistant')?.content ?? '',
        )) {
          const already = req.messages.some((m) => m.role === 'tool');
          if (!already) {
            return {
              text: '',
              toolCalls: [
                { id: 'call_0', name: 'read_chunk', arguments: JSON.stringify({ idx: 0 }) },
                { id: 'call_1', name: 'read_chunk', arguments: JSON.stringify({ idx: 1 }) },
              ],
            };
          }
        }
        return { text: MOCK_STYLE_GUIDE, toolCalls: [] };
      }
      const markdown = extractTagged(content, 'SOURCE') ?? content;
      return { text: formatTranslateOutput(reverseMarkdownText(markdown), []), toolCalls: [] };
    },
  };
}

const MOCK_STYLE_GUIDE = `## Work
Genre: children's literary excerpt. Audience: general readers. Pair: source → target as given.

## Narrative
Keep past tense. Close third-person. Preserve Alice's breathless rhythm and intentional repetition (very / curiouser).

## Register
Informal narration; do not modernize slang beyond the target literary norm.

## Dialogue
Use target-language dialogue punctuation (Russian: em-dash / «guillemets» if translating to ru). Keep character voices distinct.

## Names
Transliterate personal names; do not localize Alice → Алиса unless the target convention expects it (for ru: Алиса is traditional — follow target literary canon).

## Idioms
Prefer established target equivalents over calques.

## Typography
Do not alter markdown structure, link targets, or image paths. Translate alt text.

## Do / Don't
- Do preserve *emphasis* / **strong**.
- Don't drop images.
- Don't add translator footnotes.
`;

export function extractTagged(text: string, tag: string): string | undefined {
  const re = new RegExp(`<<<${tag}>>>\\s*([\\s\\S]*?)\\s*<<<END_${tag}>>>`, 'i');
  const m = re.exec(text);
  return m?.[1]?.trim();
}

export function formatTranslateOutput(markdown: string, glossary: GlossaryEntry[]): string {
  const lines = glossary.map((g) => `${g.src} | ${g.dst}`).join('\n');
  return `<<<TRANSLATION>>>\n${markdown}\n<<<END_TRANSLATION>>>\n<<<GLOSSARY>>>\n${lines}\n<<<END_GLOSSARY>>>`;
}

export function parseTranslateOutput(text: string): { markdown: string; glossary: GlossaryEntry[] } {
  const markdown = extractTagged(text, 'TRANSLATION') ?? stripFence(text);
  const raw = extractTagged(text, 'GLOSSARY') ?? '';
  const glossary: GlossaryEntry[] = [];
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^(.+?)\s*(?:->|—|–|\|)\s*(.+)$/);
    if (m) glossary.push({ src: m[1]!.trim(), dst: m[2]!.trim() });
  }
  return { markdown: markdown.trim(), glossary };
}

function stripFence(text: string): string {
  return text.replace(/^```(?:markdown|md|xml|html)?\n?/i, '').replace(/\n?```$/i, '').trim();
}
