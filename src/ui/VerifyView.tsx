import { useEffect, useRef, useState } from 'react';
import type { ModelMessage } from 'ai';
import type { Chunk } from '../ebook/types.ts';
import type { GlossaryEntry } from '../glossary/index.ts';
import type { JobRunner } from '../job/runner.ts';
import type { TranslatedPair } from '../job/types.ts';
import { fmt, shortLanguageName, useT } from '../i18n/index.ts';
import { runImproveTurn } from '../verify/agent.ts';
import { comparePaneMarkdown } from './compareText.ts';
import { markupToSafeHtml } from './sanitize.ts';
import { ArrowRight, CheckIcon, ChevronLeft, ChevronRight, WarnIcon } from './icons.tsx';

type ChatLine =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; text: string }
  | { id: number; role: 'tool'; name: string; detail: string };

type Props = {
  runner: JobRunner;
  chunks: Chunk[];
  verifyIndex: number;
  verifyPair: TranslatedPair | null;
  glossary: GlossaryEntry[];
  sourceLang: string;
  targetLang: string;
  translating: boolean;
  busy: boolean;
  onChunkChange: (index: number) => void;
  onContinue: () => void;
};

export function VerifyView(props: Props) {
  const { t, locale } = useT();
  const { chunks, verifyIndex, verifyPair } = props;
  const max = Math.max(chunks.length - 1, 0);
  const idx = Math.min(Math.max(verifyIndex, 0), max);
  const chunk = chunks[idx];
  const panes = chunk ? comparePaneMarkdown(chunk, verifyPair ?? undefined) : null;
  const ready = Boolean(verifyPair && verifyPair.index === idx);
  const kept = verifyPair?.usedOriginal === true;

  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const session = useRef(0);
  const chatAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    chatAbort.current?.abort();
    session.current += 1;
    nextId.current = 1;
    setHistory([]);
    setDraft('');
    setError(null);
    setSending(false);
    setLines([
      {
        id: 0,
        role: 'assistant',
        text: fmt(t.verifyHello, { n: idx + 1, total: chunks.length }),
      },
    ]);
    // Recreate the agent when the sample chunk changes, not when it is retranslated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines, sending]);

  const locked = props.translating || props.busy || sending || retranslating || !ready;

  const send = async () => {
    const text = draft.trim();
    if (!text || locked || !chunk || !verifyPair) return;
    const turnAbort = new AbortController();
    chatAbort.current = turnAbort;
    props.runner.abort = turnAbort;
    const turn = session.current;
    const userId = nextId.current++;
    setDraft('');
    setError(null);
    setLines((prev) => [...prev, { id: userId, role: 'user', text }]);
    setSending(true);
    let assistantId: number | null = null;
    try {
      const result = await runImproveTurn({
        stored: props.runner.stored!,
        abortSignal: turnAbort.signal,
        sourceLang: props.sourceLang,
        targetLang: props.targetLang,
        chunkIndex: idx,
        chunkCount: chunks.length,
        styleGuide: props.runner.styleGuide,
        glossary: props.runner.glossary,
        original: verifyPair.original,
        translation: verifyPair.translation,
        messages: history,
        userText: text,
        onEvent: (event) => {
          if (turn !== session.current) return;
          if (event.type === 'tool') {
            setLines((prev) => [
              ...prev,
              {
                id: nextId.current++,
                role: 'tool',
                name: event.name,
                detail: toolLabel(event.name, t),
              },
            ]);
            return;
          }
          const delta = event.delta;
          if (!delta) return;
          if (assistantId == null) {
            assistantId = nextId.current++;
            const id = assistantId;
            setLines((prev) => [...prev, { id, role: 'assistant', text: delta }]);
            return;
          }
          const id = assistantId;
          setLines((prev) =>
            prev.map((line) =>
              line.id === id && line.role === 'assistant'
                ? { ...line, text: line.text + delta }
                : line,
            ),
          );
        },
        tools: {
          editStyleGuideline: (oldStr, newStr) => props.runner.patchVerifyGuide(oldStr, newStr),
          addOrReplaceGlossary: (src, dst) => props.runner.upsertVerifyGlossary(src, dst),
          doTranslate: async () => {
            setRetranslating(true);
            try {
              return await props.runner.retranslateVerify();
            } finally {
              setRetranslating(false);
            }
          },
        },
      });
      if (turn !== session.current) return;
      setHistory(result.messages);
    } catch (err) {
      if (turn !== session.current) return;
      if (turnAbort.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (turn === session.current) setSending(false);
    }
  };

  return (
    <div className="verify">
      <aside className="verify-chat">
        <div className="verify-chat-head">
          <strong>{t.verifyChatTitle}</strong>
          <span className="hint">{t.verifyChatHint}</span>
        </div>
        <div className="verify-chat-log" ref={scroller}>
          {lines.map((line) =>
            line.role === 'tool' ? (
              <div key={line.id} className="verify-tool">
                {line.detail}
              </div>
            ) : (
              <div key={line.id} className={`verify-bubble ${line.role}`}>
                {line.text}
              </div>
            ),
          )}
          {sending && <div className="verify-tool">{t.verifyThinking}</div>}
          {error && <div className="verify-bubble error">{error}</div>}
        </div>
        {props.glossary.length > 0 && (
          <p className="hint verify-glossary-count">
            {fmt(t.glossaryCount, { n: props.glossary.length })}
          </p>
        )}
        <form
          className="verify-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            placeholder={t.verifyPlaceholder}
            rows={3}
            disabled={locked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={locked || !draft.trim()}>
            {t.verifySend}
            <ArrowRight />
          </button>
        </form>
        <p className="hint verify-continue-hint">{t.verifyContinueHint}</p>
        <button
          className="btn btn-primary verify-continue"
          type="button"
          disabled={props.busy || props.translating || !ready}
          onClick={props.onContinue}
        >
          {t.translateAll}
          <ArrowRight />
        </button>
      </aside>

      <section className="verify-pane">
        <div className="verify-pane-bar">
          <label htmlFor="verify-chunk">{t.verifyChunk}</label>
          <div className="verify-chunk-nav">
            <button
              className="btn btn-sm"
              type="button"
              aria-label={t.prev}
              disabled={idx <= 0 || props.translating || props.busy}
              onClick={() => props.onChunkChange(idx - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <input
              id="verify-chunk"
              type="number"
              min={1}
              max={chunks.length}
              step={1}
              value={idx + 1}
              disabled={props.translating || props.busy}
              onChange={(e) => props.onChunkChange(Number(e.target.value) - 1)}
            />
            <span className="hint">{fmt(t.chunkLimitOf, { total: chunks.length })}</span>
            <button
              className="btn btn-sm"
              type="button"
              aria-label={t.next}
              disabled={idx >= max || props.translating || props.busy}
              onClick={() => props.onChunkChange(idx + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="pane-cap">
          <span>{fmt(t.translation, { lang: shortLanguageName(props.targetLang, locale) })}</span>
          {props.translating || retranslating ? (
            <span className="pill pill-busy" aria-live="polite">
              <span className="dot" aria-hidden="true" />
              <span>
                {t.verifyTranslating}
                <span className="ellipsis" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </span>
            </span>
          ) : kept ? (
            <span className="pill warn">
              <WarnIcon size={12} />
              {fmt(t.chunkKept, { lang: shortLanguageName(props.sourceLang, locale) })}
            </span>
          ) : ready ? (
            <span className="pill ok">
              <CheckIcon size={12} />
              {t.validated}
            </span>
          ) : (
            <span className="pill">{t.chunkPending}</span>
          )}
        </div>
        <article
          className={`page ${ready && !props.translating && !retranslating ? '' : 'is-pending'}`}
          dangerouslySetInnerHTML={{
            __html: markupToSafeHtml(panes?.translation ?? ''),
          }}
        />
      </section>

      <section className="verify-pane">
        <div className="verify-pane-bar">
          <span className="hint">{fmt(t.chunkHeading, { n: idx + 1, total: chunks.length })}</span>
          {chunk?.chapterTitle.trim() ? <span className="hint">{chunk.chapterTitle}</span> : null}
        </div>
        <div className="pane-cap">
          <span>{fmt(t.original, { lang: shortLanguageName(props.sourceLang, locale) })}</span>
        </div>
        <article
          className="page"
          dangerouslySetInnerHTML={{
            __html: markupToSafeHtml(panes?.original ?? ''),
          }}
        />
      </section>
    </div>
  );
}

function toolLabel(name: string, t: ReturnType<typeof useT>['t']): string {
  if (name === 'edit_style_guideline') return t.verifyToolGuide;
  if (name === 'add_or_replace_glossary') return t.verifyToolGlossary;
  if (name === 'do_translate') return t.verifyToolTranslate;
  return name;
}
