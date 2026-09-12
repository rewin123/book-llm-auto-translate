/**
 * A strict XML 1.0 well-formedness check.
 *
 * happy-dom's `DOMParser` accepts markup that real XML parsers reject — control
 * characters, lone surrogates and a `<` inside an attribute value all pass — so
 * relying on it hides exactly the bugs that make a generated EPUB unopenable.
 * This scanner is deliberately strict and has no DOM dependency.
 */

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
const REFERENCE = /^&(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z_:][-A-Za-z0-9_:.]*);/;

/** XML 1.0 forbids most C0 controls, lone surrogates and U+FFFE/U+FFFF. */
function illegalCharAt(s: string, i: number): string | null {
  const code = s.charCodeAt(i);
  if (code === 0x9 || code === 0xa || code === 0xd) return null;
  if (code < 0x20) return `control character U+${code.toString(16).padStart(4, '0').toUpperCase()}`;
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = s.charCodeAt(i + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return 'unpaired high surrogate';
    return null;
  }
  if (code >= 0xdc00 && code <= 0xdfff) return 'unpaired low surrogate';
  if (code === 0xfffe || code === 0xffff) return `U+${code.toString(16).toUpperCase()}`;
  return null;
}

function scanName(s: string, start: number): number {
  if (start >= s.length || !NAME_START.test(s[start]!)) return -1;
  let i = start + 1;
  while (i < s.length && NAME_CHAR.test(s[i]!)) i += 1;
  return i;
}

/**
 * Returns a human-readable reason the markup is not well-formed, or `null` when
 * it is. `fragment` may hold several sibling nodes; it does not need one root.
 */
export function xmlWellFormedError(fragment: string): string | null {
  for (let i = 0; i < fragment.length; i += 1) {
    const bad = illegalCharAt(fragment, i);
    if (bad) return `illegal XML character at ${i}: ${bad}`;
    const code = fragment.charCodeAt(i);
    // A valid pair was just accepted as a whole; don't re-test its low half.
    if (code >= 0xd800 && code <= 0xdbff) i += 1;
  }

  const open: string[] = [];
  let i = 0;
  while (i < fragment.length) {
    const ch = fragment[i]!;

    if (ch === '&') {
      const rest = fragment.slice(i);
      if (!REFERENCE.test(rest)) return `bare '&' at ${i} (not an entity reference)`;
      i += REFERENCE.exec(rest)![0].length;
      continue;
    }

    if (ch !== '<') {
      i += 1;
      continue;
    }

    if (fragment.startsWith('<!--', i)) {
      const end = fragment.indexOf('-->', i + 4);
      if (end === -1) return `unterminated comment at ${i}`;
      if (fragment.slice(i + 4, end).includes('--')) return `'--' inside comment at ${i}`;
      i = end + 3;
      continue;
    }
    if (fragment.startsWith('<![CDATA[', i)) {
      const end = fragment.indexOf(']]>', i + 9);
      if (end === -1) return `unterminated CDATA at ${i}`;
      i = end + 3;
      continue;
    }
    if (fragment.startsWith('<?', i)) {
      const end = fragment.indexOf('?>', i + 2);
      if (end === -1) return `unterminated processing instruction at ${i}`;
      i = end + 2;
      continue;
    }
    if (fragment.startsWith('<!', i)) {
      const end = fragment.indexOf('>', i + 2);
      if (end === -1) return `unterminated declaration at ${i}`;
      i = end + 1;
      continue;
    }

    // Closing tag.
    if (fragment[i + 1] === '/') {
      const nameEnd = scanName(fragment, i + 2);
      if (nameEnd === -1) return `malformed closing tag at ${i}`;
      const name = fragment.slice(i + 2, nameEnd);
      let j = nameEnd;
      while (j < fragment.length && /\s/.test(fragment[j]!)) j += 1;
      if (fragment[j] !== '>') return `malformed closing tag </${name}> at ${i}`;
      const expected = open.pop();
      if (expected === undefined) return `unexpected closing tag </${name}> at ${i}`;
      if (expected !== name) return `closing </${name}> does not match open <${expected}> at ${i}`;
      i = j + 1;
      continue;
    }

    // Opening tag.
    const nameEnd = scanName(fragment, i + 1);
    if (nameEnd === -1) return `bare '<' or malformed tag name at ${i}`;
    const name = fragment.slice(i + 1, nameEnd);
    let j = nameEnd;
    const seen = new Set<string>();
    for (;;) {
      while (j < fragment.length && /\s/.test(fragment[j]!)) j += 1;
      if (j >= fragment.length) return `unterminated tag <${name}> at ${i}`;
      if (fragment[j] === '>') {
        open.push(name);
        j += 1;
        break;
      }
      if (fragment.startsWith('/>', j)) {
        j += 2;
        break;
      }
      const attrEnd = scanName(fragment, j);
      if (attrEnd === -1) return `malformed attribute in <${name}> at ${j}`;
      const attr = fragment.slice(j, attrEnd);
      if (seen.has(attr)) return `duplicate attribute ${attr} in <${name}> at ${j}`;
      seen.add(attr);
      j = attrEnd;
      while (j < fragment.length && /\s/.test(fragment[j]!)) j += 1;
      if (fragment[j] !== '=') return `attribute ${attr} in <${name}> has no value at ${j}`;
      j += 1;
      while (j < fragment.length && /\s/.test(fragment[j]!)) j += 1;
      const quote = fragment[j];
      if (quote !== '"' && quote !== "'") return `attribute ${attr} in <${name}> is not quoted at ${j}`;
      const close = fragment.indexOf(quote, j + 1);
      if (close === -1) return `unterminated value for ${attr} in <${name}> at ${j}`;
      const value = fragment.slice(j + 1, close);
      if (value.includes('<')) return `'<' inside attribute ${attr} of <${name}> at ${j}`;
      for (let k = 0; k < value.length; k += 1) {
        if (value[k] !== '&') continue;
        if (!REFERENCE.test(value.slice(k))) {
          return `bare '&' inside attribute ${attr} of <${name}> at ${j + 1 + k}`;
        }
      }
      j = close + 1;
    }
    i = j;
  }

  if (open.length > 0) return `unclosed tag <${open[open.length - 1]}>`;
  return null;
}

/** Throws with the reason when `fragment` is not well-formed XML. */
export function assertWellFormedXml(fragment: string, label = 'fragment'): void {
  const err = xmlWellFormedError(fragment);
  if (err) throw new Error(`${label} is not well-formed XML: ${err}\n${fragment}`);
}
