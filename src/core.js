import { FONTS } from './fonts.js';

export const LIMITS = Object.freeze({
  fileBytes: 12 * 1024 * 1024,
  imagePixels: 24_000_000,
  imageSide: 12_000,
  columns: 240,
  rows: 360,
  cells: 60_000,
  pngSide: 8192,
  pngPixels: 16_000_000
});
export const PALETTES = Object.freeze({
  classic: ' .:-=+*#%@',
  alphabet: ' aceinorsuvwxzAEHKMNW',
  numbers: ' 1234567890'
});
export const RENDER = Object.freeze({
  family: '"Courier New", Courier, monospace',
  cellWidthRatio: 0.6,
  lineHeightRatio: 1.2,
  padding: 24,
  background: '#fcfbf7',
  foreground: '#263127'
});

export function validatePalette(value) {
  if (value.length < 2 || value.length > 64) throw new Error('Use 2-64 unique printable ASCII characters in your palette.');
  if (!/^[\x20-\x7e]+$/.test(value)) throw new Error('Palettes accept printable ASCII only (space through ~). Unicode and control characters are not ASCII.');
  if (new Set(value).size !== value.length) throw new Error('Each character in your palette must be unique.');
  return value;
}

export function getPalette(name, custom) {
  if (name === 'custom') return validatePalette(custom);
  if (!Object.hasOwn(PALETTES, name)) throw new Error('Choose a supported palette.');
  return PALETTES[name];
}

export function normalizeArt(value) {
  const text = value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  if (!/^[\x20-\x7e\n]*$/.test(text)) throw new Error('Use printable 7-bit ASCII characters only. Unicode symbols, emoji and control characters are not supported.');
  return text;
}

export function dimensions(text) {
  const lines = text.split('\n');
  return { columns: Math.max(...lines.map(line => line.length)), rows: lines.length };
}

export function renderBanner(value, fontName, palette) {
  validatePalette(palette);
  const font = FONTS[fontName];
  if (!font) throw new Error('Choose a supported letter style.');
  const text = normalizeArt(value).toUpperCase();
  const lines = text.split('\n');
  if (lines.length > 4 || lines.some(line => line.length > 28)) throw new Error('Keep banners to 4 lines and 28 characters per line.');
  for (const char of text.replace(/\n/g, '')) {
    if (!font.glyphs[char]) throw new Error(`The selected font does not support "${char}". Use A-Z, 0-9, spaces or the listed punctuation.`);
  }
  if (!text.trim()) return '';
  const ink = palette.replace(/ /g, '').slice(-3);
  const width = Math.max(...lines.map(line => line.length)) * (font.width + 1) - 1;
  return lines.map((line, lineIndex) => Array.from({ length: font.height }, (_, y) =>
    [...line].map((char, index) => [...font.glyphs[char][y]].map((pixel, x) =>
      pixel === '1' ? ink[(x + y + index + lineIndex) % ink.length] : ' ').join('')).join(' ').padEnd(width)
  ).join('\n')).join(`\n${' '.repeat(width)}\n`);
}

export function renderTemplate(value, paletteName, palette) {
  validatePalette(palette);
  const text = normalizeArt(value);
  const size = dimensions(text);
  if (size.columns > 240 || size.rows > 120 || size.columns * size.rows > 28_800) throw new Error('Templates are limited to 240 columns, 120 lines and 28,800 cells.');
  if (paletteName === 'classic') return text;
  const ink = palette.replace(/ /g, '');
  return [...text].map(char => char === ' ' || char === '\n' ? char : ink[char.charCodeAt(0) % ink.length]).join('');
}

export function imageDimensions(width, height, columns, cellAspect = 0.5) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > LIMITS.imageSide || height > LIMITS.imageSide || width * height > LIMITS.imagePixels) {
    throw new Error('Image is too large or has invalid dimensions. Use at most 24 megapixels and 12,000 pixels per side.');
  }
  if (!Number.isInteger(columns) || columns < 20 || columns > LIMITS.columns) throw new Error('Choose between 20 and 240 output columns.');
  if (!Number.isFinite(cellAspect) || cellAspect < 0.1 || cellAspect > 2) throw new Error('Invalid character cell aspect ratio.');
  let cols = columns;
  let rows = Math.max(1, Math.round(height / width * cols * cellAspect));
  const scale = Math.min(1, LIMITS.rows / rows, Math.sqrt(LIMITS.cells / (cols * rows)));
  if (scale < 1) {
    cols = Math.max(1, Math.floor(cols * scale));
    rows = Math.max(1, Math.min(LIMITS.rows, Math.round(height / width * cols * cellAspect)));
  }
  while (cols * rows > LIMITS.cells) cols--;
  return { columns: cols, rows, limited: cols !== columns };
}

export function pixelsToAscii(data, columns, rows, palette, { contrast = 1, brightness = 0, invert = false } = {}) {
  validatePalette(palette);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 ||
      columns > LIMITS.columns || rows > LIMITS.rows || columns * rows > LIMITS.cells || data.length !== columns * rows * 4) {
    throw new Error('Invalid image pixel buffer or output dimensions.');
  }
  if (!Number.isFinite(contrast) || contrast < 0.2 || contrast > 3 || !Number.isFinite(brightness) || brightness < -100 || brightness > 100) throw new Error('Invalid contrast or brightness.');
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < columns; x++) {
      const i = (y * columns + x) * 4;
      const alpha = data[i + 3] / 255;
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * alpha + 255 * (1 - alpha);
      let light = Math.max(0, Math.min(255, (luminance - 127.5) * contrast + 127.5 + brightness * 2.55));
      if (invert) light = 255 - light;
      line += palette[Math.round((1 - light / 255) * (palette.length - 1))];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function exportGeometry(text, fontSize, cellWidth = fontSize * RENDER.cellWidthRatio) {
  const size = dimensions(text);
  if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 24 || !Number.isFinite(cellWidth) || cellWidth <= 0) throw new Error('Invalid export font metrics.');
  const lineHeight = fontSize * RENDER.lineHeightRatio;
  const width = Math.ceil(size.columns * cellWidth + RENDER.padding * 2);
  const height = Math.ceil(size.rows * lineHeight + RENDER.padding * 2);
  if (width > LIMITS.pngSide || height > LIMITS.pngSide || width * height > LIMITS.pngPixels) {
    throw new Error('This PNG would be too large (maximum 8,192 px per side and 16 megapixels). Reduce the Size slider or output detail, or save as .txt.');
  }
  return { width, height, lineHeight, cellWidth };
}
