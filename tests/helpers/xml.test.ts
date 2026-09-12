import { describe, expect, it } from 'vitest';
import { xmlWellFormedError } from './xml.ts';

// The rest of the suite trusts this checker to catch what happy-dom waves
// through, so it gets its own tests.
describe('xmlWellFormedError', () => {
  const wellFormed = [
    '<p>hello</p>',
    '<p>a &amp; b</p>',
    '<br/>',
    '<p><em>x</em> y</p>',
    '<img alt="a" src="images/x.png"/>',
    '<p>a &#9; b</p>',
    '<p>&#x41;</p>',
    '<p>a \u{1F600} b</p>',
    '<a href="http://e.com/?a=1&amp;b=2">x</a>',
    '<!-- c --><p>x</p>',
    '<p><![CDATA[x<y]]></p>',
    '<p>text</p><p>more</p>',
    '<p>tab\there</p>',
  ];
  for (const fragment of wellFormed) {
    it(`accepts ${JSON.stringify(fragment)}`, () => {
      expect(xmlWellFormedError(fragment)).toBeNull();
    });
  }

  const malformed: [string, string][] = [
    ['bare <', '<p>a < b</p>'],
    ['bare &', '<p>a & b</p>'],
    ['unclosed tag', '<p>unclosed'],
    ['crossed tags', '<p><em>x</p></em>'],
    ['tag inside attribute', '<a href="java<br/>script:x">t</a>'],
    ['vertical tab', '<p>a \x0B b</p>'],
    ['NUL', '<p>a \x00 b</p>'],
    ['unit separator', '<p>a \x1F b</p>'],
    ['lone high surrogate', '<p>a \uD800 b</p>'],
    ['lone low surrogate', '<p>a \uDC00 b</p>'],
    ['interleaved emphasis', '<strong>bold <em>and</em></strong></em>'],
    ['unquoted attribute', '<p class=x>y</p>'],
    ['mismatched close', '<p></div>'],
    ['duplicate attribute', '<img alt="a" alt="b"/>'],
  ];
  for (const [label, fragment] of malformed) {
    it(`rejects ${label}`, () => {
      expect(xmlWellFormedError(fragment)).toBeTruthy();
    });
  }
});
