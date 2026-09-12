import { describe, expect, it } from 'vitest';
import { markupToSafeHtml } from '../../src/ui/sanitize.ts';

/**
 * The preview panes render book text and model output through
 * `dangerouslySetInnerHTML`, and this app keeps provider API keys in
 * localStorage — so script on its origin means key theft. This module had no
 * tests at all.
 */
describe('markupToSafeHtml link schemes', () => {
  const blocked: [string, string][] = [
    ['plain javascript:', '[x](javascript:alert(1))'],
    ['uppercase scheme', '[x](JaVaScRiPt:alert(1))'],
    ['leading spaces', '[x](   javascript:alert(1))'],
    ['tab inside the scheme', '[x](java\tscript:alert(1))'],
    ['newline inside the scheme', '[x](java\nscript:alert(1))'],
    ['carriage return inside the scheme', '[x](java\rscript:alert(1))'],
    ['a leading C0 control', '[x](\x01javascript:alert(1))'],
    ['a NUL inside the scheme', '[x](java\x00script:alert(1))'],
    ['DEL inside the scheme', '[x](java\x7Fscript:alert(1))'],
    ['vbscript', '[x](vbscript:msgbox(1))'],
    ['a data URL', '[x](data:text/html;base64,PHN2Zz4=)'],
    ['an unknown scheme', '[x](chrome://settings)'],
    ['a protocol-relative target', '[x](//evil.example/)'],
  ];

  for (const [label, md] of blocked) {
    it(`drops the href for ${label}`, () => {
      const out = markupToSafeHtml(md);
      expect(out).not.toMatch(/href=/);
      // The visible text is still shown; only the target is dropped.
      expect(out).toContain('x');
    });
  }

  const allowed: [string, string, string][] = [
    ['http', '[x](http://example.com/p)', 'http://example.com/p'],
    ['https', '[x](https://example.com/p)', 'https://example.com/p'],
    ['mailto', '[x](mailto:a@example.com)', 'mailto:a@example.com'],
    ['a fragment', '[x](#section)', '#section'],
  ];

  for (const [label, md, href] of allowed) {
    it(`keeps ${label}`, () => {
      expect(markupToSafeHtml(md)).toContain(`href="${href}"`);
    });
  }

  it('marks external links noopener noreferrer', () => {
    expect(markupToSafeHtml('[x](https://example.com/)')).toContain('rel="noopener noreferrer"');
  });
});

describe('markupToSafeHtml element and attribute filtering', () => {
  const inert: [string, string][] = [
    ['a script tag', '<script>alert(1)</script>'],
    ['an img onerror handler', '<img src="http://x/y.png" onerror="alert(1)"/>'],
    ['an svg onload handler', '<svg onload="alert(1)"></svg>'],
    ['an iframe', '<iframe src="http://evil.example"></iframe>'],
    ['an inline style', '<div style="background:url(javascript:alert(1))">x</div>'],
    ['an object tag', '<object data="http://evil.example"></object>'],
  ];

  for (const [label, md] of inert) {
    it(`renders ${label} inert`, () => {
      // Assert on the parsed result, not the serialized string: raw HTML in a
      // book arrives escaped as text, where the word "onerror" is harmless.
      const host = new DOMParser().parseFromString(
        `<body>${markupToSafeHtml(md)}</body>`,
        'text/html',
      ).body;
      expect(host.querySelector('script,svg,iframe,object,embed,style')).toBeNull();
      for (const el of Array.from(host.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.toLowerCase()).not.toMatch(/^on/);
          expect(attr.name.toLowerCase()).not.toBe('style');
        }
      }
    });
  }

  it('keeps ordinary formatting', () => {
    const out = markupToSafeHtml('A *word* and **bold** text\n\n# Heading');
    expect(out).toContain('<em>word</em>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('Heading');
  });

  it('does not emit a javascript: image source', () => {
    expect(markupToSafeHtml('![a](javascript:alert(1))')).not.toMatch(/src=/);
  });
});
