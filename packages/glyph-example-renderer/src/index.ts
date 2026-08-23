/**
 * An example engine consumer built on `@pmndrs/glyph/core` alone.
 *
 * It exists to keep the engine-integration surface honest: if a second renderer cannot
 * be written against `/core` without reaching into package internals, this package
 * stops compiling. See `docs/planning/example-renderer.md`.
 */
export type { ExampleDraw, ExampleDrawList, ExampleTableSnapshot } from './draw-list.js';
export type { ExampleRendererDevice } from './device.js';
export { readDrawList } from './plan-reader.js';
