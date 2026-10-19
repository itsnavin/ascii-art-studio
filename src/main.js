import './style.css';
import { LIMITS, RENDER, dimensions, getPalette, renderBanner, renderTemplate, imageDimensions, pixelsToAscii } from './core.js';
import { TEMPLATES } from './templates.js';
import { inspectImage } from './image.js';
import { createPng, downloadBlob, fontMetrics, releaseDownloads } from './export.js';

const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[data-mode]')];
const exportButtons = [$('copy'), $('download-text'), $('download-png')];
let mode = 'banner';
let output = '';
let bitmap = null;
let imageJob = 0;
let loading = false;
let renderRevision = 0;

for (const [index, template] of TEMPLATES.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = template.name;
  $('template-select').append(option);
}
$('template-text').value = TEMPLATES[0].art;

function notify(message) {
  $('status').textContent = message;
}

function clearError() {
  $('error').hidden = true;
  $('error').textContent = '';
}

function showError(error) {
  $('error').textContent = error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
  $('error').hidden = false;
}

function setOutput(text) {
  output = text;
  renderRevision++;
  $('preview').textContent = text;
  $('manual-copy').hidden = true;
  $('manual-text').value = '';
  const available = Boolean(text.trim());
  exportButtons.forEach(button => { button.disabled = !available; });
  $('preview-scroll').hidden = !available;
  $('empty-state').hidden = available;
  $('empty-state').querySelector('h3').textContent = mode === 'image' ? 'Your photo goes here.' : 'A blank canvas.';
  $('empty-state').querySelector('p').textContent = mode === 'image'
    ? 'Choose an image to see it in a new language. Nothing leaves your browser.'
    : 'Add some text or characters to start creating.';
  if (text) {
    const size = dimensions(text);
    $('output-meta').textContent = `${size.columns} cols / ${size.rows} rows`;
  } else {
    $('output-meta').textContent = loading ? 'Reading locally...' : 'Waiting for your idea';
  }
}

function render() {
  clearError();
  $('custom-palette-wrap').hidden = $('palette').value !== 'custom';
  for (const id of ['columns', 'contrast', 'brightness']) {
    $(id + '-value').textContent = id === 'contrast' ? Number($(id).value).toFixed(1) : $(id).value;
  }
  const fontSize = Number($('zoom').value);
  $('zoom-value').textContent = fontSize + 'px';
  $('preview').style.fontSize = fontSize + 'px';
  try {
    const palette = getPalette($('palette').value, $('custom-palette').value);
    $('palette-swatch').textContent = palette.replace(/ /g, '[space]');
    $('palette-help').textContent = $('palette').value === 'custom'
      ? 'Custom order maps light to dark in images. Banners and symbols use non-space characters; spaces remain their background.'
      : 'Spaces form the background. Letters/numbers-only palettes use only those characters plus spaces and line breaks.';
    if (mode === 'banner') {
      setOutput(renderBanner($('banner-text').value, $('banner-font').value, palette));
    } else if (mode === 'template') {
      setOutput(renderTemplate($('template-text').value, $('palette').value, palette));
    } else if (bitmap) {
      const size = imageDimensions(bitmap.width, bitmap.height, Number($('columns').value), fontMetrics(fontSize).aspect);
      const canvas = document.createElement('canvas');
      canvas.width = size.columns;
      canvas.height = size.rows;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Your browser does not support canvas image processing.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setOutput(pixelsToAscii(context.getImageData(0, 0, canvas.width, canvas.height).data, size.columns, size.rows, palette, {
        contrast: Number($('contrast').value),
        brightness: Number($('brightness').value),
        invert: $('invert').checked
      }));
      if (size.limited) notify('Detail was reduced to keep this image within the 360-row / 60,000-cell safety limit.');
      else notify('Converted locally. Adjust the detail or palette to explore.');
    } else {
      setOutput('');
    }
  } catch (error) {
    $('palette-swatch').textContent = '';
    setOutput('');
    showError(error);
    notify('Check the error message and adjust your input. No art was exported.');
  }
}

function cancelDecode() {
  imageJob++;
  if (loading) {
    loading = false;
    $('image-file').value = '';
    $('file-info').textContent = 'Image reading canceled. Choose a photo to try again.';
  }
}

function switchMode(next) {
  cancelDecode();
  mode = next;
  for (const tab of tabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $('panel-' + tab.dataset.mode).hidden = !selected;
  }
  notify(mode === 'image' && !bitmap ? 'Choose an image. No sample is substituted for your photo.' : 'Ready. Changes appear as you type.');
  render();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    switchMode(tabs[next].dataset.mode);
    tabs[next].focus();
  });
});

