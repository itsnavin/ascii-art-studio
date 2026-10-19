import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function picture(page, type = 'image/png', width = 80, height = 40) {
  const base64 = await page.evaluate(({ type, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, width / 2, height);
    context.fillStyle = '#fff';
    context.fillRect(width / 2, 0, width / 2, height);
    return canvas.toDataURL(type).split(',')[1];
  }, { type, width, height });
  return Buffer.from(base64, 'base64');
}

async function imageMode(page) {
  await page.getByRole('tab', { name: '03 Image' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('banner input, original fonts, examples and alphabet/number invariants', async ({ page }) => {
  await expect(page.locator('#preview')).toHaveText(/[@#%]/);
  await page.getByLabel('Your message').fill('Hi 42!');
  const block = await page.locator('#preview').textContent();
  await page.getByLabel('Letter style').selectOption('pocket');
  expect((await page.locator('#preview').textContent()).split('\n')).toHaveLength(5);
  expect(await page.locator('#preview').textContent()).not.toBe(block);
  for (const [palette, pattern] of [['alphabet', /^[A-Za-z \n]+$/], ['numbers', /^[0-9 \n]+$/]]) {
    await page.getByLabel('Character palette').selectOption(palette);
    expect(await page.locator('#preview').textContent()).toMatch(pattern);
  }
  await page.getByRole('button', { name: '2026', exact: true }).click();
  await expect(page.getByLabel('Your message')).toHaveValue('2026');
});

test('invalid Unicode, unsupported glyphs and palettes show errors, not stale art', async ({ page }) => {
  await page.getByLabel('Your message').fill('caf\u00e9');
  await expect(page.getByRole('alert')).toContainText('ASCII');
  await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#preview')).toHaveText('');
  await page.getByLabel('Your message').fill('@');
  await expect(page.getByRole('alert')).toContainText('does not support');
  await page.getByLabel('Your message').fill('HI');
  await page.getByLabel('Character palette').selectOption('custom');
  for (const value of ['xx', 'x', 'a\u2665']) {
    await page.getByLabel('Light to dark').fill(value);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#download-text')).toBeDisabled();
  }
  await page.getByLabel('Light to dark').fill('01');
  await expect(page.getByRole('alert')).toBeHidden();
  expect(await page.locator('#preview').textContent()).toMatch(/^[01 \n]+$/);
});

test('templates preserve slashes, whitespace, edits and literal markup safely', async ({ page }) => {
  await page.getByRole('tab', { name: '02 Symbols' }).click();
  await page.getByLabel('Start with a shape').selectOption('1');
  expect(await page.locator('#preview').textContent()).toContain('/\\___/\\');
  const literal = '<img src=x onerror="window.injected=1">  \n\\ /  \n';
  await page.getByLabel('Make it your own').fill(literal);
  expect(await page.locator('#preview').textContent()).toBe(literal);
  expect(await page.locator('#preview img').count()).toBe(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByLabel('Character palette').selectOption('numbers');
  expect(await page.locator('#preview').textContent()).toMatch(/^[0-9 \n]+$/);
  await page.getByLabel('Character palette').selectOption('classic');
  expect(await page.locator('#preview').textContent()).toBe(literal);
});

test('text download retains exact bytes, trailing spaces and final newline', async ({ page }) => {
  await page.getByRole('tab', { name: '02 Symbols' }).click();
  const text = '  A\\ B  \n / C   \n';
  await page.getByLabel('Make it your own').fill(text);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save .txt' }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('ascii-studio.txt');
  expect(await readFile(await download.path(), 'utf8')).toBe(text);
});

test('PNG download has exact dimensions, paper background, ink and no edge clipping', async ({ page }) => {
  await page.getByRole('tab', { name: '02 Symbols' }).click();
  await page.getByLabel('Make it your own').fill('M\\  \n /M ');
  const expected = await page.evaluate(() => {
    const pre = document.getElementById('preview');
    const fontSize = parseFloat(getComputedStyle(pre).fontSize);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
    return {
      width: Math.ceil(4 * ctx.measureText('M').width + 48),
      height: Math.ceil(2 * fontSize * 1.2 + 48)
    };
  });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save .png' }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('ascii-studio.png');
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
  expect(bytes.readUInt32BE(16)).toBe(expected.width);
  expect(bytes.readUInt32BE(20)).toBe(expected.height);
  const image = await page.evaluate(async base64 => {
    const blob = await (await fetch('data:image/png;base64,' + base64)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    let edgeInk = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] < 200) {
          ink++;
          if (x < 20 || y < 20 || x >= canvas.width - 20 || y >= canvas.height - 20) edgeInk++;
        }
      }
    }
    bitmap.close();
    return { corner: [...data.slice(0, 4)], ink, edgeInk };
  }, bytes.toString('base64'));
  expect(image.corner).toEqual([252, 251, 247, 255]);
  expect(image.ink).toBeGreaterThan(30);
  expect(image.edgeInk).toBe(0);
});

test('clipboard denied exposes exact selected text as manual fallback', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Denied')) }, configurable: true });
  });
  const text = await page.locator('#preview').textContent();
  await page.getByRole('button', { name: 'Copy art' }).click();
  await expect(page.locator('#manual-copy')).toBeVisible();
  await expect(page.locator('#manual-text')).toHaveValue(text);
  expect(await page.locator('#manual-text').evaluate(element => element.selectionEnd - element.selectionStart)).toBe(text.length);
  await expect(page.locator('#status')).toContainText('unavailable');
});

