/**
 * Renderer-free TypeGPU shader functions. Bitmap is the currently published built-in realization; other techniques may
 * publish TypeGPU, TSL, WGSL, GLSL, or engine-authored variants without changing their portable plan contracts.
 *
 * This subpath owns shader code only—no engine driving or renderer objects. A TypeGPU host composes the exported schemas
 * and functions into its own entry points, bindings, pipeline, and submission lifecycle.
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
