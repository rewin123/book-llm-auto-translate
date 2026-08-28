import type { JobFailure } from '../job/types.ts';
import { fmt, useT } from '../i18n/index.ts';
import { AlertIcon, BlockIcon, ClockIcon, OfflineIcon } from './icons.tsx';

type Props = {
  failure: JobFailure;
  provider: string;
  busy: boolean;
  onRetry: () => void;
  onFixSettings: (target: 'model' | 'advanced' | 'cors') => void;
};

/**
 * Says what actually happened. Previously every one of these surfaced as
 * "Connection dropped", and a CORS refusal retried at 15s intervals forever.
 */
export function FailureBanner({ failure, provider, busy, onRetry, onFixSettings }: Props) {
  const { t } = useT();
  const copy = t.err[failure.kind];
  const retryable = failure.kind === 'server' || failure.kind === 'network' || failure.kind === 'unknown';

  return (
    <div className={`card banner ${failure.kind === 'rate' ? 'banner-warn' : 'banner-danger'}`} role="alert">
      <span className={`banner-icon ${failure.kind === 'rate' ? 'warn' : 'error'}`}>
        <Icon kind={failure.kind} />
      </span>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <strong>{fmt(copy.title, { provider })}</strong>
        <p>{copy.body}</p>
        <div className="actions" style={{ marginTop: 'var(--space-3)' }}>
          {retryable && (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={onRetry}>
              {t.retry}
            </button>
          )}
          {failure.kind === 'cors' && (
            <button className="btn btn-primary" type="button" onClick={() => onFixSettings('cors')}>
              {'suggest' in copy ? copy.suggest : copy.action}
            </button>
          )}
          {(failure.kind === 'auth' || failure.kind === 'request' || failure.kind === 'cors') && (
            <button className="btn" type="button" onClick={() => onFixSettings('model')}>
              {copy.action}
            </button>
          )}
          {failure.kind === 'context' && (
            <button className="btn btn-primary" type="button" onClick={() => onFixSettings('advanced')}>
              {copy.action}
            </button>
          )}
        </div>
        {failure.detail && (
          <details style={{ marginTop: 'var(--space-3)' }}>
            <summary className="hint" style={{ cursor: 'pointer' }}>
              {failure.status ? `HTTP ${failure.status}` : t.details}
            </summary>
            <p className="hint" style={{ margin: '6px 0 0', wordBreak: 'break-word' }}>
              {failure.detail}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}

function Icon({ kind }: { kind: JobFailure['kind'] }) {
  if (kind === 'cors') return <BlockIcon />;
  if (kind === 'rate') return <ClockIcon />;
  if (kind === 'network') return <OfflineIcon />;
  return <AlertIcon />;
}
