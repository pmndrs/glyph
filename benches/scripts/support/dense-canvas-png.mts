import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

const SIZE = 1536;
const MAX_PNG_BYTES = 32 * 1024 * 1024;

/** Decode a post-timing canvas screenshot and prove it contains visible pixels across the fixed grid. */
export async function inspectDenseCanvasPng(
  page: Page,
  png: Uint8Array,
): Promise<{
  readonly width: number;
  readonly height: number;
  readonly pngSha256: string;
  readonly foregroundPixels: number;
  readonly foregroundBounds: readonly [number, number, number, number] | null;
}> {
  if (png.byteLength === 0 || png.byteLength > MAX_PNG_BYTES)
    throw new Error('Dense canvas PNG exceeds capture bounds');
  const decoded = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    if (image.width !== 1536 || image.height !== 1536) throw new Error('Dense canvas screenshot dimensions differ');
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('Could not decode dense canvas screenshot');
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    let foregroundPixels = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        if (Math.max(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0) < 110) continue;
        foregroundPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return {
      width: image.width,
      height: image.height,
      foregroundPixels,
      foregroundBounds: maxX < 0 ? null : ([minX, minY, maxX, maxY] as const),
    };
  }, Buffer.from(png).toString('base64'));
  if (decoded.width !== SIZE || decoded.height !== SIZE || decoded.foregroundPixels === 0) {
    throw new Error('Dense browser canvas screenshot is blank or incorrectly sized');
  }
  const bounds = decoded.foregroundBounds;
  if (bounds === null || bounds[0] >= 48 || bounds[1] >= 48 || bounds[2] < SIZE - 48 || bounds[3] < SIZE - 48) {
    throw new Error('Dense canvas screenshot does not cover the fixed 32x32 grid');
  }
  return { ...decoded, pngSha256: createHash('sha256').update(png).digest('hex') };
}
