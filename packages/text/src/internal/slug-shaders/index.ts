/**
 * Internal Slug shaders. Adapted from three-flatland Slug at 2935a89f (MIT).
 *
 * `core/` holds the renderer-independent TypeGPU algorithm; the modules beside this
 * one bind it to Three.js nodes, TSL control flow, and this package's page textures.
 */
export {
  calcCoverage,
  calcRootCode,
  slugBandCurveCount,
  slugBandIndex,
  slugBandReferenceOffset,
  slugHorizontalCurveContribution,
  slugPixelsPerEm,
  slugReferenceFromPair,
  slugThickenFactor,
  slugVerticalCurveContribution,
  solveHorizontalPolynomial,
  solveVerticalPolynomial,
} from './core/index.js';
export { slugDilate } from './slug-dilate.js';
export {
  MAX_SAFE_SLUG_BAND_CURVES,
  slugRender,
  type SlugRenderOptions,
  type SlugShaderGlyph,
  type SlugShaderPage,
} from './slug-render.js';
