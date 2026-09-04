import type { Font } from '../font.js';
import type { FontFaceSource } from '../font-face.js';
import { useFont } from '../react.js';
import { slug } from '../raster/slug.js';

/** Slug convenience hook over the shared `useFont` Suspense resource. */
export interface UseSlug {
  (input: FontFaceSource): Font<typeof slug>;
  /** Start the same cached Slug load before a component requests it. */
  preload(input: FontFaceSource): Promise<void>;
  /** Release the cached Slug lease without invalidating mounted consumers. */
  clear(input: FontFaceSource): void;
}

/** Load one Slug font through the shared React Suspense resource. */
export const useSlug: UseSlug = Object.assign(
  function useSlug(input: FontFaceSource): Font<typeof slug> {
    return useFont(input, { format: slug });
  },
  {
    preload: (input: FontFaceSource) => useFont.preload(input, { format: slug }),
    clear: (input: FontFaceSource) => useFont.clear(input, { format: slug }),
  },
);
