/** Renderer-free TypeGPU shader functions — shader code only, no engine driving or renderer objects; a TypeGPU host composes these into its own pipeline. */
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
