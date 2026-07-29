/** Internal Slug TSL primitives. Adapted from three-flatland Slug at 2935a89f (MIT). */
export { calcCoverage } from './calc-coverage.js'
export { calcRootCode } from './calc-root-code.js'
export { slugDilate } from './slug-dilate.js'
export {
  MAX_SAFE_SLUG_BAND_CURVES,
  slugRender,
  type SlugRenderOptions,
  type SlugShaderGlyph,
  type SlugShaderPage,
} from './slug-render.js'
export { solveHorizontalPolynomial, solveVerticalPolynomial } from './solve-quadratic.js'
