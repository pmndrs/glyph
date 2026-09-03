/**
 * The shader library: TSL node graphs for the Bitmap, MSDF, and Slug raster formats plus
 * the decoration program, importable without the Three scene integration. The graphs
 * build on `three/tsl` nodes; an integration that renders through a TSL-consuming
 * renderer reuses one canonical shading implementation per program instead of
 * reimplementing coverage math.
 */
export {
  bitmapShader,
  type TslBitmapInstanceNodes,
  type TslBitmapShaderOptions,
  type TslBitmapShaderOutput,
  type TslBitmapShaderResources,
} from './tsl/bitmap-shader.js';
export {
  msdfShader,
  type TslMsdfInstanceNodes,
  type TslMsdfShaderOutput,
  type TslMsdfShaderResources,
} from './tsl/msdf-shader.js';
export {
  slugShader,
  type TslSlugFillRule,
  type TslSlugInstanceNodes,
  type TslSlugPageResources,
  type TslSlugShaderOutput,
  type TslSlugShaderResources,
} from './tsl/slug-shader.js';
export {
  decorationShader,
  type TslDecorationInstanceNodes,
  type TslDecorationShaderOutput,
} from './tsl/decoration-shader.js';