test('clipboard API absent gracefully falls back and successful copy is deliberate', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await expect(page.locator('#manual-copy')).toBeHidden();
  await page.getByRole('button', { name: 'Copy art' }).click();
  await expect(page.locator('#manual-copy')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async text => { window.copied = text; } }, configurable: true
  }));
  await page.getByLabel('Your message').fill('OK');
  await page.getByRole('button', { name: 'Copy art' }).click();
  expect(await page.evaluate(() => window.copied)).toBe(await page.locator('#preview').textContent());
  await expect(page.locator('#status')).toContainText('Copied exactly');
});

for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
  test(`${type}: local conversion, aspect, contrast, brightness, inversion and palettes`, async ({ page }) => {
    const data = await picture(page, type);
    await imageMode(page);
    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#copy')).toBeDisabled();
    await page.locator('#image-file').setInputFiles({ name: 'fixture.' + type.split('/')[1], mimeType: type, buffer: data });
    await expect(page.locator('#file-info')).toContainText('80 x 40');
    await expect(page.locator('#output-meta')).toHaveText('100 cols / 25 rows');
    const text = await page.locator('#preview').textContent();
    expect(text.split('\n')).toHaveLength(25);
    expect(text.split('\n')[0].startsWith('@'.repeat(40))).toBe(true);
    expect(text.split('\n')[0].endsWith(' '.repeat(40))).toBe(true);
    await page.getByLabel('Invert light and dark').check();
    const inverted = (await page.locator('#preview').textContent()).split('\n')[0];
    expect(inverted.startsWith(' '.repeat(40))).toBe(true);
    expect(inverted.endsWith('@'.repeat(40))).toBe(true);
    await page.getByLabel('Character palette').selectOption('alphabet');
    expect(await page.locator('#preview').textContent()).toMatch(/^[A-Za-z \n]+$/);
    await page.getByLabel('Character palette').selectOption('numbers');
    expect(await page.locator('#preview').textContent()).toMatch(/^[0-9 \n]+$/);
    await page.locator('#brightness').fill('100');
    await expect(page.locator('#brightness-value')).toHaveText('100');
    await page.locator('#contrast').fill('2');
    await expect(page.locator('#contrast-value')).toHaveText('2.0');
    await page.locator('#columns').fill('80');
    await expect(page.locator('#output-meta')).toHaveText('80 cols / 20 rows');
  });
}

test('JPEG EXIF rotation is applied exactly once', async ({ page }) => {
  const jpeg = await picture(page, 'image/jpeg', 80, 40);
  const exif = Buffer.from([
    0xff,0xe1,0,34, 69,120,105,102,0,0,
    73,73,42,0,8,0,0,0,
    1,0, 0x12,1,3,0,1,0,0,0,6,0,0,0, 0,0,0,0
  ]);
  const rotated = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
  await imageMode(page);
  await page.locator('#image-file').setInputFiles({ name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: rotated });
  await expect(page.locator('#file-info')).toContainText('40 x 80');
  await expect(page.locator('#output-meta')).toHaveText('100 cols / 100 rows');
});

