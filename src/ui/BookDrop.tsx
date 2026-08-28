import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, type ParseErrorCode } from '../ebook/index.ts';
import { fmt, formatBytes, useT } from '../i18n/index.ts';
import { AlertIcon, BookIcon, CheckIcon } from './icons.tsx';

export type BookInfo = {
  fileName: string;
  title: string;
  format: string;
  chapters: number;
  chunks: number;
  bytes: number;
};

type Props = {
  book: BookInfo | null;
  parsing: boolean;
  parseError: { code: ParseErrorCode; fileName: string } | null;
  onFile: (file: File) => void;
  onDemo: () => void;
  onClearError: () => void;
};

export function BookDrop({ book, parsing, parseError, onFile, onDemo, onClearError }: Props) {
  const { t, locale } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = () => inputRef.current?.click();

  const hiddenInput = (
    <input
      ref={inputRef}
      className="sr-only"
      type="file"
      accept={ACCEPTED_EXTENSIONS}
      aria-label={t.browse}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        // Allows re-picking the same file after fixing it on disk.
        e.target.value = '';
      }}
    />
  );

  if (parsing) {
    return (
      <div className="card" aria-busy="true">
        <div className="book-row">
          <span className="spinner" />
          <div>
            <strong>{t.parsing}</strong>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              {t.parsingHint}
            </p>
          </div>
        </div>
        {hiddenInput}
      </div>
    );
  }

  if (parseError) {
    const detail = t.parseErr[parseError.code];
    return (
      <div className="card banner banner-danger" role="alert">
        <span className="banner-icon error">
          <AlertIcon />
        </span>
        <div>
          <strong>{t.parseErr.title}</strong>
          <p>{fmt(detail, { file: parseError.fileName })}</p>
          <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                onClearError();
                pick();
              }}
            >
              {t.parseErr.action}
            </button>
          </div>
        </div>
        {hiddenInput}
      </div>
    );
  }

  if (book) {
    return (
      <div className="card">
        <div className="book-row">
          <span className="book-cover">
            <BookIcon size={26} />
          </span>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <strong className="serif" style={{ fontSize: 'var(--text-lg)' }}>
                {book.title}
              </strong>
              <span className="pill ok">
                <CheckIcon size={12} />
                {t.bookReady}
              </span>
            </div>
            <p className="hint" style={{ margin: '5px 0 0' }}>
              {book.fileName} ·{' '}
              {fmt(t.bookMeta, {
                format: book.format.toUpperCase(),
                chapters: book.chapters,
                chunks: book.chunks,
                size: formatBytes(book.bytes, locale),
              })}
            </p>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              {t.bookPrivacy}
            </p>
          </div>
          <button className="btn" type="button" onClick={pick}>
            {t.replace}
          </button>
        </div>
        {hiddenInput}
      </div>
    );
  }

  return (
    <>
      {/* A real button: reachable with Tab and opened with Enter or Space, which
          the previous click-handler div never was. */}
      <button
        type="button"
        className={`drop ${over ? 'over' : ''}`}
        aria-label={t.dropAria}
        onClick={pick}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        <span className="book-cover" style={{ margin: '0 auto var(--space-3)', border: 0, background: 'none', width: 'auto', height: 'auto' }}>
          <BookIcon size={30} />
        </span>
        <h2>{t.dropTitle}</h2>
        <p>{t.dropHint}</p>
      </button>
      <div className="actions" style={{ justifyContent: 'center', marginTop: 'var(--space-3)' }}>
        <button className="btn" type="button" onClick={pick}>
          {t.browse}
        </button>
        <button className="btn" type="button" onClick={onDemo}>
          {t.demo}
        </button>
      </div>
      {hiddenInput}
    </>
  );
}
