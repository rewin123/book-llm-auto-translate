import { stripHarnessMarkers } from '../llm/client.ts';
import { annotateDiff, applyDiffMarkers, diffText } from './diffText.ts';
import { markupToSafeHtml } from './sanitize.ts';

/**
 * Chunk to show while following live work.
 *
 * `liveIndex` is the first unfinished chunk (the in-flight one). The compare
 * pane stays one behind that pointer so it renders the last finished
 * translation, not the pending original. If that live slot is already
 * translated (review, or the job just completed), keep the live index.
 */
export function liveFollowIndex(
  liveIndex: number,
  translated: readonly { index: number }[],
  chunkCount: number,
): number {
  const max = Math.max(chunkCount - 1, 0);
  const live = Math.min(Math.max(liveIndex, 0), max);
  const liveReady = translated.some((p) => p.index === live);
  return liveReady ? live : Math.max(live - 1, 0);
}

/**
 * Markdown for the two compare panes. Always prefer the pair snapshot so a
 * later write to `chunk.markdown` cannot turn the original pane into the
 * translation (English vs English becoming Russian vs Russian).
 */
export function comparePaneMarkdown(
  chunk: { markdown: string },
  pair: { original: string; translation: string } | undefined,
): { original: string; translation: string; ready: boolean } {
  if (!pair) {
    return { original: chunk.markdown, translation: chunk.markdown, ready: false };
  }
  return {
    original: pair.original || chunk.markdown,
    translation: stripHarnessMarkers(pair.translation),
    ready: true,
  };
}

/**
 * Split-diff HTML for the review pane: original translation vs the review-pass rewrite.
 * `changed` is false when review has not touched this chunk yet.
 */
export function reviewDiffHtml(
  pair: { translation: string; preReview?: string },
): { before: string; after: string; changed: boolean } {
  const after = stripHarnessMarkers(pair.translation);
  const before = stripHarnessMarkers(pair.preReview ?? pair.translation);
  const ops = diffText(before, after);
  const changed = ops.some((op) => op.type !== 'eq');
  return {
    before: applyDiffMarkers(markupToSafeHtml(annotateDiff(ops, 'before'))),
    after: applyDiffMarkers(markupToSafeHtml(annotateDiff(ops, 'after'))),
    changed,
  };
}
