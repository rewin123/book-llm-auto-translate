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
- Translate only human-readable text and image alt text.
- Preserve markdown structure: headings, emphasis, lists, blockquotes, code fences, tables.
- Preserve link targets and image paths exactly. Translate the visible text / alt, never the URL or path inside (...).
- Do not add, remove, or convert markdown into HTML/XML tags.
- Output markdown only — no preamble.
- The SOURCE block is the original. Write only the ${opts.targetLang} translation. Do not copy the source language into the output, and do not repeat previous chunks.
- Use the glossary forms exactly when the source word appears. Do not add, drop, or rewrite glossary entries.

Return EXACTLY this format:
<<<TRANSLATION>>>
the translated markdown
<<<END_TRANSLATION>>>`;
}

export function translateUserPrompt(opts: {
  markdown: string;
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
        `<prev${i + 1}><original>\n${c.original}\n</original><translate>\n${c.translation}\n</translate></prev${i + 1}>`,
    )
    .join('\n');
  return `GLOSSARY (complete list — use these exact forms when the source word appears):
${glossary}

PREVIOUS TWO CHUNKS:
${recent || '(start of book)'}

<<<SOURCE>>>
${opts.markdown}
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
You have one tool: read_chunk(idx) → source markdown.

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
7. Target typography; never break markdown, links, or image paths
8. Do / Don't with 1–2 mini examples from chunks you read

Output ONLY the style sheet markdown, no preamble.`;
}

export function styleAgentUserPrompt(opts: { totalChunks: number; chapterList: string }): string {
  return `Write the style sheet for this book.

Chapters and 1-based chunk ranges (read_chunk uses 0-based idx = number − 1):
${opts.chapterList || '(no chapters)'}

total_chunks=${opts.totalChunks}. Use read_chunk.`;
}

export function glossarySystemPrompt(opts: {
  sourceLang: string;
  targetLang: string;
  styleGuide: string;
}): string {
  return `You extract a translation glossary. You are NOT translating the book.

STYLE GUIDE (mandatory):
${opts.styleGuide}

Language pair: ${opts.sourceLang} → ${opts.targetLang}.

Extract every proper name, place, title, and other unique word that must stay consistent when translating into ${opts.targetLang}. Translate each source form into ${opts.targetLang}.

Return ONLY a JSON object mapping source → target, no preamble, no markdown fences:
{"Andrei":"Андрей","Source Name":"Target Name"}`;
}

export function glossaryUserPrompt(opts: { markdown: string; targetLang: string }): string {
  return `Form a glossary for this text. Extract each name and unique word which must be consistent for translating and translate it to ${opts.targetLang}. Present as a JSON object { "source": "target", ... }.

<<<SOURCE>>>
${opts.markdown}
<<<END_SOURCE>>>`;
}

function glossaryLines(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return '(none yet)';
  return glossary.map((g) => `${g.src} — ${g.dst}`).join('\n');
}

export function improveAgentSystemPrompt(opts: {
  sourceLang: string;
  targetLang: string;
  chunkIndex: number;
  chunkCount: number;
  styleGuide: string;
  glossary: GlossaryEntry[];
  original: string;
  translation: string;
}): string {
  return `You are a senior literary editor. The style sheet and glossary below will be used for every remaining chapter. The user is reviewing ONE sample translation. Improve the sheet and glossary so the next translation of this chunk is better. You are not translating the rest of the book.

Language pair: ${opts.sourceLang} → ${opts.targetLang}.
Sample chunk index ${opts.chunkIndex} (0-based) of ${opts.chunkCount}. Isolated: no previous-chunk context.

CURRENT STYLE GUIDE:
${opts.styleGuide || '(empty)'}

CURRENT GLOSSARY:
${glossaryLines(opts.glossary)}

ORIGINAL:
${opts.original}

CURRENT TRANSLATION:
${opts.translation}

Tools:
- edit_style_guideline(old_str, new_str) — replace a unique substring in the style guide. If it matches 0 or 2+ times, tighten old_str.
- add_or_replace_glossary(src, dst) — insert or overwrite one glossary row by source form.
- do_translate() — retranslate THIS chunk with the updated guide and glossary. Returns { original, translate }.

After any guide or glossary change you MUST call do_translate so the user sees the new sample. Do not invent a translation in chat. After tools, briefly say what changed. Do not read other chunks.`;
}