test('bad, huge and unsupported images produce visible errors without decoding', async ({ page }) => {
  await imageMode(page);
  await page.evaluate(() => {
    window.decodes = 0;
    const original = window.createImageBitmap;
    window.createImageBitmap = (...args) => { window.decodes++; return original(...args); };
  });
  const huge = Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(huge);
  huge.writeUInt32BE(13, 8);
  huge.write('IHDR', 12);
  huge.writeUInt32BE(12001, 16);
  huge.writeUInt32BE(10, 20);
  for (const fixture of [
    { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    { name: 'huge.png', mimeType: 'image/png', buffer: huge },
    { name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    { name: 'oversize.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(12 * 1024 * 1024 + 1) }
  ]) {
    await page.locator('#image-file').setInputFiles(fixture);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#preview')).toHaveText('');
    await expect(page.locator('#copy')).toBeDisabled();
  }
  expect(await page.evaluate(() => window.decodes)).toBe(0);
  const corrupt = Buffer.alloc(33);
  huge.copy(corrupt);
  corrupt.writeUInt32BE(80, 16);
  corrupt.writeUInt32BE(40, 20);
  await page.locator('#image-file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: corrupt });
  await expect(page.getByRole('alert')).toContainText('could not be decoded');
});

test('reset closes decoded photos and cancels stale decode results', async ({ page }) => {
  const data = await picture(page);
  await imageMode(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.decodeStarted = false;
    window.closedBitmaps = 0;
    window.createImageBitmap = async (...args) => {
      const result = await original(...args);
      window.decodeStarted = true;
      const close = result.close.bind(result);
      result.close = () => { window.closedBitmaps++; close(); };
      await new Promise(resolve => { window.finishDecode = resolve; });
      return result;
    };
  });
  await page.locator('#image-file').setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: data });
  await expect.poll(() => page.evaluate(() => window.decodeStarted)).toBe(true);
  await page.getByRole('button', { name: 'Reset studio' }).click();
  await page.evaluate(() => window.finishDecode());
  await expect.poll(() => page.evaluate(() => window.closedBitmaps)).toBe(1);
  await expect(page.locator('#preview')).toHaveText('');
  await expect(page.locator('#file-info')).toHaveText('No image selected');
  await expect(page.locator('#copy')).toBeDisabled();
});

test('reset releases a loaded photo and pending download URLs', async ({ page }) => {
  const data = await picture(page);
  await imageMode(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.closedBitmaps = 0;
    window.releasedUrls = [];
    window.createImageBitmap = async (...args) => {
      const result = await original(...args);
      const close = result.close.bind(result);
      result.close = () => { window.closedBitmaps++; close(); };
      return result;
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.releasedUrls.push(url); revoke(url); };
  });
  await page.locator('#image-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: data });
  await expect(page.locator('#copy')).toBeEnabled();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save .txt' }).click();
  await event;
  await page.getByRole('button', { name: 'Reset studio' }).click();
  expect(await page.evaluate(() => window.closedBitmaps)).toBe(1);
  expect(await page.evaluate(() => window.releasedUrls.length)).toBe(1);
  await expect(page.locator('#preview')).toHaveText('');
  await expect(page.locator('#image-file')).toHaveValue('');
});

test('transparent image uses white background and extreme aspect is bounded', async ({ page }) => {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 12000;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, 50, 12000);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await imageMode(page);
  await page.locator('#image-file').setInputFiles({ name: 'tall.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('#status')).toContainText('Detail was reduced');
  const lines = (await page.locator('#preview').textContent()).split('\n');
  expect(lines.length).toBeLessThanOrEqual(360);
  expect(lines.length * lines[0].length).toBeLessThanOrEqual(60000);
  expect(lines[0].endsWith('  ')).toBe(true);
  expect(Math.abs(lines.length / lines[0].length - 60)).toBeLessThanOrEqual(0.5);
});

test('oversized PNG is rejected visibly instead of clipping or downloading', async ({ page }) => {
  const data = await picture(page, 'image/png', 100, 208);
  await imageMode(page);
  await page.locator('#image-file').setInputFiles({ name: 'large-output.png', mimeType: 'image/png', buffer: data });
  await expect(page.locator('#copy')).toBeEnabled();
  await page.locator('#columns').fill('240');
  await page.locator('#zoom').fill('24');
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Save .png' }).click();
  await expect(page.getByRole('alert')).toContainText('too large');
  expect(downloads).toBe(0);
  await expect(page.getByRole('button', { name: 'Save .txt' })).toBeEnabled();
});

test('reset discards a pending PNG export', async ({ page }) => {
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.exportStarted = true;
      window.finishExport = () => original.apply(this, args);
    };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Save .png' }).click();
  await expect.poll(() => page.evaluate(() => window.exportStarted)).toBe(true);
  await page.getByRole('button', { name: 'Reset studio' }).click();
  await page.evaluate(() => window.finishExport());
  await expect(page.locator('#status')).toContainText('Studio reset');
  expect(downloads).toBe(0);
});

test('new upload wins over a stale decode and mode switches cancel pending work', async ({ page }) => {
  const first = await picture(page);
  const second = await picture(page, 'image/png', 40, 80);
  await imageMode(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.firstStarted = false;
    window.createImageBitmap = async (...args) => {
      const result = await original(...args);
      if (!window.firstStarted) {
        window.firstStarted = true;
        await new Promise(resolve => { window.finishFirst = resolve; });
      }
      return result;
    };
  });
  await page.locator('#image-file').setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: first });
  await expect.poll(() => page.evaluate(() => window.firstStarted)).toBe(true);
  await page.locator('#image-file').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: second });
  await expect(page.locator('#file-info')).toContainText('second.png / 40 x 80');
  await page.evaluate(() => window.finishFirst());
  await expect(page.locator('#output-meta')).toHaveText('100 cols / 100 rows');
  await page.getByRole('button', { name: 'Reset studio' }).click();
  await page.evaluate(() => { window.firstStarted = false; });
  await page.locator('#image-file').setInputFiles({ name: 'third.png', mimeType: 'image/png', buffer: first });
  await expect.poll(() => page.evaluate(() => window.firstStarted)).toBe(true);
  await page.getByRole('tab', { name: '01 Text' }).click();
  const banner = await page.locator('#preview').textContent();
  await page.evaluate(() => window.finishFirst());
  expect(await page.locator('#preview').textContent()).toBe(banner);
  await imageMode(page);
  await expect(page.locator('#copy')).toBeDisabled();
});

