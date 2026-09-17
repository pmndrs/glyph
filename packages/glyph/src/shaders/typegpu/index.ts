/**
 * Renderer-free TypeGPU shader functions. Hosts may
 * publish TypeGPU, TSL, WGSL, GLSL, or engine-authored variants without changing their portable raster contracts.
 *
 * This subpath owns shader code only—no engine driving or renderer objects. A TypeGPU host composes the exported schemas
 * and functions into its own entry points, bindings, pipeline, and submission lifecycle.
 */
export {
  bitmapCoverageSlot,
  bitmapFragment,
  bitmapPageAccessor,
  bitmapVertex,
  bitmapVertexSnapped,
  TypeGpuBitmapFragmentInput,
  TypeGpuBitmapFragmentOutput,
  TypeGpuBitmapInstance,
  TypeGpuBitmapPageLayout,
  TypeGpuBitmapVertexInput,
  TypeGpuBitmapVertexOutput,
} from './bitmap-shader.js';
export {
  MsdfCompositeInput,
  MsdfCoverageInput,
  msdfAtlasSizeAccessor,
  msdfComposite,
  msdfCoverage,
  msdfFragment,
  msdfPixelRangeAccessor,
  msdfRenderDetailed,
  msdfSampleSlot,
  msdfVertex,
  TypeGpuMsdfFragmentInput,
  TypeGpuMsdfFragmentOutput,
  TypeGpuMsdfInstance,
  TypeGpuMsdfVertexInput,
  TypeGpuMsdfVertexOutput,
  type MsdfRenderInput as TypeGpuMsdfRenderInput,
} from './msdf-shader.js';
export { slugDilate, slugDilateMatrix } from './slug/core/index.js';
export { slugRender, slugRenderWithOptions, SlugShaderGlyph, type SlugShaderPage } from './slug/slug-render.js';
export {
  slugCurveTexelSlot,
  slugCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugReferenceTexelSlot,
  slugReferenceWidthAccessor,
} from './slug/slug-texture.js';
export { decorationShader, TypeGpuDecorationInput, TypeGpuDecorationOutput } from './decoration-shader.js';
export type { BitmapCoverageSource } from './bitmap-shader.js';
export type { MsdfSampleSource } from './msdf-shader.js';
