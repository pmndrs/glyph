/** Renderer-neutral construction helpers, schemas, and codecs for custom integrations. */
export * from './config/glyph.js';
export * from './config/codec.js';
export * from './config/codec-program.js';
export * from './config/schema.js';
export * from './config/resources.js';
export * from './config/raster.js';
export * from './config/raster-format.js';
export { bitmapSchema, bitmapCodec, selectBitmapStrikePpem } from './raster/bitmap.js';
export { msdfSchema, msdfCodec, MSDF_EM_SIZE, MSDF_PIXEL_RANGE, MSDF_GLYPH_RECORD_STRIDE } from './raster/msdf.js';
export { slugSchema, slugCodec, SLUG_GLYPH_RECORD_STRIDE, SLUG_PLANE_UNITS_PER_EM } from './raster/slug.js';
export { createGlyphPlacements } from './glyph-placement.js';
export type { GlyphLine, GlyphPlacement, GlyphPlacements, GlyphRun, GlyphSpace } from './glyph-placement.js';
