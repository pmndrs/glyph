/**
 * Renderer-free TypeGPU shader functions. Bitmap is the currently published built-in realization; other raster formats may
 * publish TypeGPU, TSL, WGSL, GLSL, or engine-authored variants without changing their portable raster contracts.
 *
 * This subpath owns shader code only—no engine driving or renderer objects. A TypeGPU host composes the exported schemas
 * and functions into its own entry points, bindings, pipeline, and submission lifecycle.
 */
export {
  bitmapAtlasUv,
  bitmapCoverageOpacity,
  bitmapCoverageSlot,
  bitmapFragment,
  bitmapPageAccessor,
  bitmapPaint,
  bitmapPaintCoverageOpacity,
  bitmapPageCoverage,
  bitmapPageTexelCoordinate,
  bitmapQuadPosition,
  bitmapVertex,
  bitmapVertexSnapped,
  projectClipPosition,
  snapClipAxis,
  TypeGpuBitmapFragmentInput,
  TypeGpuBitmapFragmentOutput,
  TypeGpuBitmapInstance,
  TypeGpuBitmapPageLayout,
  TypeGpuBitmapVertexInput,
  TypeGpuBitmapVertexOutput,
} from './typegpu/bitmap-shader.js';
export {
  MsdfCompositeInput,
  MsdfCoverageInput,
  MsdfRenderInput,
  msdfAtlasCoordinate,
  msdfAtlasSizeAccessor,
  msdfClampedCoordinates,
  msdfComposite,
  msdfCoverage,
  msdfFragment,
  msdfPixelRangeAccessor,
  msdfPosition,
  msdfRender,
  msdfRenderDetailed,
  msdfSampleSlot,
  msdfVertex,
  TypeGpuMsdfFragmentInput,
  TypeGpuMsdfFragmentOutput,
  TypeGpuMsdfInstance,
  TypeGpuMsdfVertexInput,
  TypeGpuMsdfVertexOutput,
  type MsdfRenderInput as TypeGpuMsdfRenderInput,
} from './typegpu/msdf-shader.js';
export {
  calcCoverage as slugCoverage,
  calcRootCode as slugRootCode,
  slugBandCurveCount,
  slugBandIndex,
  slugBandReferenceOffset,
  slugDilate,
  slugDilateMatrix,
  slugHorizontalCurveContribution,
  slugPixelsPerEm,
  slugReferenceFromPair,
  slugThickenFactor,
  slugVerticalCurveContribution,
  solveHorizontalPolynomial as solveSlugHorizontalPolynomial,
  solveVerticalPolynomial as solveSlugVerticalPolynomial,
} from './typegpu/slug-shaders/core/index.js';
export {
  MAX_SAFE_SLUG_BAND_CURVES,
  slugRender,
  slugRenderWithOptions,
  SlugShaderGlyph,
  type SlugShaderPage,
} from './typegpu/slug-shaders/slug-render.js';
export {
  slugCurveTexelSlot,
  slugCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugReferenceTexelSlot,
  slugReferenceWidthAccessor,
} from './typegpu/slug-shaders/slug-texture.js';
export {
  decorationPaint,
  decorationPosition,
  decorationShader,
  TypeGpuDecorationInput,
  TypeGpuDecorationOutput,
} from './typegpu/decoration-shader.js';
