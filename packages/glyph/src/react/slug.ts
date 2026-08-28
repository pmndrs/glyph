import type { Font } from '../font.js';
import type { FontLibrary, LoadFontInput } from '../loader.js';
import { useFont } from '../react.js';
import { slug } from '../three/slug.js';

/** Slug convenience hook over the shared provider-scoped `useFont` cache. */
export interface UseSlug {
  (input: LoadFontInput): Font<typeof slug>;
  preload(library: FontLibrary, input: LoadFontInput): Promise<void>;
  clear(library: FontLibrary, input: LoadFontInput): void;
}

/** Loads one Slug font through the nearest GlyphProvider using the shared React font cache. */
export const useSlug = ((input: LoadFontInput): Font<typeof slug> => useFont(slugRequest(input))) as UseSlug;
useSlug.preload = (library, input) => useFont.preload(library, slugRequest(input));
useSlug.clear = (library, input) => useFont.clear(library, slugRequest(input));

function slugRequest(input: LoadFontInput) {
  return { input, raster: { technique: slug } } as const;
}
