import { stripHarnessMarkers } from '../llm/client.ts';

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
