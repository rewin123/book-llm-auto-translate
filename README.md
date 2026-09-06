# Book LLM Auto-Translate

A **zero-install browser app** that translates EPUB and FB2 books with your own LLM key. There is no backend: the file never leaves the device. Only the text of the current chunk is sent to the model.

Unlike CLI tools such as `bilingual_book_maker`, the book is converted to **markdown**, translated as markdown, then packed as a **new EPUB**. That avoids injecting model output back into the original XHTML, which used to break parsers.

A style agent samples the book first and drafts style guidelines. You edit them **before** any chapter is billed.

The UI is English and Russian, with light and dark themes. Locale and theme persist.

---

## Quick start

Live app: **[rewin123.github.io/book-llm-auto-translate](https://rewin123.github.io/book-llm-auto-translate/)**

### Try it without a key

1. Open the [live app](https://rewin123.github.io/book-llm-auto-translate/) (or run it locally).
2. Click **Try the sample — no key needed**.
3. That loads a public-domain *Alice in Wonderland* excerpt and the **Mock** provider.
4. Mock never hits the network and never bills: it **reverses readable text** in the markdown so you can walk the pipeline.

On GitHub Pages it is the same: **Try the sample** + **Mock**.

### Run locally

You need **Node.js 22+** and npm.

```bash
git clone <repository-url>
cd book-llm-auto-translate
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm test` | tests (vitest, one run) |
| `npm run test:watch` | tests in watch mode |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b` + production build into `dist/` |
| `npm run preview` | serve the built `dist/` locally |

The build uses `base: './'`, so you can open it as static files or host it on GitHub Pages. A push to `main` runs tests, builds, and deploys Pages.

---

## How to use it

Six steps in the header: **Book** → **Settings** → **Style** → **Verify** → **Glossary** → **Translate**. Glossary runs by itself; you do not stop to edit it.

### 1. Book

#### File

Drop a file or click **Choose a file**.

| Format | Extensions |
| --- | --- |
| EPUB | `.epub` |
| FictionBook | `.fb2` |
| FB2 in an archive | `.fb2.zip`, `.fbz`, or a `.zip` that contains a `.fb2` |

FB2 is decoded from the XML declaration, including **windows-1251**, **koi8-r**, UTF-8/16, and ISO-8859-1. The book is then converted to markdown; the download is always a UTF-8 EPUB.

What **does not** leave the device: the original file (images stay local and are copied into the new EPUB). The API only sees the current chunk’s markdown, plus the style guidelines, matching glossary rows, and the previous two chunks.

This screen is only for loading the file. After parsing you see format, chapter count, chunk count, and size. If the file does not open:

| Message | What to do |
| --- | --- |
| format not supported | use EPUB / FB2 / FB2.ZIP / FBZ |
| ZIP has no `.fb2` | unpack it and drop the `.fb2` itself |
| archive or markup damaged | pick another file |
| no chapters found | the book has no readable sections |

#### Languages and provider

These live on the **Settings** step (remembered in `booktrans.v1.setup`). Pairs: English, Russian, German, French, Spanish, Chinese, Japanese, Korean, Italian, Portuguese. Default **en → ru**.

#### Provider and key

Keys are BYOK. The page talks to the provider **directly** from the browser.

1. Pick a provider. The list is grouped: **Free / rate-limited**, paid APIs, then local.
2. Pick a model from the [models.dev](https://models.dev) catalog, or type one.
3. Paste a key if the provider needs one.
4. Click **Test connection** — a short request that checks CORS and latency.

**Custom** takes a Base URL (default Ollama: `http://localhost:11434/v1`).

##### Free endpoints

These need a **free developer key** (no card). They are rate-limited and not a production SLA. The cost banner shows **free**.

| Provider | Base URL | Browser CORS | Default model | Key |
| --- | --- | --- | --- | --- |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | often blocked | `nvidia/nemotron-3-nano-30b-a3b` | [build.nvidia.com](https://build.nvidia.com/settings/api-keys) (`nvapi-`) |
| Groq | `https://api.groq.com/openai/v1` | ok (`ACAO: *`, 2026-08-28) | `openai/gpt-oss-120b` | [console.groq.com](https://console.groq.com/keys) |
| OpenRouter `:free` | `https://openrouter.ai/api/v1` | ok | `nvidia/nemotron-3-nano-30b-a3b:free` | [openrouter.ai/keys](https://openrouter.ai/keys) |

NVIDIA’s hosted NIM catalog (Nemotron and others) is free for Developer Program members, but **`integrate.api.nvidia.com` does not send CORS headers**, so a browser tab cannot call it. From this app:

- Prefer **OpenRouter** and a model whose id ends in `:free` — same Nemotron weights, $0, CORS allowed.
- Or **Groq**, which does allow browser requests.
- If you still pick NVIDIA NIM and Test connection fails, **Use OpenRouter instead** switches to `nvidia/nemotron-3-nano-30b-a3b:free`.

Other Nemotron ids on OpenRouter: `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-super-120b-a12b:free`. On Groq: `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`.

##### All providers

| Provider | Base URL | Browser CORS | Key | Notes |
| --- | --- | --- | --- | --- |
| Mock | — | ok | no | Reverses text nodes. Tests and demo. |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | often blocked | yes, free | Nemotron. Prefer OpenRouter `:free` from a web app. |
| Groq | `https://api.groq.com/openai/v1` | ok | yes, free tier | Fast. Rate-limited developer plan. |
| OpenRouter | `https://openrouter.ai/api/v1` | ok (`ACAO: *`) | yes | Paid models plus `:free` (Nemotron, Llama, …). |
| DeepSeek | `https://api.deepseek.com/v1` | ok | yes | Default `deepseek-v4-flash`. Echoes Origin (2026-07-30). |
| OpenAI | `https://api.openai.com/v1` | ok | yes | Default `gpt-4.1-mini`. |
| xAI / Grok | `https://api.x.ai/v1` | often blocked | yes | Prefer OpenRouter `x-ai/grok-*`. |
| Custom | e.g. `http://localhost:11434/v1` | local | no | Enable CORS (`OLLAMA_ORIGINS=*`). |

**Test connection** is optional: you can continue without it, but a bad key or CORS failure will surface on the style guidelines step or mid-book.

The Book step checklist is only “file parsed”. Then **Continue to settings**.

### 2. Settings

Provider, model, and key stay here, along with generation controls:

| Setting | Default | Meaning |
| --- | --- | --- |
| Parallel threads | 1 | Contiguous sequential windows. `1` is the old behaviour. No upper cap. |
| Chunk size | 5,000 | Standard markdown split. Changing it re-splits the book. |
| Chunks per glossary call | 4 | How many standard chunks form one glossary LLM request. |
| Chunks per review call | 5 | Consecutive chunks one review agent sees. Adjacent windows overlap by one chunk so seams are visible. |

Languages are chosen on this screen. Changing the pair re-parses so bilingual books can drop already-translated paragraphs.

The Generation card shows an estimated dollar cost for glossary + translation + seam review at the current model, concurrency, glossary batch, and review batch. It is not a bill.

Event log size (5–200, default 40) stays under Advanced. Changing chunk size **re-splits** the book; if translated chunks already exist, the app warns you.

### 3. Style guidelines

The style agent does **not** translate the book. It samples chunks with the `read_chunk` tool (at most ~10 reads) and writes a style sheet: genre, narrative, register, T–V, dialogue punctuation, names, idioms, typography, do/don't.

You can **Pause** while it reads. Mock returns a short template almost immediately.

Then you edit the guidelines. Everything here goes into **every** later request. Chapter translation has not started yet, so nothing is billed except the agent’s sample reads.

**Seed glossary** — optional rows you add before the extract pass. Those rows win over later model extracts.

The style-agent user message includes the chapter list with 1-based chunk ranges, for example `# Redemption (chunks from 12 to 18)`. `read_chunk` is still 0-based.

The primary button is **Verify on a sample**.

### 4. Verify

The longest chunk is translated in isolation (it is not written into the book). Chat sits next to the **translation above the original**. Say what is wrong — names, register, punctuation — and an improve agent can:

- patch a unique substring in the style sheet;
- insert or overwrite a glossary row;
- retranslate this chunk so you see the new sample.

Tool calls stream into the chat as they happen. Changing the chunk number rebuilds the sample and starts a fresh agent.

When the sample looks right, **Translate the whole book**. The glossary is extracted next, then the book.

### 5. Glossary

Standard chunks are packed into big chunks (`glossaryBatch` at a time). Each big chunk is one LLM call that returns a JSON object `{ "Andrei": "Андрей", ... }`. Extracts are merged left-to-right; if the same source form appears with two translations, the **earlier** big chunk wins (seed and verify rows first).

This pass is automatic. There is no review screen: when the list is built, translation starts.

The estimate on Settings is **not a bill**. Translation calls carry the style guidelines, the full glossary, and the previous two chunks (when those translations already exist). Prices come from [models.dev](https://models.dev); unknown models show “price unknown”.

### 6. Translate

Chunks are split into `ceil(N / parallel)` contiguous windows. Each window runs sequentially; windows run in parallel. The first chunk of a later window has no previous translation until a resume. The model returns **only** the translation.

When every chunk is in, a **seam review** pass runs. It packs `reviewBatch` chunks per agent, overlapping neighbours by one chunk, and lets the agent call `read_translate` / `edit_translate` until the joins look right. Even and odd windows are two parallel waves so two agents never edit the same overlap at once.

On screen:

- progress, chapter, remaining-time estimate, spend so far, seconds per chunk;
- compare **side by side / translation only / original only**;
- navigate chunks and chapters; you can leave the live chunk and jump back;
- a log of requests, retries, and raw markdown.

**Pause** and **Stop** abort the in-flight request. That chunk is **not** committed. **Resume** continues from the same index.

If the model’s markdown fails validation three times, the **original** chunk is kept so the book still opens. You can **Retry these** later.

After a partial run: read the result, then **Translate the rest**.

**Download what is finished** works while paused: untranslated chunks keep their original text, so the file always opens.

### Done

Output name: `{source-name}.{lang}.epub` — for example `book.ru.epub`. FB2 input is converted the same way and still comes out as EPUB.

Summary: translated vs kept original, tokens, cost, time. Referenced images are copied into the new file; original CSS, fonts, and container structure are not kept.

- **Download** — the finished EPUB.
- **Retry** chunks that stayed in the source language.
- **Export .json** — style guidelines and glossary for the next book.
- **Translate another book** — reset (with confirmation).

---

## Pipeline

1. Convert EPUB/FB2 to markdown (spine documents or FB2 `section`s become chapters; `notes` / `comments` bodies are skipped). Images become `![alt](path)`.
2. Split markdown by up to *N* characters on paragraph, heading, and word boundaries (never inside a link target or code fence).
3. Style agent (`read_chunk`) writes style guidelines, with a chapter list in the user message → you edit.
4. Guideline verifier: translate the longest chunk, chat to patch the sheet and glossary, retranslate the sample.
5. Glossary pass: big chunks of `glossaryBatch` standard chunks, one JSON map per call, merged first-wins (seed and verify rows first, then earlier big chunks). Runs unattended, then translation starts.
6. Parallel translation: `ceil(N / parallel)` sequential windows. Each call gets the frozen glossary, style guide, and the previous two translations when they exist. Output is translation only.
7. Markdown is validated: non-empty, plausible text length, preserved image paths and link targets, no explicit model refusal. Three failures keep the original chunk.
8. Seam review: overlapping windows of `reviewBatch` chunks (`[0, M_C)`, `[M_C−1, 2M_C−1)`, …). Each window launches an agent with `read_translate` / `edit_translate` so it can fix stitching at chunk boundaries without rewriting the whole passage. Even and odd windows run as two parallel waves so overlap chunks are not written concurrently.
9. Translated chunks are concatenated into one markdown document, then converted to a new EPUB.

One model request times out after **3 minutes**.

---

## Pause, refresh, offline

After every **accepted** chunk a checkpoint is written to IndexedDB (`booktrans-v1`, key `current`): file, settings, style guidelines, glossary, and finished work.

Refresh the tab and an **Unfinished book** banner appears: pick up where you left off, or discard.

If you go offline, the in-flight request retries by itself when the connection returns; finished chunks are already saved. While the browser is offline, retries are uncapped.

Retry ceilings when the network is up:

| Situation | Retries |
| --- | --- |
| 429 rate limit | up to 8, with backoff |
| provider 5xx | up to 8 |
| dropped connection | up to 8 |
| CORS / “Failed to fetch” while online | up to 3, then stop — retrying will not help |
| 401/403, context too long, unknown model | no retry; the UI asks you to act |

---

## BYOK and XSS

The API key is stored in `localStorage` on this origin (`booktrans.v1.providers`) and sent only to the provider you selected. Any script that can run on this page can read it.

- Do not inject model output as live HTML (the log is text).
- Do not host this app on a domain that also serves untrusted user HTML.
- **Forget this key** removes it from the browser.

Other localStorage keys: `booktrans.v1.setup`, `booktrans.v1.locale`, `booktrans.v1.theme`, and the catalog cache `booktrans.v1.modelsdev`.

---

## Common errors

| Situation | What to do |
| --- | --- |
| Key rejected | Paste the whole key, for this provider. |
| Provider refused the request from a web page | CORS. Switch provider (OpenRouter often works) or enable CORS on a local server (`OLLAMA_ORIGINS=*`). |
| Provider asking to slow down | Finished chunks are safe; the job waits and continues. You can pause instead. |
| Chunk too big for this model | Lower chunk size in Advanced and resume. |
| Request rejected | Usually a model name that does not exist on this provider. |
| 5xx / connection dropped | Retry; it continues from the same chunk. |

---

## v1 limits

- Parallelism is contiguous windows, not a token-level batch API. Window seams have no previous translation on the first pass; a later review agent sees them with a one-chunk overlap.
- No whole-book RAG — only the style guidelines, the frozen glossary, and two neighbouring chunks.
- PDF, MOBI, and AZW are not read.
- Output is always EPUB. Original CSS, fonts, and page layout are not preserved.
- xAI from the browser is often blocked by CORS.
- The cost banner is an estimate, not the provider’s bill.

---

## Development

Layout (more in [CONTRIBUTING.md](CONTRIBUTING.md)):

| Path | Role |
| --- | --- |
| `src/ebook/` | parse EPUB/FB2 → markdown, encodings (incl. windows-1251), chunk, validate markdown, pack a new EPUB |
| `src/job/` | `JobRunner` (style → verify → glossary → parallel windows → seam review), IndexedDB checkpoint, abort, cost estimate |
| `src/verify/` | sample-chunk verifier: improve agent, tools, longest-chunk pick |
| `src/review/` | post-translate seam reviewer: overlapping windows, `read_translate` / `edit_translate` |
| `src/graph/` | glossary extract + translate node (frozen glossary + last two chunks) |
| `src/style/` | style agent with `read_chunk` |
| `src/llm/` | BYOK providers, mock LLM, models.dev prices, prompts |
| `src/glossary/` | name map merge/filter |
| `src/ui/`, `src/App.tsx` | React tree; `src/i18n/` and `src/storage/` |

Rules: do not add a server. Keys stay in `booktrans.v1.*` localStorage. Do not splice translated markup back into the original EPUB — convert to markdown, translate, then build a new EPUB.

Test fixtures live in `src/ebook/demoBook.ts` (Alice excerpt, public domain).

CI (`.github/workflows/ci.yml`): Node 22, `npm ci`, tests, build; on push to `main`, GitHub Pages from `dist/`.

---

## License

MIT. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
