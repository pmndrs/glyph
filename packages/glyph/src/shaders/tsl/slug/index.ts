/** Public Three TSL realization of the analytic Slug technique. */
export {
  slugShader,
  type TslSlugFillRule,
  type TslSlugInstanceNodes,
  type TslSlugPageResources,
  type TslSlugShaderOutput,
  type TslSlugShaderResources,
} from './shader.js';

/** Reusable Slug primitives for custom TSL material graphs. */
export {
  calcCoverage,
  calcRootCode,
  MAX_SAFE_SLUG_BAND_CURVES,
  slugDilate,
  slugDilateMatrix,
  slugRender,
  solveHorizontalPolynomial,
  solveVerticalPolynomial,
  type SlugRenderOptions,
  type SlugShaderGlyph,
  type SlugShaderPage,
} from './primitives.js';
