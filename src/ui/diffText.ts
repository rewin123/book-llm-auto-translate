/** Word-level diff so the review pane can highlight what the review pass changed. */

export type DiffOp = { type: 'eq' | 'del' | 'ins'; text: string };

/** Private-use markers; swapped for `<del>`/`<ins>` after markdown is sanitized. */
export const DIFF_DEL_OPEN = '\uE000';
export const DIFF_DEL_CLOSE = '\uE001';
export const DIFF_INS_OPEN = '\uE002';
export const DIFF_INS_CLOSE = '\uE003';

export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function diffText(before: string, after: string): DiffOp[] {
  return mergeOps(diffTokens(tokenize(before), tokenize(after)));
}

/** Leading whitespace plus any markdown block prefix on a line. */
const BLOCK_PREFIX_RE = /^(\s*(?:#{1,6} |>+ ?|[-*+] |\d+\. ))/;

export function annotateDiff(ops: DiffOp[], side: 'before' | 'after'): string {
  let out = '';
  const mark = (text: string, open: string, close: string) => {
    // A marker placed before a line's `#` or `-` hides the block syntax from the
    // markdown pass, so the heading or list item renders as a plain paragraph.
    // Keep any block prefix outside the marked run.
    if (out === '' || out.endsWith('\n')) {
      const prefix = BLOCK_PREFIX_RE.exec(text)?.[1];
      if (prefix) {
        out += prefix + open + text.slice(prefix.length) + close;
        return;
      }
    }
    out += open + text + close;
  };
  for (const op of ops) {
    if (op.type === 'eq') out += op.text;
    else if (side === 'before' && op.type === 'del') mark(op.text, DIFF_DEL_OPEN, DIFF_DEL_CLOSE);
    else if (side === 'after' && op.type === 'ins') mark(op.text, DIFF_INS_OPEN, DIFF_INS_CLOSE);
  }
  return out;
}

const MARKER_TAGS: Record<string, string> = {
  [DIFF_DEL_OPEN]: '<del class="diff-del">',
  [DIFF_DEL_CLOSE]: '</del>',
  [DIFF_INS_OPEN]: '<ins class="diff-ins">',
  [DIFF_INS_CLOSE]: '</ins>',
};

/**
 * Swaps the markers for real tags, but only where a tag is allowed.
 *
 * A blind `replaceAll` over serialized HTML also hit markers that had landed
 * inside an attribute value — a link target holding a space is tokenized, so a
 * marker can end up mid-`href` — which terminated the attribute early and
 * mangled the anchor. Inside a tag the marker is simply dropped.
 */
export function applyDiffMarkers(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (inTag) {
      if (ch === '>') inTag = false;
      if (!MARKER_TAGS[ch]) out += ch;
      continue;
    }
    if (ch === '<') {
      inTag = true;
      out += ch;
      continue;
    }
    out += MARKER_TAGS[ch] ?? ch;
  }
  return out;
}

function diffTokens(a: string[], b: string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'eq', text: a[i]! });
  ops.push(...lcsDiff(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i++) ops.push({ type: 'eq', text: a[i]! });
  return ops;
}

/**
 * Token-pair ceiling for the LCS table.
 *
 * The table is `Uint16Array`, so an LCS longer than 65535 would wrap, and the
 * memory is O(n·m) — at the 20000-character chunk cap that is already ~22 MB per
 * call. Past this, fall back to reporting the differing span wholesale.
 */
const MAX_LCS_CELLS = 4_000_000;

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_LCS_CELLS || n > 0xffff || m > 0xffff) {
    const ops: DiffOp[] = [];
    if (n > 0) ops.push({ type: 'del', text: a.join('') });
    if (m > 0) ops.push({ type: 'ins', text: b.join('') });
    return ops;
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: 'eq', text: a[i - 1]! });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      out.push({ type: 'del', text: a[i - 1]! });
      i -= 1;
    } else {
      out.push({ type: 'ins', text: b[j - 1]! });
      j -= 1;
    }
  }
  while (i > 0) {
    i -= 1;
    out.push({ type: 'del', text: a[i]! });
  }
  while (j > 0) {
    j -= 1;
    out.push({ type: 'ins', text: b[j]! });
  }
  return out.reverse();
}

function mergeOps(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else out.push({ ...op });
  }
  return out;
}
