/** Reusable TypeGPU realization of the analytic Slug technique. */
export {
  MAX_SAFE_SLUG_BAND_CURVES,
  slugRender,
  slugRenderWithOptions,
  SlugShaderGlyph,
  type SlugShaderPage,
} from './slug-render.js';
export {
  loadCurve,
  loadHeader,
  loadReference,
  SlugShaderCurve,
  slugCurveTexelSlot,
  slugCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugReferenceTexelSlot,
  slugReferenceWidthAccessor,
} from './slug-texture.js';
export {
  slugBandCurveCount,
  slugBandIndex,
  slugBandReferenceOffset,
  slugHorizontalCurveContribution,
  slugPixelsPerEm,
  slugReferenceFromPair,
  slugThickenFactor,
  slugVerticalCurveContribution,
} from './core/band.js';
export { calcCoverage } from './core/coverage.js';
export { slugDilate, slugDilateMatrix } from './core/dilate.js';
export { calcRootCode } from './core/root-code.js';
export { solveHorizontalPolynomial, solveVerticalPolynomial, stableRoots } from './core/solve-quadratic.js';
