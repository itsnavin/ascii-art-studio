import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONTS } from '../src/fonts.js';
import { TEMPLATES } from '../src/templates.js';
import { LIMITS, PALETTES, RENDER, validatePalette, getPalette, normalizeArt, renderBanner, renderTemplate, dimensions, imageDimensions, pixelsToAscii, exportGeometry } from '../src/core.js';
import { inspectImage } from '../src/image.js';

const pixels = (...colors) => new Uint8ClampedArray(colors.flat());
const pngHeader = (width, height) => {
  const buffer = new ArrayBuffer(33);
  const bytes = new Uint8Array(buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buffer;
};

for (const [name, font] of Object.entries(FONTS)) {
  test(`${name}: original font has rectangular binary glyphs and full declared coverage`, () => {
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!? :-+/'()") {
      assert.ok(font.glyphs[char], char);
    }
    for (const rows of Object.values(font.glyphs)) {
      assert.equal(rows.length, font.height);
      rows.forEach(row => {
        assert.equal(row.length, font.width);
        assert.match(row, /^[01]+$/);
      });
    }
  });
  test(`${name}: banner layout, spacing and lowercase are deterministic`, () => {
    const text = renderBanner('a b\nC', name, PALETTES.classic);
    const size = dimensions(text);
    assert.equal(size.columns, 3 * (font.width + 1) - 1);
    assert.equal(size.rows, font.height * 2 + 1);
    assert.ok(text.split('\n').every(line => line.length === size.columns));
    assert.equal(text, renderBanner('A B\nC', name, PALETTES.classic));
    assert.match(text, /^[\x20-\x7e\n]+$/);
    assert.equal(text.split('\n')[font.height], ' '.repeat(size.columns));
  });
  test(`${name}: every banner glyph draws and spaces stay empty`, () => {
    for (const char of Object.keys(font.glyphs).filter(char => char !== ' ')) {
      assert.ok(renderBanner(char, name, PALETTES.numbers).trim(), char);
    }
    assert.equal(renderBanner('  \n ', name, PALETTES.classic), '');
  });
}

test('banner rejects Unicode before case normalization, unsupported ASCII, long lines and excess lines', () => {
  for (const text of ['hi \u{1f600}', '\u00e9', '\u017f', '@', '<', 'x'.repeat(29), '1\n2\n3\n4\n5']) {
    assert.throws(() => renderBanner(text, 'block', PALETTES.classic));
  }
  assert.throws(() => renderBanner('HI', 'fake', PALETTES.classic));
  assert.ok(renderBanner('X'.repeat(28), 'block', PALETTES.classic));
});