for (const id of ['banner-text', 'banner-font', 'template-text', 'palette', 'custom-palette', 'columns', 'contrast', 'brightness', 'invert', 'zoom']) {
  $(id).addEventListener('input', () => {
    notify('Updated. Your art is ready.');
    render();
  });
}
$('template-select').addEventListener('change', () => {
  $('template-text').value = TEMPLATES[Number($('template-select').value)].art;
  notify('Template loaded. Every character is editable.');
  render();
});
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  $('banner-text').value = button.dataset.example;
  notify('Example loaded. Try your own message.');
  render();
}));

$('image-file').addEventListener('change', async () => {
  const file = $('image-file').files[0];
  if (!file) return;
  cancelDecode();
  const job = imageJob;
  if (bitmap) bitmap.close();
  bitmap = null;
  loading = true;
  clearError();
  setOutput('');
  $('file-info').textContent = `Reading ${file.name} locally...`;
  notify('Checking image size before decoding...');
  let decoded = null;
  try {
    if (file.size === 0 || file.size > LIMITS.fileBytes) throw new Error('Choose a non-empty image no larger than 12 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP file. Other formats are not supported.');
    const buffer = await file.arrayBuffer();
    if (job !== imageJob) return;
    inspectImage(buffer, file.type);
    if (typeof createImageBitmap !== 'function') throw new Error('Local image decoding is unavailable in this browser. Try a current Chrome, Edge, Firefox or Safari.');
    try {
      decoded = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error('This image could not be decoded. It may be damaged or use an unsupported encoding. Try another JPEG, PNG or WebP.');
    }
    if (job !== imageJob) {
      decoded.close();
      return;
    }
    imageDimensions(decoded.width, decoded.height, Number($('columns').value));
    bitmap = decoded;
    decoded = null;
    loading = false;
    $('file-info').textContent = `${file.name} / ${bitmap.width} x ${bitmap.height} px / local only`;
    render();
  } catch (error) {
    if (decoded) decoded.close();
    if (job !== imageJob) return;
    loading = false;
    $('image-file').value = '';
    $('file-info').textContent = 'No image loaded. Choose another file.';
    setOutput('');
    showError(error);
    notify('Image was not converted.');
  }
});

$('reset').addEventListener('click', () => {
  cancelDecode();
  releaseDownloads();
  if (bitmap) bitmap.close();
  bitmap = null;
  $('image-file').value = '';
  $('file-info').textContent = 'No image selected';
  $('banner-text').value = 'HELLO';
  $('banner-font').value = 'block';
  $('template-select').value = '0';
  $('template-text').value = TEMPLATES[0].art;
  $('palette').value = 'classic';
  $('custom-palette').value = ' .oO#';
  $('columns').value = '100';
  $('contrast').value = '1';
  $('brightness').value = '0';
  $('invert').checked = false;
  $('zoom').value = '14';
  render();
  notify('Studio reset. Any photo and pending image work have been cleared.');
});

$('copy').addEventListener('click', async () => {
  const text = output;
  const revision = renderRevision;
  clearError();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable.');
    await navigator.clipboard.writeText(text);
    if (revision === renderRevision) notify('Copied exactly, spaces and line breaks included.');
  } catch {
    if (revision !== renderRevision) return;
    $('manual-copy').hidden = false;
    $('manual-text').value = text;
    $('manual-text').focus();
    $('manual-text').select();
    notify('Clipboard access was unavailable. Use Ctrl+C or Command+C, or long-press the selected text to copy.');
  }
});
$('download-text').addEventListener('click', () => {
  clearError();
  try {
    downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), 'ascii-studio.txt');
    notify('Text download requested. All spaces and line breaks are preserved.');
  } catch (error) {
    showError(error);
    notify('Text download failed.');
  }
});
$('download-png').addEventListener('click', async () => {
  const revision = renderRevision;
  const text = output;
  const fontSize = Number($('zoom').value);
  clearError();
  $('download-png').disabled = true;
  notify('Drawing your PNG locally...');
  try {
    const blob = await createPng(text, fontSize);
    if (revision !== renderRevision) return;
    downloadBlob(blob, 'ascii-studio.png');
    notify('PNG download requested, with the preview font, spacing and paper background.');
  } catch (error) {
    if (revision !== renderRevision) return;
    showError(error);
    notify('PNG was not exported. Reduce size or save as text.');
  } finally {
    $('download-png').disabled = !output.trim();
  }
});
window.addEventListener('pagehide', () => {
  cancelDecode();
  if (bitmap) bitmap.close();
  bitmap = null;
});
window.addEventListener('pageshow', event => {
  if (event.persisted && mode === 'image') {
    $('image-file').value = '';
    $('file-info').textContent = 'Photo cleared when leaving the page. Choose it again to continue.';
    render();
    notify('No photo was retained after leaving this page.');
  }
});
render();
