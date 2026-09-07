/** Word-level diff so the review pane can highlight what the seam pass changed. */

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

export function annotateDiff(ops: DiffOp[], side: 'before' | 'after'): string {
  let out = '';
  for (const op of ops) {
    if (op.type === 'eq') out += op.text;
    else if (side === 'before' && op.type === 'del') out += DIFF_DEL_OPEN + op.text + DIFF_DEL_CLOSE;
    else if (side === 'after' && op.type === 'ins') out += DIFF_INS_OPEN + op.text + DIFF_INS_CLOSE;
  }
  return out;
}

export function applyDiffMarkers(html: string): string {
  return html
    .replaceAll(DIFF_DEL_OPEN, '<del class="diff-del">')
    .replaceAll(DIFF_DEL_CLOSE, '</del>')
    .replaceAll(DIFF_INS_OPEN, '<ins class="diff-ins">')
    .replaceAll(DIFF_INS_CLOSE, '</ins>');
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

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
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
