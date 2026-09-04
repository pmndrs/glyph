import type { Font } from '../font.js';
import type { FontFaceSource } from '../font-face.js';
import { bitmap, type BitmapFormatOptions } from '../raster/bitmap.js';
import { useFont } from '../react.js';

/** Bitmap convenience hook over the shared `useFont` Suspense resource. */
export interface UseBitmap {
  (input: FontFaceSource, options: BitmapFormatOptions): Font<typeof bitmap>;
  /** Start the same cached Bitmap load before a component requests it. */
  preload(input: FontFaceSource, options: BitmapFormatOptions): Promise<void>;
  /** Release the cached Bitmap lease without invalidating mounted consumers. */
  clear(input: FontFaceSource, options: BitmapFormatOptions): void;
}

/** Load one Bitmap font through the shared React Suspense resource. */
export const useBitmap: UseBitmap = Object.assign(
  function useBitmap(input: FontFaceSource, options: BitmapFormatOptions): Font<typeof bitmap> {
    return useFont(input, { format: bitmap(options) });
  },
  {
    preload: (input: FontFaceSource, options: BitmapFormatOptions) =>
      useFont.preload(input, { format: bitmap(options) }),
    clear: (input: FontFaceSource, options: BitmapFormatOptions) => useFont.clear(input, { format: bitmap(options) }),
  },
);
