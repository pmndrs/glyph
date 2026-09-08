/** High-level TypeGPU integration. Reusable shader functions live on @pmndrs/glyph/shaders. */
export { defineTypeGpuConfig } from './typegpu/config.js';
export type {
  TypeGpuConfigOptions,
  TypeGpuDraw,
  TypeGpuPositionTransform,
  TypeGpuColorTransform,
  TypeGpuFontFormats,
  TypeGpuGlyphConfig,
  TypeGpuHandle,
  TypeGpuRoot,
} from './typegpu/config.js';
export type { TypeGpuFontSelection, TypeGpuText, TypeGpuTextOptions, TypeGpuTextUpdate } from './typegpu/text.js';
