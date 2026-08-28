import { describe, expect, it } from 'vitest';
import { parseXml, findEl } from '../../src/ebook/xml.ts';
import {
  collectImageSrcs,
  htmlToMarkdown,
  joinMarkdown,
  markdownToPlainText,
  markdownToXhtmlFragment,
  reverseMarkdownText,
  splitMarkdownIntoChapters,
} from '../../src/ebook/markdown.ts';

describe('htmlToMarkdown', () => {
  it('turns headings, emphasis, links and images into markdown', () => {
    const doc = parseXml(`<body xmlns="http://www.w3.org/1999/xhtml">
      <h1>Down the Rabbit-Hole</h1>
      <p>Alice was beginning to get <em>very</em> tired.</p>
      <p>See <a href="chapter1.xhtml#c1">the first chapter</a>.</p>
      <p><img src="images/cover.png" alt="A tiny cover"/></p>
    </body>`);
    const md = htmlToMarkdown(doc.documentElement);
    expect(md).toContain('# Down the Rabbit-Hole');
    expect(md).toContain('*very*');
    expect(md).toContain('[the first chapter](chapter1.xhtml#c1)');
    expect(md).toContain('![A tiny cover](images/cover.png)');
    expect(collectImageSrcs(md)).toEqual(['images/cover.png']);
  });
});

describe('markdownToXhtmlFragment', () => {
  it('round-trips common book markup', () => {
    const md = `# Title

Alice was *very* tired.

![cover](images/cover.png)
`;
    const xhtml = markdownToXhtmlFragment(md);
    expect(xhtml).toContain('<h1>Title</h1>');
    expect(xhtml).toContain('<em>very</em>');
    expect(xhtml).toContain('<img alt="cover" src="images/cover.png"/>');
    const doc = parseXml(`<div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div>`);
    expect(findEl(doc, 'h1')?.textContent).toBe('Title');
  });
});

describe('reverseMarkdownText', () => {
  it('reverses words but keeps image paths and headings', () => {
    const src = '# Alice\n\nHello ![alt](images/cover.png)\n';
    const out = reverseMarkdownText(src);
    expect(out).toContain('# ');
    expect(out).toContain('ecilA');
    expect(out).toContain('](images/cover.png)');
    expect(markdownToPlainText(out)).toContain('ecilA');
  });
});

describe('splitMarkdownIntoChapters', () => {
  it('splits a long markdown on ATX headings', () => {
    const md = joinMarkdown(['# One\n\nAAA', '# Two\n\nBBB']);
    const chapters = splitMarkdownIntoChapters(md);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe('One');
    expect(chapters[1]?.body).toContain('BBB');
  });
});
