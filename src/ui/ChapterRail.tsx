import { useMemo } from 'react';
import type { Chunk } from '../ebook/types.ts';
import type { TranslatedPair } from '../job/types.ts';
import { useT } from '../i18n/index.ts';
import { CheckIcon, WarnIcon } from './icons.tsx';

type ChapterState = 'done' | 'kept' | 'running' | 'queued';

type Chapter = {
  title: string;
  first: number;
  count: number;
  doneCount: number;
  keptCount: number;
  state: ChapterState;
};

type Props = {
  chunks: Chunk[];
  translated: TranslatedPair[];
  liveIndex: number;
  currentIndex: number;
  onJump: (chunkIndex: number) => void;
};

export function ChapterRail({ chunks, translated, liveIndex, currentIndex, onJump }: Props) {
  const { t } = useT();

  const chapters = useMemo<Chapter[]>(() => {
    const byIndex = new Map(translated.map((p) => [p.index, p]));
    const out: Chapter[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const key = `${chunk.documentPath}::${chunk.chapterTitle}`;
      const last = out[out.length - 1];
      const pair = byIndex.get(i);
      if (last && last.title === key) {
        last.count += 1;
        if (pair) last.doneCount += 1;
        if (pair?.usedOriginal) last.keptCount += 1;
      } else {
        out.push({
          title: key,
          first: i,
          count: 1,
          doneCount: pair ? 1 : 0,
          keptCount: pair?.usedOriginal ? 1 : 0,
          state: 'queued',
        });
      }
    }
    for (const ch of out) {
      const end = ch.first + ch.count;
      if (liveIndex >= ch.first && liveIndex < end) ch.state = 'running';
      else if (ch.doneCount === ch.count) ch.state = ch.keptCount > 0 ? 'kept' : 'done';
      else if (ch.doneCount > 0) ch.state = 'running';
    }
    return out;
  }, [chunks, translated, liveIndex]);

  return (
    <nav className="rail" aria-label={t.chapters}>
      <div className="rail-head">
        <span>{t.chapters}</span>
        <span>{chapters.length}</span>
      </div>
      <ul className="rail-list">
        {chapters.map((ch) => {
          const current = currentIndex >= ch.first && currentIndex < ch.first + ch.count;
          const label = ch.title.split('::')[1] || ch.title;
          return (
            <li key={ch.title + ch.first}>
              <button
                type="button"
                className="rail-row"
                data-state={ch.state}
                aria-current={current}
                onClick={() => onJump(ch.first)}
              >
                <span className="rail-mark">
                  {ch.state === 'done' && <CheckIcon size={14} className="ok" />}
                  {ch.state === 'kept' && <WarnIcon size={14} className="warn" />}
                  {ch.state === 'running' && <span className="live" />}
                  {ch.state === 'queued' && <span className="queued" />}
                </span>
                <span className="name">{label}</span>
                <span className="count">
                  {ch.state === 'kept'
                    ? `${ch.count - ch.keptCount}/${ch.count}`
                    : ch.state === 'running'
                      ? `${ch.doneCount}/${ch.count}`
                      : ch.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