test('keyboard tabs, mobile containment and keyboard-scrollable long output', async ({ page }) => {
  await page.locator('#tab-banner').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-template')).toBeFocused();
  await expect(page.locator('#tab-template')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.locator('#tab-image')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#tab-banner')).toBeFocused();
  await page.getByLabel('Your message').fill('W'.repeat(28));
  await page.locator('#preview-scroll').scrollIntoViewIfNeeded();
  await page.locator('#preview-scroll').focus();
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
    scroll: document.getElementById('preview-scroll').scrollWidth,
    client: document.getElementById('preview-scroll').clientWidth
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('#preview-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});

test('conversion works offline and photos are not persisted', async ({ page, context }) => {
  const data = await picture(page);
  await imageMode(page);
  await page.locator('#image-file').setInputFiles({ name: 'private.png', mimeType: 'image/png', buffer: data });
  await expect(page.locator('#file-info')).toContainText('local only');
  await page.reload();
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await imageMode(page);
  await expect(page.locator('#empty-state')).toBeVisible();
  await context.setOffline(true);
  await page.locator('#image-file').setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: data });
  await expect(page.locator('#file-info')).toContainText('offline.png / 80 x 40');
  await expect(page.locator('#output-meta')).toHaveText('100 cols / 25 rows');
  await page.getByRole('tab', { name: '02 Symbols' }).click();
  await page.getByLabel('Make it your own').fill('LOCAL');
  await expect(page.locator('#preview')).toHaveText('LOCAL');
  await page.getByRole('tab', { name: '01 Text' }).click();
  await page.getByLabel('Your message').fill('OFFLINE');
  await expect(page.locator('#copy')).toBeEnabled();
});
