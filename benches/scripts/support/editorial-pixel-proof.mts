import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

const MAX_EDITORIAL_PIXELS = 2_000_000;
const MAX_PNG_BYTES = 32 * 1024 * 1024;

export interface EditorialPixels {
  readonly width: number;
  readonly height: number;
  readonly rgbaSha256: string;
  readonly foregroundPixels: number;
  readonly foregroundBounds: readonly [number, number, number, number] | null;
}

/** Decodes the browser-composited PNG, then hashes the RGBA bytes that comparisons actually inspect. */
export async function inspectEditorialPng(page: Page, png: Uint8Array): Promise<EditorialPixels> {
  if (png.byteLength > MAX_PNG_BYTES) throw new Error('Editorial PNG exceeds the bounded capture size');
  const decoded = await page.evaluate(
    async ({ encoded, maxPixels }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      if (image.width <= 0 || image.height <= 0 || image.width * image.height > maxPixels) {
        throw new Error('Editorial PNG dimensions exceed the bounded canvas capture');
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('Editorial PNG could not be decoded to RGBA');
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, image.width, image.height).data;
      let binary = '';
      for (let offset = 0; offset < rgba.length; offset += 32_768) {
        binary += String.fromCharCode(...rgba.subarray(offset, offset + 32_768));
      }
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
        rgbaBase64: btoa(binary),
        foregroundPixels,
        foregroundBounds: maxX < 0 ? null : ([minX, minY, maxX, maxY] as const),
      };
    },
    { encoded: Buffer.from(png).toString('base64'), maxPixels: MAX_EDITORIAL_PIXELS },
  );
  const rgba = Buffer.from(decoded.rgbaBase64, 'base64');
  if (rgba.byteLength !== decoded.width * decoded.height * 4) {
    throw new Error('Editorial PNG decoder returned an incomplete RGBA buffer');
  }
  return {
    width: decoded.width,
    height: decoded.height,
    rgbaSha256: createHash('sha256').update(rgba).digest('hex'),
    foregroundPixels: decoded.foregroundPixels,
    foregroundBounds: decoded.foregroundBounds,
  };
}

export interface EditorialPixelDiff {
  readonly differentPixels: number;
  readonly differentChannels: number;
  readonly maximumChannelDelta: number;
  readonly meanChannelDelta: number;
  readonly differenceBounds: readonly [number, number, number, number] | null;
}

/** Zero tolerance: a different decoded channel is reported and fails the comparison. */
export async function compareEditorialPngs(
  page: Page,
  reference: Uint8Array,
  candidate: Uint8Array,
): Promise<EditorialPixelDiff> {
  if (reference.byteLength > MAX_PNG_BYTES || candidate.byteLength > MAX_PNG_BYTES) {
    throw new Error('Editorial PNG exceeds the bounded capture size');
  }
  return page.evaluate(
    async ({ referencePng, candidatePng, maxPixels }) => {
      const decode = async (encoded: string): Promise<ImageData> => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        if (image.width <= 0 || image.height <= 0 || image.width * image.height > maxPixels) {
          throw new Error('Editorial PNG dimensions exceed the bounded canvas capture');
        }
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) throw new Error('Editorial PNG could not be decoded for comparison');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const [left, right] = await Promise.all([decode(referencePng), decode(candidatePng)]);
      if (left.width !== right.width || left.height !== right.height) {
        throw new Error(
          `Editorial PNG dimensions differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`,
        );
      }
      let differentPixels = 0;
      let differentChannels = 0;
      let maximumChannelDelta = 0;
      let sumChannelDelta = 0;
      let minX = left.width;
      let minY = left.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < left.height; y += 1) {
        for (let x = 0; x < left.width; x += 1) {
          const offset = (y * left.width + x) * 4;
          let changed = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs((left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0));
            if (delta === 0) continue;
            changed = true;
            differentChannels += 1;
            maximumChannelDelta = Math.max(maximumChannelDelta, delta);
            sumChannelDelta += delta;
          }
          if (!changed) continue;
          differentPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return {
        differentPixels,
        differentChannels,
        maximumChannelDelta,
        meanChannelDelta: sumChannelDelta / (left.data.length || 1),
        differenceBounds: maxX < 0 ? null : ([minX, minY, maxX, maxY] as const),
      };
    },
    {
      referencePng: Buffer.from(reference).toString('base64'),
      candidatePng: Buffer.from(candidate).toString('base64'),
      maxPixels: MAX_EDITORIAL_PIXELS,
    },
  );
}
