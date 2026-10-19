# ASCII Studio

A private, browser-local character-art workbench. Make large text banners, customize original picture templates, or turn a photo into grayscale ASCII. No account, API, image uploads, analytics, remote fonts, or runtime dependencies.

**Live site:** https://itsnavin.github.io/ascii-art-studio/

## Make something

- **Text:** Type `HELLO`, `MAKE STUFF`, or `2026`. Choose Studio Block (5 x 7) or Pocket (3 x 5). Lowercase is explicitly converted to uppercase. Fonts support A-Z, 0-9, spaces, and `. , ! ? : - + / ' ( )`. Unsupported characters produce an error, not replacement glyphs. Maximum 4 lines / 28 characters per line.
- **Symbols:** Nine original editable doodles: heart, cat, star, mountains, robot, diamond, sprout, fish and a message frame. Classic preserves the exact edited text; other palettes deterministically remap non-space characters. Tabs expand to four spaces. Maximum 240 columns / 120 rows / 28,800 cells.
- **Image:** Choose a JPEG, PNG or WebP. Start with 80-100 columns and a clear high-contrast subject. Adjust brightness, contrast and inversion. More columns mean more detail and wider text, not necessarily a better picture. Conversion uses weighted sRGB luminance, not AI or semantic recognition.
- **Palettes:** Classic, alphabet-only, numbers-only, or 2-64 unique custom printable ASCII characters ordered light to dark. **Letters/numbers-only still use spaces for background and newlines for layout.** Banners use the last three non-space palette characters for readable, dense letter strokes. No decorative Unicode is presented as ASCII. Banner/template backgrounds remain spaces even if a custom palette omits space.
- **Export:** Copy preserves whitespace. If clipboard access is denied or unavailable, an exact selectable text fallback appears. Save `.txt` without trimming or adding line breaks, or save a raster `.png` matching the preview font size, line spacing, colors and padding. Use a monospaced font when pasting text elsewhere.

The preview is horizontally and vertically scrollable by touch, pointer or keyboard; focus it and use arrow keys. Mode tabs support arrow keys, Home and End. All inputs are labeled and errors/status changes are announced.

## Privacy, formats and limits

All conversion happens in the browser, including image decoding and PNG creation. No photos or art are saved to local/session storage. Reset releases the photo and invalidates pending decoding; mode switches cancel pending decoding. Replacing an upload closes the previous bitmap. Late results are discarded and closed. Download URLs are revoked after use. Leaving the page releases the image; returning through browser history requires choosing the photo again.

The static site host receives ordinary page/asset requests, but never uploaded photos. There is no service worker or offline install requirement: after the page loads, art generation requires no network.

Image input is limited to **12 MiB, 24 megapixels, 12,000 pixels per side**. JPEG/PNG/WebP headers are checked before decoding to reject oversized images without allocating their full raster. Corrupt headers, unsupported formats and decoding failures are visible errors. EXIF orientation is delegated once to `createImageBitmap` with `imageOrientation: "from-image"`; there is no second manual rotation. Transparent pixels are composited on white; animated inputs use their first frame. The browser must support Canvas 2D and `createImageBitmap` (current Chrome, Edge, Firefox or Safari). Tests currently exercise Chromium desktop and mobile emulation, not every browser implementation.

Image output uses **20-240 requested columns**, at most **360 rows / 60,000 cells**. Tall images can reduce the actual number of columns below 20 to stay bounded. Aspect ratio uses the actual measured monospaced cell width divided by the 1.2x line height; integer-grid rounding and an extreme one-column image can introduce unavoidable approximation. Preview size is 8-24 CSS pixels, not a device-pixel-ratio-dependent scale.

PNG exports are capped at **8,192 px per side / 16 megapixels** and include 24 px padding. Excessive exports show an error; lower the Size/detail controls or use `.txt`. Whitespace-only images can be previewed, but export is disabled until they contain a visible character. Font rasterization can vary slightly between operating systems; the same local system font stack is used for preview and PNG.

## Fonts and art provenance

`src/fonts.js` contains two original hand-authored bitmap alphabets, drawn for this project. All templates in `src/templates.js` were authored for this project; no third-party ASCII collections, branded characters or logos are bundled. Both are covered by this repository's MIT license. The interface and output use browser-provided Arial/Helvetica and Courier New/Courier/monospace respectively, not redistributed font binaries. There are no third-party font license requirements or CDN font requests.

## Development

Node.js 22+ and npm:

```sh
npm ci
npm run dev
```

On Windows PowerShell with script execution restricted, use `npm.cmd` / `npx.cmd` instead of the PowerShell wrappers.

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm run preview
```

Unit tests use Node's built-in runner. Browser tests use generated synthetic fixtures (no personal photos), built production assets, desktop/mobile Chromium, real text/PNG downloads, pixel dimensions/content, EXIF rotation, palette/input errors, clipboard fallback/success, keyboard/mobile scrolling, reset, stale decoding, file bounds, no persistence and conversion with the network offline. The browser runner builds and starts its own bounded preview server.

Run the same suite against a deployed site:

```powershell
$env:STUDIO_URL = 'https://itsnavin.github.io/ascii-art-studio/'
npm.cmd run test:browser
```

## Publishing

GitHub Pages serves the production `dist/` output using `.github/workflows/pages.yml`. Under repository **Settings > Pages**, choose **GitHub Actions** as the build source. Push to `main`, or dispatch **Publish studio**. The workflow runs unit and production-browser tests, uploads the build, deploys with Pages OIDC, then reruns desktop/mobile interactions and actual downloads against the live URL. `.github/workflows/ci.yml` also checks pushes and pull requests. Failed browser traces are retained as Actions artifacts.

Vite uses relative asset paths so the same build works at the repository subpath and on other static hosts. There are no server-side routes, secrets or backend services.
