/**
 * The TypeGPU technique shader library: the Bitmap, MSDF, Slug, and decoration techniques realized as typed TypeGPU
 * functions, importable without any renderer or scene integration. A host that owns a `GPUDevice` and a render pass
 * reuses one canonical shading implementation per technique instead of reimplementing coverage math.
 *
 * The surface mirrors `/tsl` in every structural respect: technique shader realizations only, no engine driving, no
 * renderer ownership. Where `/tsl` builds three.js node graphs from pre-resolved nodes, this subpath exports TypeGPU
 * schemas and functions a host composes into its own entry points.
 */
export {
  bitmapAtlasUv,
  bitmapFragment,
  bitmapPaint,
  bitmapPageCoverage,
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
  calcRootCode,
  calcSlugCoverage,
  evaluateHorizontalSlugBand,
  evaluateVerticalSlugBand,
  loadSlugCurve,
  loadSlugHeader,
  loadSlugReference,
  MAX_SAFE_SLUG_BAND_CURVES,
  slugDilate,
  slugDilateMatrix,
  slugFragment,
  slugGridCoordinate,
  slugStemDarken,
  slugThickenFactor,
  slugVertex,
  slugVertexMatrix,
  stableRoots,
  solveHorizontalPolynomial,
  solveVerticalPolynomial,
  TypeGpuSlugBandEvaluation,
  TypeGpuSlugCurve,
  TypeGpuSlugFragmentInput,
  TypeGpuSlugFragmentOutput,
  TypeGpuSlugGlyphAddressing,
  TypeGpuSlugInstance,
  TypeGpuSlugMatrixVertexInput,
  TypeGpuSlugPageLayout,
  TypeGpuSlugPlacement,
  TypeGpuSlugVertexInput,
  TypeGpuSlugVertexOutput,
} from './typegpu/slug-shader.js';
