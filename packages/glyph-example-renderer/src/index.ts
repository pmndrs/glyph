/** A custom renderer built only from the public root GlyphConfig vocabulary — a compile-time canary that the surface is sufficient without reaching into package internals. */
export type { ExampleDraw, ExampleDrawList, ExamplePrimitiveRecord, ExampleResourceRecord } from './draw-list.js';
export {
  ExampleText,
  type ExampleFontFaceSelection,
  type ExampleTextOptions,
  type ExampleTextUpdate,
} from './engine.js';
export {
  defineExampleConfig,
  type ExampleBindings,
  ExampleFontFormats,
  type ExampleGlyphConfig,
  type ExampleHandle,
  type ExampleRoot,
  type ExampleRootContext,
  type ExampleResolvedResource,
} from './config.js';
export {
  exampleRendererShader,
  getExampleRendererShader,
  type ExampleDrawBindings,
  type ExampleGeometry,
  type ExamplePendingSubmission,
  type ExampleRealizedDraw,
  RecordingExampleRendererDevice,
  type ExampleRendererDevice,
  type ExampleRendererShader,
  type RecordingPendingSubmission,
} from './device.js';
export { TypeGpuExampleRendererDevice, type TypeGpuExampleRendererDeviceOptions } from './webgpu-device.js';
