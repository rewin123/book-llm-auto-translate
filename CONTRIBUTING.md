# Contributing

Zero-install book translator: everything runs in the browser. No backend.

## Layout

- `src/ebook/` — parse EPUB/FB2 to markdown (incl. windows-1251 FB2), chunk, validate, pack a new EPUB
- `src/job/` — `JobRunner` (style → glossary → parallel translate windows → seam review), IndexedDB checkpoint, abort, cost estimate
- `src/graph/` — glossary extract node + translate node (frozen glossary + last two chunks)
- `src/style/` — style agent with `read_chunk`
- `src/review/` — post-translate review agent with `read_translate` / `edit_translate`
- `src/llm/` — BYOK providers, mock LLM, models.dev prices, prompts
- `src/glossary/` — name map merge/filter
- `src/ui/` is the React tree in `src/App.tsx` plus `src/i18n/` and `src/storage/`
- `tests/fixtures` live in `src/ebook/demoBook.ts` (Alice excerpt, public domain)

## Scripts

```bash
npm install
npm test
npm run dev
```

## Good first issues

- Add i18n strings in `src/i18n/en.ts` and `src/i18n/ru.ts` (keep keys in sync)
- Add a provider preset in `src/llm/presets.ts` (label, baseURL, default model, `tier`, CORS note)

## Rules

- Do not add a server. Keys stay in `booktrans.v1.*` localStorage.
- Do not splice translated markup back into the original EPUB. Convert to markdown, translate, then build a new EPUB.
- Parallel translate windows are contiguous slices (`ceil(chunks / concurrency)`). The glossary is frozen before translation.
