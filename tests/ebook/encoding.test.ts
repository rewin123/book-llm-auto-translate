import { describe, expect, it } from 'vitest';
import { encodeWin1251Fb2 } from '../../src/ebook/demoBook.ts';
import { encodingFromXmlDeclaration, decodeXmlBytes } from '../../src/ebook/encoding.ts';
import { parseFb2 } from '../../src/ebook/fb2.ts';

describe('FB2 encodings', () => {
  it('detects windows-1251 from the XML declaration', () => {
    const bytes = encodeWin1251Fb2();
    expect(encodingFromXmlDeclaration(bytes)).toBe('windows-1251');
    const text = decodeXmlBytes(bytes);
    expect(text).toContain('Привет');
    expect(text).toContain('Андрей');
  });

  it('parses windows-1251 books into readable chunks', () => {
    const parsed = parseFb2(encodeWin1251Fb2(), 'test.fb2', 2000);
    const blob = parsed.chunks.map((c) => c.markdown).join('');
    expect(blob).toContain('Привет');
    expect(parsed.title).toBe('Тест');
  });
});
