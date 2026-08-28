import type { GlossaryEntry } from '../glossary/index.ts';

export function translateSystemPrompt(opts: {
  sourceLang: string;
  targetLang: string;
  styleGuide: string;
}): string {
  return `You are a literary translator. Translate from ${opts.sourceLang} to ${opts.targetLang}.

STYLE GUIDE (mandatory):
${opts.styleGuide}

HARD RULES:
- Translate only human-readable text and image alt/title attributes.
- Preserve every XML/HTML tag, attribute, and attribute value for id, href, src, class, epub:type.
- Do not add, remove, reorder, or rename tags.
- Do not translate CSS, URLs, ids, or file paths.
- Output must be well-formed XML matching the source fragment.

Return EXACTLY this format:
<<<TRANSLATION>>>
<the translated markup>
<<<END_TRANSLATION>>>
<<<GLOSSARY>>>
SourceName | TargetName
<<<END_GLOSSARY>>>

Glossary lines are NEW proper-name mappings discovered in this chunk only.`;
}

export function translateUserPrompt(opts: {
  xml: string;
  glossary: GlossaryEntry[];
  lastTwo: { original: string; translation: string }[];
}): string {
  const glossary =
    opts.glossary.length === 0
      ? '(none yet)'
      : opts.glossary.map((g) => `${g.src} — ${g.dst}`).join('\n');
  const recent = opts.lastTwo
    .map(
      (c, i) =>
        `<prev${i + 1}><original>${c.original}</original><translate>${c.translation}</translate></prev${i + 1}>`,
    )
    .join('\n');
  return `GLOSSARY (use these exact forms when the source word appears):
${glossary}

PREVIOUS TWO CHUNKS:
${recent || '(start of book)'}

<<<SOURCE>>>
${opts.xml}
<<<END_SOURCE>>>`;
}

export function styleAgentSystemPrompt(opts: {
  sourceLang: string;
  targetLang: string;
  totalChunks: number;
}): string {
  return `You are a senior literary translator writing a PROJECT STYLE SHEET before any translation begins.

You are NOT translating the book. You are sampling it.

There are ${opts.totalChunks} chunks, indexed 0..${opts.totalChunks - 1}.
You have one tool: read_chunk(idx) → source markup.

Sampling strategy (do not read every chunk):
- 0 and 1: title / opening voice
- a dialogue-heavy passage if you can find one
- a descriptive / interior passage
- around ${Math.floor(opts.totalChunks / 3)} and ${Math.floor((opts.totalChunks * 2) / 3)} and the last chunk for register drift

Limit yourself to at most 10 reads, then write the guide.

Language pair: ${opts.sourceLang} → ${opts.targetLang}.

Write a compact style sheet (800–2000 tokens) with:
1. Work (genre, audience, period voice)
2. Narrative (tense, POV, rhythm, intentional repetition)
3. Register and address (T–V, narrator vs dialogue, profanity)
4. Dialogue punctuation for the TARGET language
5. Names strategy (transliterate vs translate) — not a full name list
6. Idioms and culture
7. Target typography; never break HTML/XML tags
8. Do / Don't with 1–2 mini examples from chunks you read

Output ONLY the style sheet markdown, no preamble.`;
}
