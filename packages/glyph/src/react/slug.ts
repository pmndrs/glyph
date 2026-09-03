import type { Font } from '../font.js';
import type { FontFaceSource } from '../font-face.js';
import { useFont } from '../react.js';
import { slug } from '../three/slug.js';

/** Slug convenience hook over the shared R3F `useFont` cache. */
export interface UseSlug {
  (input: FontFaceSource): Font<typeof slug>;
  /** Start the same cached Slug load before a component requests it. */
  preload(input: FontFaceSource): Promise<void>;
  /** Release the cached Slug lease without invalidating mounted consumers. */
  clear(input: FontFaceSource): void;
}

/** Load one Slug font through the shared R3F cache. */
export const useSlug = ((input: FontFaceSource): Font<typeof slug> => useFont(input, { format: slug })) as UseSlug;
useSlug.preload = (input) => useFont.preload(input, { format: slug });
useSlug.clear = (input) => useFont.clear(input, { format: slug });