test('banners use dense strokes while preserving palette membership', () => {
  assert.match(renderBanner('HELLO', 'block', PALETTES.classic), /^[#%@ \n]+$/);
  assert.match(renderBanner('HI', 'block', '01'), /^[01 \n]+$/);
});

test('normalization preserves trailing whitespace and newlines; expands tabs explicitly', () => {
  assert.equal(normalizeArt(' a \r\nb\t\r'), ' a \nb    \n');
  for (const invalid of ['\0', '\x1b', '\x7f', '\u2665', '\u{1f600}']) assert.throws(() => normalizeArt(invalid), /ASCII/);
});

test('palettes are unique printable ASCII; custom limits and errors are explicit', () => {
  for (const value of Object.values(PALETTES)) assert.equal(validatePalette(value), value);
  assert.equal(validatePalette(' .@'), ' .@');
  assert.equal(validatePalette('01'), '01');
  for (const value of ['', 'x', 'xx', 'a\n', 'a\t', 'a\u00e9', 'a'.repeat(65)]) assert.throws(() => validatePalette(value));
  assert.equal(getPalette('custom', 'ab'), 'ab');
  assert.throws(() => getPalette('unknown'));
});

for (const name of ['alphabet', 'numbers']) {
  test(`${name}: all modes contain only allowed characters plus spaces and line breaks`, () => {
    const palette = PALETTES[name];
    const pattern = name === 'alphabet' ? /^[A-Za-z \n]+$/ : /^[0-9 \n]+$/;
    assert.match(renderBanner('HI 42!', 'block', palette), pattern);
    for (const template of TEMPLATES) assert.match(renderTemplate(template.art, name, palette), pattern);
    const data = Uint8ClampedArray.from({ length: 800 }, (_, i) => i % 4 === 3 ? 255 : i % 256);
    assert.match(pixelsToAscii(data, 20, 10, palette), pattern);
  });
}

test('all original templates are valid, unique, editable and deterministic', () => {
  assert.equal(new Set(TEMPLATES.map(template => template.art)).size, TEMPLATES.length);
  assert.ok(TEMPLATES.length >= 8);
  for (const template of TEMPLATES) {
    assert.match(template.art, /^[\x20-\x7e\n]+$/);
    assert.equal(renderTemplate(template.art, 'classic', PALETTES.classic), template.art);
    assert.equal(renderTemplate(template.art, 'custom', '01'), renderTemplate(template.art, 'custom', '01'));
  }
  assert.equal(renderTemplate('<script>  \n\\/', 'classic', PALETTES.classic), '<script>  \n\\/');
  assert.throws(() => renderTemplate('x'.repeat(241), 'classic', PALETTES.classic));
  assert.throws(() => renderTemplate('\n'.repeat(120), 'classic', PALETTES.classic));
});

test('black/white luminance endpoints, alpha compositing, invert and brightness', () => {
  const data = pixels([0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 0]);
  assert.equal(pixelsToAscii(data, 3, 1, ' .#'), '#  ');
  assert.equal(pixelsToAscii(data, 3, 1, ' .#', { invert: true }), ' ##');
  assert.equal(pixelsToAscii(data, 3, 1, ' .#', { brightness: 100 }), '   ');
  assert.equal(pixelsToAscii(data, 3, 1, ' .#', { brightness: -100 }), '###');
  assert.equal(pixelsToAscii(pixels([255, 0, 0, 255], [0, 255, 0, 255]), 2, 1, ' .#'), '#.');
});

test('contrast clamps rather than wraps and buffers/options are bounded', () => {
  assert.equal(pixelsToAscii(pixels([0, 0, 0, 255], [255, 255, 255, 255]), 2, 1, ' .#', { contrast: 3 }), '# ');
  for (const options of [{ contrast: NaN }, { contrast: 4 }, { brightness: Infinity }, { brightness: 101 }]) {
    assert.throws(() => pixelsToAscii(pixels([0, 0, 0, 255]), 1, 1, '01', options));
  }
  assert.throws(() => pixelsToAscii(new Uint8Array(4), 240, 360, '01'));
  assert.throws(() => pixelsToAscii(new Uint8Array(4), 0, 1, '01'));
});

test('image proportions account for the actual monospaced cell aspect', () => {
  assert.deepEqual(imageDimensions(800, 400, 100), { columns: 100, rows: 25, limited: false });
  assert.deepEqual(imageDimensions(100, 100, 100), { columns: 100, rows: 50, limited: false });
  const size = imageDimensions(100, 200, 100, 0.6);
  assert.equal(size.rows, 120);
});

test('all output sizes remain within row/cell caps across extreme source shapes', () => {
  for (const [width, height] of [[1, 12000], [12000, 1], [100, 12000], [12000, 100], [4000, 6000], [6000, 4000], [1, 1]]) {
    for (const columns of [20, 100, 240]) {
      const size = imageDimensions(width, height, columns);
      assert.ok(size.columns >= 1 && size.columns <= columns);
      assert.ok(size.rows >= 1 && size.rows <= LIMITS.rows);
      assert.ok(size.rows * size.columns <= LIMITS.cells);
      if (size.columns > 1 && size.rows > 1) assert.ok(Math.abs(size.rows - height / width * size.columns * 0.5) <= 0.5);
    }
  }
});

test('image dimensions reject unsafe values and requested detail', () => {
  for (const [width, height, columns] of [[0, 1, 20], [-1, 1, 20], [NaN, 1, 20], [12001, 2, 20], [6000, 6000, 20], [1.5, 2, 20], [1, 2, 241], [1, 2, 19], [1, 2, 20.5]]) {
    assert.throws(() => imageDimensions(width, height, columns));
  }
  assert.throws(() => imageDimensions(100, 100, 20, 0));
});

test('PNG geometry includes padding, full whitespace and explicit area/side bounds', () => {
  assert.deepEqual(exportGeometry('ab  \nx', 10), { width: 72, height: 72, lineHeight: 12, cellWidth: 6 });
  assert.equal(exportGeometry('a\n', 14).height, Math.ceil(2 * 14 * RENDER.lineHeightRatio + 48));
  assert.throws(() => exportGeometry('x'.repeat(1000), 24), /too large/);
  assert.throws(() => exportGeometry(('x'.repeat(240) + '\n').repeat(360), 24), /too large/);
  assert.throws(() => exportGeometry('x', 0));
});

test('PNG header dimensions checked before decoder, including allocation bombs', () => {
  assert.deepEqual(inspectImage(pngHeader(100, 50), 'image/png'), { width: 100, height: 50 });
  assert.throws(() => inspectImage(pngHeader(12001, 1), 'image/png'), /too large/);
  assert.throws(() => inspectImage(pngHeader(6000, 6000), 'image/png'), /too large/);
  assert.throws(() => inspectImage(pngHeader(0, 1), 'image/png'), /header/);
  assert.throws(() => inspectImage(pngHeader(1, 1), 'image/jpeg'), /header/);
  assert.throws(() => inspectImage(new ArrayBuffer(0), 'image/png'));
  assert.throws(() => inspectImage(new ArrayBuffer(LIMITS.fileBytes + 1), 'image/png'));
  assert.throws(() => inspectImage(new ArrayBuffer(100), 'image/svg+xml'), /supported/);
});

test('JPEG header parser handles metadata, progressive SOF and truncated segments', () => {
  const jpeg = new Uint8Array([255,216, 255,225,0,4,0,0, 255,194,0,8,8,0,40,0,80,0]);
  assert.deepEqual(inspectImage(jpeg.buffer, 'image/jpeg'), { width: 80, height: 40 });
  assert.throws(() => inspectImage(jpeg.slice(0, 12).buffer, 'image/jpeg'), /header/);
});

for (const kind of ['VP8X', 'VP8 ', 'VP8L']) {
  test(`WebP ${kind} dimensions parsed safely`, () => {
    const length = kind === 'VP8L' ? 6 : 10;
    const bytes = new Uint8Array(20 + length);
    const view = new DataView(bytes.buffer);
    bytes.set([...('RIFF')].map(c => c.charCodeAt(0)));
    view.setUint32(4, bytes.length - 8, true);
    bytes.set([...('WEBP' + kind)].map(c => c.charCodeAt(0)), 8);
    view.setUint32(16, length, true);
    if (kind === 'VP8X') {
      bytes[24] = 79;
      bytes[27] = 39;
    } else if (kind === 'VP8 ') {
      bytes.set([0x9d, 0x01, 0x2a], 23);
      view.setUint16(26, 80, true);
      view.setUint16(28, 40, true);
    } else {
      bytes[20] = 0x2f;
      view.setUint32(21, 79 | (39 << 14), true);
    }
    assert.deepEqual(inspectImage(bytes.buffer, 'image/webp'), { width: 80, height: 40 });
    assert.throws(() => inspectImage(bytes.slice(0, 20).buffer, 'image/webp'));
  });
}
