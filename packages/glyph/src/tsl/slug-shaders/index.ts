/**
 * Internal Slug shaders. Adapted from three-flatland Slug at 2935a89f (MIT).
 *
 * The renderer-independent algorithm lives under `/typegpu`; this directory contains
 * only the Three/TSL adapter.
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
} from '../../typegpu/slug-shaders/core/index.js';
export { slugDilate, slugDilateMatrix } from './slug-dilate.js';
export {
  MAX_SAFE_SLUG_BAND_CURVES,
  slugRender,
  slugRenderWithOptions,
  SlugShaderGlyph,
  type SlugShaderPage,
} from '../../typegpu/slug-shaders/slug-render.js';
export {
  slugCurveTexelSlot,
  slugCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugReferenceTexelSlot,
  slugReferenceWidthAccessor,
} from '../../typegpu/slug-shaders/slug-texture.js';
