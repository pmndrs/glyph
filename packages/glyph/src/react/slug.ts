import type { Font } from '../font.js';
import type { FontFaceSource } from '../font-face.js';
import { useFont } from '../react.js';
import { slug, type SlugOptions } from '../raster/slug.js';

/** Slug convenience hook over the shared `useFont` Suspense resource. */
export interface UseSlug {
  (input: FontFaceSource, options?: SlugOptions): Font<typeof slug>;
  /** Start the same cached Slug load before a component requests it. */
  preload(input: FontFaceSource, options?: SlugOptions): Promise<void>;
  /** Release the cached Slug lease without invalidating mounted consumers. */
  clear(input: FontFaceSource, options?: SlugOptions): void;
}

/** Load one Slug font through the shared React Suspense resource. */
export const useSlug: UseSlug = Object.assign(
  function useSlug(input: FontFaceSource, options?: SlugOptions): Font<typeof slug> {
    return useFont(input, { format: options === undefined ? slug : slug(options) });
  },
  {
    preload: (input: FontFaceSource, options?: SlugOptions) =>
      useFont.preload(input, { format: options === undefined ? slug : slug(options) }),
    clear: (input: FontFaceSource, options?: SlugOptions) =>
      useFont.clear(input, { format: options === undefined ? slug : slug(options) }),
  },
);
