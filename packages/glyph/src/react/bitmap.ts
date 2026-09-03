import type { Font } from '../font.js';
import type { FontFaceSource } from '../font-face.js';
import { bitmap, type BitmapFormatOptions } from '../three/bitmap.js';
import { useFont } from '../react.js';

/** Bitmap convenience hook over the shared R3F `useFont` cache. */
export interface UseBitmap {
  (input: FontFaceSource, options: BitmapFormatOptions): Font<typeof bitmap>;
  /** Start the same cached Bitmap load before a component requests it. */
  preload(input: FontFaceSource, options: BitmapFormatOptions): Promise<void>;
  /** Release the cached Bitmap lease without invalidating mounted consumers. */
  clear(input: FontFaceSource, options: BitmapFormatOptions): void;
}

/** Load one Bitmap font through the shared R3F cache. */
export const useBitmap = ((input: FontFaceSource, options: BitmapFormatOptions): Font<typeof bitmap> =>
  useFont(input, { format: { raster: bitmap, options } })) as UseBitmap;
useBitmap.preload = (input, options) => useFont.preload(input, { format: { raster: bitmap, options } });
useBitmap.clear = (input, options) => useFont.clear(input, { format: { raster: bitmap, options } });
