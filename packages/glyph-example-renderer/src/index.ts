/**
 * An example engine consumer built on `@pmndrs/glyph/core` alone.
 *
 * It exists to keep the engine-integration surface honest: if a second renderer cannot
 * be written against `/core` without reaching into package internals, this package
 * stops compiling. See `docs/planning/example-renderer.md`.
 */
export type { ExampleDraw, ExampleDrawList, ExamplePrimitiveRecord, ExampleResourceRecord } from './draw-list.js';
export { ExampleText, type ExampleTextOptions, type ExampleTextUpdate } from './engine.js';
export {
  defineExampleConfig,
  type ExampleBindings,
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
