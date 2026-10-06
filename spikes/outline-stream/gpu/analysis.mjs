// Timing statistics and pixel comparison.

/** Nearest-rank percentile of an unsorted sample list. */
export function percentile(samples, p) {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function summarize(samples) {
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  return {
    medianMs: percentile(samples, 50),
    p90Ms: percentile(samples, 90),
    meanMs: mean,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    frames: samples.length,
  };
}

/**
 * Compare two top-down RGBA8 images over R, G and B (alpha is always 1 here). Differences are in 1/255 units:
 * `maxAbs` and `meanAbs` over all pixels (per pixel, the largest channel difference), `over1` the count of pixels
 * differing by more than 1/255, `nonzero` the count differing at all.
 */
export function diffImages(a, b, width, height) {
  let maxAbs = 0;
  let sum = 0;
  let over1 = 0;
  let nonzero = 0;
  let firstOver = null;
  const pixels = width * height;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    if (d === 0) continue;
    nonzero += 1;
    sum += d;
    if (d > maxAbs) maxAbs = d;
    if (d > 1) {
      over1 += 1;
      if (!firstOver) firstOver = { x: i % width, y: Math.floor(i / width), a: a[o], b: b[o] };
    }
  }
  return { maxAbs, meanAbs: sum / pixels, over1, nonzero, pixels, firstOver };
}

/**
 * Diff visualization: the reference image dimmed to grey, pixels where `b` is brighter in blue and darker in red,
 * amplified 16x so single-step differences are visible.
 */
export function diffImageData(a, b, width, height) {
  const out = new ImageData(width, height);
  const data = out.data;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const base = a[o] * 0.3;
    const d = b[o] - a[o];
    const amp = Math.min(255, Math.abs(d) * 16);
    data[o] = d < 0 ? Math.max(base, amp) : base;
    data[o + 1] = base;
    data[o + 2] = d > 0 ? Math.max(base, amp) : base;
    data[o + 3] = 255;
  }
  return out;
}

/** PNG blob of an RGBA8 image (top-down). */
export async function pngBlob(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function rgbaToImageData(pixels, width, height) {
  return new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height);
}
