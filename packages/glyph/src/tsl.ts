/**
 * The technique shader library: TSL node graphs for the Bitmap, MSDF, Slug, and
 * decoration techniques, importable without the Three integration so any renderer
 * that consumes TSL — including future TypeGPU integrations — reuses one canonical
 * shading implementation per technique.
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
