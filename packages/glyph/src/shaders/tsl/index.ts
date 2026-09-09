/** TSL shader library for Bitmap, MSDF, Slug, and decoration — importable without the Three integration; reuse this canonical implementation rather than reimplementing coverage math. */
export {
  bitmapShader,
  type TslBitmapInstanceNodes,
  type TslBitmapShaderOptions,
  type TslBitmapShaderOutput,
  type TslBitmapShaderResources,
} from './bitmap-shader.js';
export {
  msdfShader,
  type TslMsdfInstanceNodes,
  type TslMsdfShaderOutput,
  type TslMsdfShaderResources,
} from './msdf-shader.js';
export {
  slugShader,
  type TslSlugFillRule,
  type TslSlugInstanceNodes,
  type TslSlugPageResources,
  type TslSlugShaderOutput,
  type TslSlugShaderResources,
} from './slug/index.js';
export {
  decorationShader,
  type TslDecorationInstanceNodes,
  type TslDecorationShaderOutput,
} from './decoration-shader.js';
