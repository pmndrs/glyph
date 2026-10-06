// Dependency-free PNG codec and image diff for the visual tour. zlib does the deflate; everything else is here.
// Decode covers what Chromium screenshots produce (8-bit, non-interlaced, grey/RGB/RGBA/palette); encode writes RGBA.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let offset = 8;
  let header;
  let palette;
  let transparency;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (header === undefined) throw new Error('PNG has no IHDR');
  const { width, height, depth, colorType, interlace } = header;
  const channels = CHANNELS[colorType];
  if (depth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, color type ${colorType}, interlace ${interlace}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[previous + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter} on row ${y}`);
      pixels[row + x] = (raw[source + x] + predictor) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 0) r = g = b = pixels[j];
    else if (colorType === 4) {
      r = g = b = pixels[j];
      a = pixels[j + 1];
    } else if (colorType === 3) {
      const index = pixels[j];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      if (transparency !== undefined && index < transparency.length) a = transparency[index];
    } else {
      r = pixels[j];
      g = pixels[j + 1];
      b = pixels[j + 2];
      if (colorType === 6) a = pixels[j + 3];
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Encodes RGBA (4 bytes per pixel) as an 8-bit, colour type 6 PNG, filter 0 (zlib does the rest). */
export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when pixel (x, y) lies inside one of the `[x, y, width, height]` rectangles. */
function masked(masks, x, y) {
  for (const [mx, my, mw, mh] of masks) if (x >= mx && x < mx + mw && y >= my && y < my + mh) return true;
  return false;
}

/**
 * Compares two RGBA images channel by channel over RGB. Pixels inside `masks` (UI overlays whose content is
 * telemetry, not rendering) are excluded from the numbers and drawn hatched in the heatmap.
 * Heatmap: B in dim grey; changed pixels coloured by magnitude (blue = B brighter, red = B darker, yellow > 8/255).
 */
export function diffImages(a, b, { masks = [] } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeMismatch: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const { width, height } = a;
  const heat = new Uint8Array(width * height * 4);
  let max = 0;
  let sum = 0;
  let counted = 0;
  let over1 = 0;
  let over8 = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (masked(masks, x, y)) {
        const stripe = (x + y) % 8 < 4 ? 70 : 40;
        heat.set([stripe, stripe, stripe, 255], i);
        continue;
      }
      const dr = b.data[i] - a.data[i];
      const dg = b.data[i + 1] - a.data[i + 1];
      const db = b.data[i + 2] - a.data[i + 2];
      const d = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
      counted += 1;
      sum += (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3;
      if (d > max) max = d;
      if (d > 1) over1 += 1;
      if (d > 8) over8 += 1;
      if (d > 1) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const luminance = (b.data[i] * 0.3 + b.data[i + 1] * 0.59 + b.data[i + 2] * 0.11) * 0.25;
      if (d <= 1) {
        heat.set([luminance, luminance, luminance, 255], i);
      } else {
        // Amplify: 2/255 is already clearly visible, 32/255 saturates.
        const t = Math.min(1, d / 32);
        const brighter = dr + dg + db > 0;
        if (d > 8) heat.set([255, 220 + 35 * t, 40 * (1 - t), 255], i);
        else if (brighter) heat.set([40, 120 + 100 * t, 255, 255], i);
        else heat.set([255, 60 + 80 * t, 60, 255], i);
      }
    }
  }
  return {
    width,
    height,
    maxAbs: max,
    meanAbs: counted === 0 ? 0 : sum / counted,
    pixels: counted,
    over1,
    over8,
    over1Fraction: counted === 0 ? 0 : over1 / counted,
    changedBounds: maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1],
    heatmap: { width, height, data: heat },
  };
}
