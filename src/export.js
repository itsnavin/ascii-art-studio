import { RENDER, exportGeometry, normalizeArt } from './core.js';

const pendingDownloads = new Set();

export function releaseDownloads() {
  for (const release of pendingDownloads) release();
}

window.addEventListener('pagehide', releaseDownloads);

export function fontMetrics(fontSize) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.font = `${fontSize}px ${RENDER.family}`;
  const metrics = context.measureText('M');
  return { width: metrics.width, aspect: metrics.width / (fontSize * RENDER.lineHeightRatio) };
}

export async function createPng(text, fontSize) {
  normalizeArt(text);
  await document.fonts.ready;
  const metrics = fontMetrics(fontSize);
  const geometry = exportGeometry(text, fontSize, metrics.width);
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width;
  canvas.height = geometry.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.fillStyle = RENDER.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = RENDER.foreground;
  context.font = `${fontSize}px ${RENDER.family}`;
  context.textBaseline = 'alphabetic';
  // Use the font's em box to match the vertically centered CSS line box.
  const measured = context.measureText('Mg');
  const ascent = measured.fontBoundingBoxAscent ?? fontSize * 0.8;
  const descent = measured.fontBoundingBoxDescent ?? fontSize * 0.2;
  const baseline = (geometry.lineHeight - ascent - descent) / 2 + ascent;
  text.split('\n').forEach((line, row) => {
    context.fillText(line, RENDER.padding, RENDER.padding + baseline + row * geometry.lineHeight);
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      canvas.width = 1;
      canvas.height = 1;
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed. Try reducing the size, or save as .txt.'));
    }, 'image/png');
  });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  // Allow the browser to consume the URL before releasing the download resource.
  const timeout = setTimeout(release, 1000);
  pendingDownloads.add(release);
  function release() {
    clearTimeout(timeout);
    URL.revokeObjectURL(url);
    pendingDownloads.delete(release);
  }
  try {
    document.body.append(anchor);
    anchor.click();
  } catch (error) {
    release();
    throw error;
  } finally {
    anchor.remove();
  }
}
