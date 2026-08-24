/**
 * The GPU seam. A TypeGPU backend implements this; nothing above it knows the device.
 *
 * Kept deliberately narrow so the engine-integration surface can be proven without a
 * device present, and so this package adds no renderer dependency of its own.
 */
import type { ExampleDrawList } from './draw-list.js';

export interface ExampleRendererDevice {
  /** Materialize one portable raster payload under the engine's resource identity. */
  createResource(id: number, resource: unknown): void;
  /** Upload or update one plan buffer. `id` is the engine's buffer id. */
  writeBuffer(id: number, bytes: Uint8Array): void;
  /** Release a resource the engine retired. */
  retireResource(id: number): void;
  /** Issue the publication's draws in `orderToken` order. */
  submit(drawList: ExampleDrawList): void;
}

/** A concrete device used by the acceptance path; a real backend can implement the same seam. */
export class RecordingExampleRendererDevice implements ExampleRendererDevice {
  readonly resources: Map<number, unknown> = new Map();
  readonly buffers: Map<number, Uint8Array> = new Map();
  readonly retirements: number[] = [];
  readonly submissions: ExampleDrawList[] = [];

  createResource(id: number, resource: unknown): void {
    this.resources.set(id, resource);
  }

  writeBuffer(id: number, bytes: Uint8Array): void {
    this.buffers.set(id, bytes.slice());
  }

  retireResource(id: number): void {
    this.resources.delete(id);
    this.retirements.push(id);
  }

  submit(drawList: ExampleDrawList): void {
    this.submissions.push(drawList);
  }
}
