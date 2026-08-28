import type { Font } from '../font.js';
import type { FontLibrary, LoadFontInput } from '../loader.js';
import { bitmap, type BitmapTechniqueOptions } from '../three/bitmap.js';
import { useFont } from '../react.js';

/** Bitmap convenience hook over the shared provider-scoped `useFont` cache. */
export interface UseBitmapFont {
  (input: LoadFontInput, options: BitmapTechniqueOptions): Font<typeof bitmap>;
  preload(library: FontLibrary, input: LoadFontInput, options: BitmapTechniqueOptions): Promise<void>;
  clear(library: FontLibrary, input: LoadFontInput, options: BitmapTechniqueOptions): void;
}

/** Loads one Bitmap font through the nearest GlyphProvider using the shared React font cache. */
export const useBitmapFont = ((input: LoadFontInput, options: BitmapTechniqueOptions): Font<typeof bitmap> =>
  useFont(bitmapRequest(input, options))) as UseBitmapFont;
useBitmapFont.preload = (library, input, options) => useFont.preload(library, bitmapRequest(input, options));
useBitmapFont.clear = (library, input, options) => useFont.clear(library, bitmapRequest(input, options));

function bitmapRequest(input: LoadFontInput, options: BitmapTechniqueOptions) {
  return { input, raster: { technique: bitmap, options } } as const;
}
