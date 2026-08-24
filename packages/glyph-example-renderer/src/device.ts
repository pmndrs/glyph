import tgpu from 'typegpu';

import {
  glyphExampleFragment,
  glyphExampleTypeGpuVariant,
  glyphExampleVertex,
} from '@pmndrs/glyph-example-raster/typegpu';

import type { ExampleDrawList } from './draw-list.js';

export interface ExampleRendererShader {
  readonly variant: typeof glyphExampleTypeGpuVariant;
  readonly vertexWgsl: string;
  readonly fragmentWgsl: string;
}

export const exampleRendererShader: ExampleRendererShader = Object.freeze({
  variant: glyphExampleTypeGpuVariant,
  vertexWgsl: tgpu.resolve([glyphExampleVertex]),
  fragmentWgsl: tgpu.resolve([glyphExampleFragment]),
});

/** A narrow TypeGPU seam: the device owns resource, buffer, geometry, and submission work. */
export interface ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
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
  readonly shader: ExampleRendererShader = exampleRendererShader;
  readonly resources: Map<number, unknown> = new Map();
  readonly resourcesByName: Map<string, unknown> = new Map();
  readonly buffers: Map<number, Uint8Array> = new Map();
  readonly buffersByName: Map<string, Uint8Array> = new Map();
  readonly retirements: number[] = [];
  readonly submissions: ExampleDrawList[] = [];

  createResource(id: number, resource: unknown): void {
    this.resources.set(id, resource);
    this.resourcesByName.set(this.shader.variant.resource, resource);
  }

  writeBuffer(id: number, bytes: Uint8Array): void {
    const named = Object.entries(this.shader.variant.buffers).find(([, buffer]) => buffer.id === id)?.[0];
    const copy = bytes.slice();
    this.buffers.set(id, copy);
    if (named !== undefined) this.buffersByName.set(named, copy);
  }

  retireResource(id: number): void {
    this.resources.delete(id);
    this.resourcesByName.delete(this.shader.variant.resource);
    this.retirements.push(id);
  }

  submit(drawList: ExampleDrawList): void {
    this.submissions.push(drawList);
  }
}
