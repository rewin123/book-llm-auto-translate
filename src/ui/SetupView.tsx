import type { ParseErrorCode } from '../ebook/index.ts';
import { fmt, useT } from '../i18n/index.ts';
import { ArrowRight, CheckIcon, CrossIcon } from './icons.tsx';
import { BookDrop, type BookInfo } from './BookDrop.tsx';

type Props = {
  book: BookInfo | null;
  parsing: boolean;
  parseError: { code: ParseErrorCode; fileName: string } | null;
  onFile: (f: File) => void;
  onDemo: () => void;
  onClearError: () => void;
  onContinue: () => void;
};

export function SetupView(props: Props) {
  const { t } = useT();
  const { book } = props;
  const canContinue = !!book && !props.parsing;

  return (
    <div className="stack">
      <BookDrop
        book={book}
        parsing={props.parsing}
        parseError={props.parseError}
        onFile={props.onFile}
        onDemo={props.onDemo}
        onClearError={props.onClearError}
      />

      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-6)',
            flexWrap: 'wrap',
          }}
        >
          <ul className="checklist">
            <Item ok={!!book}>
              {book
                ? fmt(t.readyBook, { chunks: book.chunks, chapters: book.chapters })
                : props.parsing
                  ? t.notReadyParsing
                  : t.notReadyBook}
            </Item>
          </ul>

          <button
            className="btn btn-primary"
            type="button"
            disabled={!canContinue}
            onClick={props.onContinue}
            style={{ padding: '12px 20px' }}
          >
            {t.continueToSettings}
            <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}

function Item({ ok, children }: { ok: boolean | 'warn'; children: React.ReactNode }) {
  return (
    <li data-ok={String(ok)}>
      <span className="mark">{ok === true ? <CheckIcon /> : <CrossIcon />}</span>
      <span>{children}</span>
    </li>
  );
}
