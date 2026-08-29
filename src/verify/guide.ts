/** Surgical replace: `oldStr` must occur exactly once. */
export function editStyleGuideline(
  guide: string,
  oldStr: string,
  newStr: string,
): { ok: true; guide: string } | { ok: false; error: string } {
  if (!oldStr) return { ok: false, error: 'old_str is empty' };
  const count = guide.split(oldStr).length - 1;
  if (count === 0) return { ok: false, error: 'old_str was not found in the style guideline' };
  if (count > 1) {
    return {
      ok: false,
      error: `old_str matches ${count} times; make it a unique substring`,
    };
  }
  return { ok: true, guide: guide.replace(oldStr, newStr) };
}
