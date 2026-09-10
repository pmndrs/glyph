import type { FontFaceSource } from '../font-face.js';
import { slug, type SlugOptions } from '../raster/slug.js';
import { clearFont, preloadFont, useFont, type UseFontResult } from '../vue.js';

/** Load one Slug font through the shared Vue font resource. */
export function useSlug(input: FontFaceSource, options?: SlugOptions): UseFontResult<typeof slug> {
  return useFont(input, { format: options === undefined ? slug : slug(options) });
}

/** Start the same cached Slug load before a component requests it. */
export function preloadSlug(input: FontFaceSource, options?: SlugOptions): Promise<void> {
  return preloadFont(input, { format: options === undefined ? slug : slug(options) });
}

/** Release the cached Slug lease without invalidating mounted consumers. */
export function clearSlug(input: FontFaceSource, options?: SlugOptions): void {
  clearFont(input, { format: options === undefined ? slug : slug(options) });
}
