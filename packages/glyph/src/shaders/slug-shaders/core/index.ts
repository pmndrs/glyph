/**
 * Host-agnostic Slug shader core. Adapted from three-flatland Slug at 2935a89f (MIT).
 *
 * Every function here is a TypeGPU shader function over plain values, so the fill
 * algorithm is shared by any WebGPU, WebGL, TypeGPU, or Three.js host. Nothing in
 * this directory imports a renderer, and nothing here reads a resource: texture or
 * buffer layout stays with the host that owns it.
 */
export {
  MAX_SAFE_SLUG_BAND_CURVES,
  slugBandCurveCount,
  slugBandIndex,
  slugBandReferenceOffset,
  slugHorizontalCurveContribution,
  slugPixelsPerEm,
  slugReferenceFromPair,
  slugThickenFactor,
  slugVerticalCurveContribution,
} from './band.js';
export { calcCoverage } from './coverage.js';
export { slugDilate, slugDilateMatrix } from './dilate.js';
export { calcRootCode } from './root-code.js';
export { solveHorizontalPolynomial, solveVerticalPolynomial, stableRoots } from './solve-quadratic.js';
