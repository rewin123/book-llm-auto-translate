import { Fragment } from 'react';
import type { Locale, Theme } from '../storage/prefs.ts';
import { useT } from '../i18n/index.ts';
import { MoonIcon, SunIcon, CheckIcon, GithubIcon } from './icons.tsx';

export type Step = 'book' | 'settings' | 'brief' | 'glossary' | 'run';

const GITHUB_URL = 'https://github.com/rewin123/book-llm-auto-translate';

export function AppHeader(props: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  compact?: boolean;
}) {
  const { t } = useT();
  return (
    <header className="app-header">
      <div className="brand">
        <h1 style={props.compact ? { fontSize: 'var(--text-xl)' } : undefined}>{t.appName}</h1>
        {!props.compact && <p>{t.tagline}</p>}
      </div>
      <div className="header-tools">
        <a
          className="icon-btn"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          title={t.github}
          aria-label={t.github}
        >
          <GithubIcon />
        </a>
        <div className="segmented" role="group" aria-label="Language">
          <button
            type="button"
            aria-pressed={props.locale === 'en'}
            onClick={() => props.setLocale('en')}
          >
            EN
          </button>
          <button
            type="button"
            aria-pressed={props.locale === 'ru'}
            onClick={() => props.setLocale('ru')}
          >
            RU
          </button>
        </div>
        <button
          className="icon-btn"
          type="button"
          title={props.theme === 'light' ? t.themeDark : t.themeLight}
          aria-label={props.theme === 'light' ? t.themeDark : t.themeLight}
          onClick={() => props.setTheme(props.theme === 'light' ? 'dark' : 'light')}
        >
          {props.theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </header>
  );
}

export function Stepper({ current }: { current: Step }) {
  const { t } = useT();
  const steps: { id: Step; label: string }[] = [
    { id: 'book', label: t.stepBook },
    { id: 'settings', label: t.stepSettings },
    { id: 'brief', label: t.stepStyle },
    { id: 'glossary', label: t.stepGlossary },
    { id: 'run', label: t.stepTranslate },
  ];
  const currentAt = steps.findIndex((s) => s.id === current);

  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span className="bar" aria-hidden="true" />}
          <li
            data-state={i < currentAt ? 'done' : i === currentAt ? 'current' : 'todo'}
            aria-current={i === currentAt ? 'step' : undefined}
          >
            <span className="dot">{i < currentAt ? <CheckIcon size={13} /> : i + 1}</span>
            <span>{s.label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
