/**
 * The GPU seam. A TypeGPU backend implements this; nothing above it knows the device.
 *
 * Kept deliberately narrow so the engine-integration surface can be proven without a
 * device present, and so this package adds no renderer dependency of its own.
 */
import type { ExampleDrawList } from './draw-list.js';

export interface ExampleRendererDevice {
  /** Upload or update one plan buffer. `id` is the engine's buffer id. */
  writeBuffer(id: number, bytes: Uint8Array): void;
  /** Release a resource the engine retired. */
  retireResource(id: number): void;
  /** Issue the publication's draws in `orderToken` order. */
  submit(drawList: ExampleDrawList): void;
}
