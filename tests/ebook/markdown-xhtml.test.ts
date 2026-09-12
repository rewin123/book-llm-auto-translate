import { describe, expect, it } from 'vitest';
import {
  chapterNavTitle,
  htmlToMarkdown,
  joinMarkdown,
  markdownToXhtmlFragment,
  splitMarkdownIntoChapters,
} from '../../src/ebook/markdown.ts';
import { assertWellFormedXml, xmlWellFormedError } from '../helpers/xml.ts';

function body(html: string): Element {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body;
}

/**
 * EPUB content documents must parse as XML, so a chapter that is not well-formed
 * costs the reader the chapter — and for strict readers the whole book. Each
 * input below produced invalid markup before.
 */
describe('markdownToXhtmlFragment well-formedness', () => {
  const cases: [string, string][] = [
    ['a newline inside a link target', 'a [t](http://x/\ny) b'],
    ['a newline inside an image source', 'a ![t](images/a\nb.png) c'],
    ['overlapping asterisk emphasis', '**bold *and italic** more*'],
    ['overlapping underscore emphasis', '__x _y__ z_'],
    ['a NUL in the text', 'a \x00 b'],
    ['a vertical tab in the text', 'a \x0B b'],
    ['a unit separator in the text', 'a \x1F b'],
    ['an unpaired high surrogate', 'a \uD800 b'],
    ['an unpaired low surrogate', 'a \uDC00 b'],
    ['an emoji', 'a \u{1F600} b'],
    ['a bare ampersand', 'Smith & Sons'],
    ['a bare angle bracket', '5 < 7 and 9 > 2'],
  ];
  for (const [label, md] of cases) {
    it(`survives ${label}`, () => {
      assertWellFormedXml(markdownToXhtmlFragment(md));
    });
  }

  it('keeps an emoji intact rather than stripping it', () => {
    expect(markdownToXhtmlFragment('a \u{1F600} b')).toContain('\u{1F600}');
  });
});

describe('markdownToXhtmlFragment fidelity', () => {
  it('leaves literal placeholder-looking text alone', () => {
    const out = markdownToXhtmlFragment('Pressure %%BT9%% drop');
    expect(out).toContain('%%BT9%%');
    expect(out).not.toContain('undefined');
  });

  it('does not duplicate an image when the text holds a placeholder', () => {
    const out = markdownToXhtmlFragment('![a](x.png) and %%BT0%% here');
    expect(out.match(/<img/g)).toHaveLength(1);
  });

  it('keeps link and image syntax inside a code span as text', () => {
    expect(markdownToXhtmlFragment('`![a](b)`')).toContain('<code>![a](b)</code>');
    expect(markdownToXhtmlFragment('`[x](y)`')).toContain('<code>[x](y)</code>');
  });

  it('does not emphasise an intra-word underscore', () => {
    expect(markdownToXhtmlFragment('use my_var_name here')).toContain('my_var_name');
  });

  it('does not emphasise an asterisk used as multiplication', () => {
    expect(markdownToXhtmlFragment('2 * 3 * 4 = 24')).toContain('2 * 3 * 4 = 24');
  });

  it('keeps balanced parentheses inside a URL', () => {
    expect(markdownToXhtmlFragment('[x](http://e.com/a(b).png)')).toContain(
      'href="http://e.com/a(b).png"',
    );
  });

  it('still renders real emphasis, strong and soft breaks', () => {
    expect(markdownToXhtmlFragment('a *real* one')).toContain('<em>real</em>');
    expect(markdownToXhtmlFragment('a **bold** one')).toContain('<strong>bold</strong>');
    expect(markdownToXhtmlFragment('line1\nline2')).toContain('<br/>');
  });

  it('nests emphasis instead of interleaving it', () => {
    expect(markdownToXhtmlFragment('***both***')).toContain('<strong><em>both</em></strong>');
  });
});

/**
 * Many books lay out prose with `<div class="para">` rather than `<p>`. Walking
 * such a container's children as blocks turned one sentence into several
 * one-word paragraphs and dropped the inline markup.
 */
describe('htmlToMarkdown container handling', () => {
  it('keeps a div of inline content as one paragraph', () => {
    expect(htmlToMarkdown(body('<div>He said <b>no</b>, loudly.</div>')).trim()).toBe(
      'He said **no**, loudly.',
    );
  });

  it('keeps bare inline content at the root as one paragraph', () => {
    expect(htmlToMarkdown(body('Hello <em>world</em>!')).trim()).toBe('Hello *world*!');
  });

  it('keeps an inline blockquote on one line', () => {
    expect(htmlToMarkdown(body('<blockquote>q <i>it</i> z</blockquote>')).trim()).toBe('> q *it* z');
  });

  it('still splits a container that holds real blocks', () => {
    expect(htmlToMarkdown(body('<div><p>one</p><p>two</p></div>')).trim()).toBe('one\n\ntwo');
  });

  it('keeps a nested list that is a direct child of a list', () => {
    expect(htmlToMarkdown(body('<ul><li>a</li><ul><li>b</li></ul></ul>'))).toContain('b');
  });

  it('keeps a table row on one line when a cell holds a break', () => {
    const md = htmlToMarkdown(body('<table><tr><td>a<br/>b</td><td>c</td></tr></table>'));
    expect(md.split('\n')[0]).toBe('| a b | c |');
  });
});

describe('chapter labels and seams', () => {
  it('slices a nav title by code point, not code unit', () => {
    const title = chapterNavTitle({ title: '', body: 'x'.repeat(47) + '\u{1F600}tail' });
    expect(xmlWellFormedError(`<t>${title}</t>`)).toBeNull();
  });

  it('does not treat a heading inside a fence as a chapter', () => {
    const chapters = splitMarkdownIntoChapters('Intro\n\n```\n# not heading\ncode\n```\n\ntail');
    expect(chapters).toHaveLength(1);
  });

  it('still splits on real headings', () => {
    const chapters = splitMarkdownIntoChapters('# One\n\nAAA\n\n# Two\n\nBBB');
    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two']);
  });

  it('rejoins a mid-sentence seam with a space, not a blank line', () => {
    const joined = joinMarkdown(['первая половина', 'вторая половина'], [undefined, 'space']);
    expect(joined.trim()).toBe('первая половина вторая половина');
  });

  it('rejoins a soft line break as a line break', () => {
    expect(joinMarkdown(['— Да, — сказал он.', '— Нет, — сказала она.'], [undefined, 'line']).trim()).toBe(
      '— Да, — сказал он.\n— Нет, — сказала она.',
    );
  });

  it('still separates real blocks with a blank line', () => {
    expect(joinMarkdown(['one', 'two'], [undefined, undefined]).trim()).toBe('one\n\ntwo');
  });
});
