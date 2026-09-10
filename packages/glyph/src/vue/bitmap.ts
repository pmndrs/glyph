import type { FontFaceSource } from '../font-face.js';
import { bitmap, type BitmapFormatOptions } from '../raster/bitmap.js';
import { clearFont, preloadFont, useFont, type UseFontResult } from '../vue.js';

/** Load one Bitmap font through the shared Vue font resource. */
export function useBitmap(input: FontFaceSource, options: BitmapFormatOptions): UseFontResult<typeof bitmap> {
  return useFont(input, { format: bitmap(options) });
}

/** Start the same cached Bitmap load before a component requests it. */
export function preloadBitmap(input: FontFaceSource, options: BitmapFormatOptions): Promise<void> {
  return preloadFont(input, { format: bitmap(options) });
}

/** Release the cached Bitmap lease without invalidating mounted consumers. */
export function clearBitmap(input: FontFaceSource, options: BitmapFormatOptions): void {
  clearFont(input, { format: bitmap(options) });
}
