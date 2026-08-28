import JSZip from 'jszip';

/** 1×1 PNG */
export const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Dummy font bytes for round-trip tests */
export const TINY_FONT = new TextEncoder().encode('OTTO-FAKE-FONT');

const CH1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
<h1 id="c1">Down the Rabbit-Hole</h1>
<p>Alice was beginning to get very tired of sitting by her sister on the bank.</p>
<p>There was nothing so <em>very</em> remarkable in that; nor did Alice think it so <em>very</em> much out of the way.</p>
<p><img src="images/cover.png" alt="A tiny cover" id="cover-img"/></p>
</body>
</html>`;

const CH2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
<h1 id="c2">The Pool of Tears</h1>
<p>Curiouser and curiouser! cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English).</p>
<p>See <a href="chapter1.xhtml#c1">the first chapter</a>.</p>
</body>
</html>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Alice excerpt</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:booktrans:alice-excerpt</dc:identifier>
    <dc:creator>Lewis Carroll</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png"/>
    <item id="font" href="fonts/dummy.ttf" media-type="application/vnd.ms-opentype"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:booktrans:alice-excerpt"/></head>
  <docTitle><text>Alice excerpt</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Chapter 1</text></navLabel><content src="chapter1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>Chapter 2</text></navLabel><content src="chapter2.xhtml"/></navPoint>
  </navMap>
</ncx>`;

const CSS = `body { font-family: serif; } h1 { font-weight: bold; }`;

export async function buildDemoEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', OPF);
  zip.file('OEBPS/toc.ncx', NCX);
  zip.file('OEBPS/styles.css', CSS);
  zip.file('OEBPS/chapter1.xhtml', CH1);
  zip.file('OEBPS/chapter2.xhtml', CH2);
  zip.file('OEBPS/images/cover.png', TINY_PNG, { binary: true });
  zip.file('OEBPS/fonts/dummy.ttf', TINY_FONT, { binary: true });
  return zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  });
}

export function buildDemoFb2(encodingDecl = 'UTF-8'): string {
  const decl = `<?xml version="1.0" encoding="${encodingDecl}"` + '?>';
  return `${decl}
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>Alice excerpt</book-title>
      <lang>en</lang>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>Down the Rabbit-Hole</p></title>
      <p>Alice was beginning to get very tired of sitting by her sister on the bank.</p>
      <p>There was nothing so <emphasis>very</emphasis> remarkable in that.</p>
      <image l:href="#cover.png" xmlns:l="http://www.w3.org/1999/xlink"/>
    </section>
    <section>
      <title><p>The Pool of Tears</p></title>
      <p>Curiouser and curiouser! cried Alice.</p>
    </section>
  </body>
  <binary id="cover.png" content-type="image/png">${btoa(String.fromCharCode(...TINY_PNG))}</binary>
</FictionBook>`;
}

export function encodeWin1251Fb2(): Uint8Array {
  const xml =
    '<?xml version="1.0" encoding="windows-1251"?>\n' +
    '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">' +
    '<description><title-info><book-title>Тест</book-title><lang>ru</lang></title-info></description>' +
    '<body><section><p>Привет, мир. Андрей шёл по улице.</p></section></body>' +
    '</FictionBook>';
  const table: Record<string, number> = {};
  const chars =
    'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁё';
  const codes = [
    0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc,
    0xcd, 0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
    0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
    0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf2, 0xf3,
    0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff, 0xa8,
    0xb8,
  ];
  for (let i = 0; i < chars.length; i++) table[chars[i]!] = codes[i]!;
  const bytes: number[] = [];
  for (const ch of xml) {
    const code = ch.charCodeAt(0);
    if (code < 128) bytes.push(code);
    else if (table[ch] !== undefined) bytes.push(table[ch]!);
    else bytes.push(0x3f);
  }
  return Uint8Array.from(bytes);
}
