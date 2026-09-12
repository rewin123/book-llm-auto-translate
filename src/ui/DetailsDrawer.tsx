import type { JobEvent } from '../job/types.ts';
import { fmt, useT } from '../i18n/index.ts';
import { ChevronRight } from './icons.tsx';

/** Renders a log line in the UI locale; provider text falls back to verbatim. */
export function eventText(event: JobEvent, t: ReturnType<typeof useT>['t']): string {
  if (event.key && event.key in t.log) {
    return fmt(t.log[event.key], event.params);
  }
  return event.message ?? '';
}

export function DetailsDrawer({ events }: { events: JobEvent[] }) {
  const { t, locale } = useT();
  if (events.length === 0) return null;

  return (
    <details className="disclosure">
      <summary>
        <span className="chev">
          <ChevronRight />
        </span>
        <span>{t.details}</span>
      </summary>
      <div className="body">
        <div className="log">
          {/* Keyed from the end, so an arriving event does not shift every
              existing row's key and remount the list — which used to collapse a
              text selection the moment the next chunk finished. */}
          {[...events].reverse().map((e, i) => (
            <article key={`${e.ts}-${events.length - 1 - i}`}>
              <div className={e.kind === 'error' ? 'error' : undefined}>
                <time dateTime={new Date(e.ts).toISOString()}>
                  {new Date(e.ts).toLocaleTimeString(locale)}
                </time>{' '}
                · {eventText(e, t)}
              </div>
              {e.xml && <div className="xml">{e.xml.slice(0, 1200)}</div>}
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

/** The single line a screen reader announces as the job moves. */
export function LiveStatus({ text }: { text: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {text}
    </p>
  );
}
