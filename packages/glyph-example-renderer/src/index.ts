/**
 * An example engine consumer built on `@pmndrs/glyph/core` alone.
 *
 * It exists to keep the engine-integration surface honest: if a second renderer cannot
 * be written against `/core` without reaching into package internals, this package
 * stops compiling. See `docs/planning/example-renderer.md`.
 */
export type { ExampleDraw, ExampleDrawList, ExamplePrimitiveRecord, ExampleResourceRecord } from './draw-list.js';
export { decodeDraw } from './draw-list.js';
export {
  ExampleText,
  ExampleTextEngine,
  type ExampleFrameInput,
  type ExampleTextOptions,
  type ExampleTextUpdate,
} from './engine.js';
export type { OwnedTextEnginePublication } from '@pmndrs/glyph/core';
export { readDrawList } from './plan-reader.js';
export type { ExampleTableSnapshot } from './snapshot.js';
export {
  exampleRendererShader,
  getExampleRendererShader,
  type ExampleDrawBindings,
  type ExampleGeometry,
  type ExamplePendingResources,
  type ExamplePendingSubmission,
  type ExampleRealizedDraw,
  RecordingExampleRendererDevice,
  type ExampleRendererDevice,
  type ExampleRendererResourceInput,
  type ExampleRendererShader,
  type RecordingPendingSubmission,
} from './device.js';
export { TypeGpuExampleRendererDevice, type TypeGpuExampleRendererDeviceOptions } from './webgpu-device.js';
