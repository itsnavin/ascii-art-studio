import { LIMITS, imageDimensions } from './core.js';

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const bytesEqual = (bytes, offset, expected) => expected.every((value, index) => bytes[offset + index] === value);
const fourCC = (bytes, offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

export function inspectImage(buffer, type) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Choose a JPEG, PNG or WebP file. Other formats are not supported.');
  if (buffer.byteLength === 0 || buffer.byteLength > LIMITS.fileBytes) throw new Error('Choose a non-empty image no larger than 12 MB.');
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let width;
  let height;
  if (type === 'image/png' && bytes.length >= 33 &&
      bytesEqual(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) &&
      view.getUint32(8) === 13 && fourCC(bytes, 12) === 'IHDR') {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (type === 'image/jpeg' && bytesEqual(bytes, 0, [0xff, 0xd8])) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (SOF.has(marker) && length >= 8) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (type === 'image/webp' && bytes.length >= 20 &&
      fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP' &&
      view.getUint32(4, true) + 8 === bytes.length) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = fourCC(bytes, offset);
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (data + length > bytes.length) break;
      if (kind === 'VP8X' && length >= 10) {
        width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
        height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
        break;
      }
      if (kind === 'VP8 ' && length >= 10 && bytesEqual(bytes, data + 3, [0x9d, 0x01, 0x2a])) {
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
        break;
      }
      if (kind === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
        const bits = view.getUint32(data + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        break;
      }
      offset = data + length + (length % 2);
    }
  }
  if (!width || !height) throw new Error('The image header is invalid or does not match its file type. Choose a valid JPEG, PNG or WebP.');
  imageDimensions(width, height, 100);
  return { width, height };
}
