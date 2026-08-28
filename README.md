# Book LLM Auto-Translate

A **zero-install browser app** that translates EPUB and FB2 books with your own LLM key. There is no backend: the file never leaves the device. Only the text of the current chunk is sent to the model.

Unlike CLI tools such as `bilingual_book_maker`, the original container is **cloned**: images, fonts, CSS, and OPF stay put. Only the translated documents are swapped in.

A style agent samples the book first and drafts style guidelines. You edit them **before** any chapter is billed.

The UI is English and Russian, with light and dark themes. Locale and theme persist.

---

## Quick start

Live app: **[rewin123.github.io/book-llm-auto-translate](https://rewin123.github.io/book-llm-auto-translate/)**

### Try it without a key

1. Open the [live app](https://rewin123.github.io/book-llm-auto-translate/) (or run it locally).
2. Click **Try the sample — no key needed**.
3. That loads a public-domain *Alice in Wonderland* excerpt and the **Mock** provider.
4. Mock never hits the network and never bills: it **reverses text** inside tags so you can walk the pipeline.

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

Three steps in the header: **Book & model** → **Style guidelines** → **Translate**.

### 1. Book & model

#### File

Drop a file or click **Choose a file**.

| Format | Extensions |
| --- | --- |
| EPUB | `.epub` |
| FictionBook | `.fb2` |
| FB2 in an archive | `.fb2.zip`, `.fbz`, or a `.zip` that contains a `.fb2` |

FB2 is decoded from the XML declaration, including **windows-1251**, **koi8-r**, UTF-8/16, and ISO-8859-1. The output declaration is rewritten to UTF-8.

What **does not** leave the device: the container itself (images, fonts, styles). The API only sees the current chunk’s markup, plus the style guidelines, matching glossary rows, and the previous two chunks.

After parsing you see format, chapter count, chunk count, and size. If the file does not open:

| Message | What to do |
| --- | --- |
| format not supported | use EPUB / FB2 / FB2.ZIP / FBZ |
| ZIP has no `.fb2` | unpack it and drop the `.fb2` itself |
| archive or markup damaged | pick another file |
| no chapters found | the book has no readable sections |

#### Languages

Pairs from: English, Russian, German, French, Spanish, Chinese, Japanese, Korean, Italian, Portuguese. The arrow swaps direction. The pair is remembered between sessions (`booktrans.v1.setup`).

Default: **en → ru**.

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

#### Advanced

| Setting | Range | Default | Meaning |
| --- | --- | --- | --- |
| Chunk size | 800–20,000 characters | 5,000 | Smaller chunks are more reliable; larger ones carry more context per call. |
| Event log size | 5–200 | 40 | How many recent log lines to keep. Changing this never affects a running job. |

Changing chunk size **re-splits** the book. If translated chunks already exist, the app warns you: finished work for this file is lost.

These fields are locked while a translation is running.

The checklist at the bottom of the screen: book parsed, languages chosen, key present. Then **Continue to style guidelines**.

### 2. Style guidelines

The style agent does **not** translate the book. It samples chunks with the `read_chunk` tool (at most ~10 reads) and writes a style sheet: genre, narrative, register, T–V, dialogue punctuation, names, idioms, typography, do/don't.

You can **Pause** while it reads. Mock returns a short template almost immediately.

Then you edit the guidelines. Everything here goes into **every** later request. Chapter translation has not started yet, so nothing is billed except the agent’s sample reads.

**Glossary** — names held steady across chapters:

- add rows by hand or paste a list: `Alice -> Алиса` (also `—`, `–`, `|`);
- the model adds to the list as it goes;
- each chunk request only gets the pairs whose source form appears in that chunk.

**Chunks to translate** — a number from 1 to the full book. Shortcuts fill in the first chapter or all chunks. The cost/time estimate follows the number you pick. Untranslated chunks stay in the source language; you can **Translate the rest** later.

The estimate (chunks, tokens, cost, time) is **not a bill**. Every call carries the style guidelines (~1,500 tokens), a glossary cap, and the previous two chunks. Prices come from [models.dev](https://models.dev); unknown models show “price unknown”.

The primary button is **Translate the whole book** when the limit is the full count, or **Translate N chunks** otherwise.

### 3. Translate

Chunks run **sequentially** (parallelism is reserved; v1 is always 1).

On screen:

- progress, chapter, remaining-time estimate, spend so far, seconds per chunk;
- compare **side by side / translation only / original only**;
- navigate chunks and chapters; you can leave the live chunk and jump back;
- a log of requests, retries, and raw markup.

**Pause** and **Stop** abort the in-flight request. That chunk is **not** committed. **Resume** continues from the same index.

If the model’s markup fails validation three times, the **original** chunk is kept so the book still opens. You can **Retry these** later.

After a partial run: read the result, then **Translate the rest**.

**Download what is finished** works while paused: untranslated chunks keep their original text, so the file always opens.

### Done

Output name: `{source-name}.{lang}.epub` or `.fb2` — for example `book.ru.epub`.

Summary: translated vs kept original, tokens, cost, time. Images, fonts, and container structure are preserved.

- **Download** — the finished file.
- **Retry** chunks that stayed in the source language.
- **Export .json** — style guidelines and glossary for the next book.
- **Translate another book** — reset (with confirmation).

---

## Pipeline

1. Split by chapter (EPUB: spine documents; FB2: `section` in `body`; `notes` / `comments` bodies are skipped), then by up to *N* characters on tag and word boundaries.
2. Style agent (`read_chunk`) writes style guidelines → you edit → pick how many chunks to run → continue.
3. Each chunk is translated with the approved guide, matching glossary rows, and the last two chunks.
4. Markup is validated: well-formed XML, the same tag multiset, preserved `id` / `href` / `src`, plausible text length, no explicit model refusal. Three failures keep the original chunk.
5. The output file is a clone of the input container with translated documents swapped in. FB2 language metadata is updated.

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

- One chunk at a time; parallel windows exist in the code but are not enabled.
- No whole-book RAG — only the style guidelines, glossary, and two neighbouring chunks.
- PDF, MOBI, and AZW are not read.
- xAI from the browser is often blocked by CORS.
- The cost banner is an estimate, not the provider’s bill.

---

## Development

Layout (more in [CONTRIBUTING.md](CONTRIBUTING.md)):

| Path | Role |
| --- | --- |
| `src/ebook/` | parse, encodings (incl. windows-1251), chunk, validate markup, pack EPUB/FB2 |
| `src/job/` | `JobRunner`, IndexedDB checkpoint, abort, cost estimate |
| `src/graph/` | translate node (style guide + glossary + last two chunks) |
| `src/style/` | style agent with `read_chunk` |
| `src/llm/` | BYOK providers, mock LLM, models.dev prices, prompts |
| `src/glossary/` | name map merge/filter |
| `src/ui/`, `src/App.tsx` | React tree; `src/i18n/` and `src/storage/` |

Rules: do not add a server. Keys stay in `booktrans.v1.*` localStorage. Do not rewrite EPUB from scratch — clone the zip and replace translated documents.

Test fixtures live in `src/ebook/demoBook.ts` (Alice excerpt, public domain).

CI (`.github/workflows/ci.yml`): Node 22, `npm ci`, tests, build; on push to `main`, GitHub Pages from `dist/`.

---

## License

MIT. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
