import tgpu from 'typegpu';

import {
  assertPortableResource,
  type PortableGeometryPayload,
  type TechniqueGeometryDeclaration,
} from '@pmndrs/glyph/core';
import {
  glyphExampleFragment,
  glyphExampleTypeGpuVariant,
  glyphExampleVertex,
} from '@pmndrs/glyph-example-raster/typegpu';

import type { ExampleDraw, ExampleDrawList, ExamplePrimitiveRecord } from './draw-list.js';

export interface ExampleRendererShader {
  readonly variant: typeof glyphExampleTypeGpuVariant;
  readonly vertexWgsl: string;
  readonly fragmentWgsl: string;
}

let resolvedExampleRendererShader: ExampleRendererShader | undefined;

/** Resolve WGSL only when a device actually selects the TypeGPU realization. */
export function getExampleRendererShader(): ExampleRendererShader {
  if (resolvedExampleRendererShader === undefined) {
    resolvedExampleRendererShader = Object.freeze({
      variant: glyphExampleTypeGpuVariant,
      vertexWgsl: tgpu.resolve([glyphExampleVertex]),
      fragmentWgsl: tgpu.resolve([glyphExampleFragment]),
    });
  }
  return resolvedExampleRendererShader;
}

export const exampleRendererShader: ExampleRendererShader = Object.freeze({
  variant: glyphExampleTypeGpuVariant,
  get vertexWgsl() {
    return getExampleRendererShader().vertexWgsl;
  },
  get fragmentWgsl() {
    return getExampleRendererShader().fragmentWgsl;
  },
});

/** A narrow TypeGPU seam: the device owns resource, buffer, geometry, and submission work. */
export interface ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
  /** Materialize one portable raster payload under its engine and schema identities. */
  createResource(id: number, name: string, resource: unknown, generation?: number): void;
  /** Upload or update one plan buffer. `id` is the engine's buffer id. */
  writeBuffer(id: number, bytes: Uint8Array): void;
  /** Release a resource only when the retired generation still owns the id. */
  retireResource(id: number, generation: number): void;
  /** Issue the publication's draws in `orderToken` order. */
  submit(drawList: ExampleDrawList): void;
}

/** A concrete device used by the acceptance path; a real backend can implement the same seam. */
export class RecordingExampleRendererDevice implements ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
  readonly resources: Map<number, unknown> = new Map();
  readonly resourcesByName: Map<string, unknown> = new Map();
  readonly geometriesByName: Map<string, ExampleGeometry> = new Map();
  readonly buffers: Map<number, Uint8Array> = new Map();
  readonly buffersByName: Map<string, Uint8Array> = new Map();
  readonly retirements: number[] = [];
  readonly submissions: ExampleDrawList[] = [];
  readonly realizedDraws: ExampleRealizedDraw[] = [];
  readonly #resourceNames = new Map<number, string>();
  readonly #resourceGenerations = new Map<number, number>();
  readonly #resourceIds = new Map<string, number>();

  constructor(shader: ExampleRendererShader = exampleRendererShader) {
    this.shader = shader;
  }

  createResource(id: number, name: string, resource: unknown, generation = 1): void {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new RangeError('example renderer resource ids must be positive integers');
    if (typeof name !== 'string' || name.length === 0)
      throw new TypeError('example renderer resource names are required');
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new RangeError('example renderer resource generations must be positive integers');
    const previousName = this.#resourceNames.get(id);
    if (previousName !== undefined && previousName !== name) {
      throw new Error(`example renderer resource id ${id} is already bound to "${previousName}"`);
    }
    const previousId = this.#resourceIds.get(name);
    if (previousId !== undefined && previousId !== id) {
      throw new Error(`example renderer resource "${name}" is already bound to id ${previousId}`);
    }
    this.resources.set(id, resource);
    this.resourcesByName.set(name, resource);
    this.#resourceNames.set(id, name);
    this.#resourceGenerations.set(id, generation);
    this.#resourceIds.set(name, id);
    if (this.shader.variant.geometryResource === name) {
      this.geometriesByName.set(name, realizeGeometry(this.shader.variant.geometry, name, resource));
    }
  }

  writeBuffer(id: number, bytes: Uint8Array): void {
    const named = Object.entries(this.shader.variant.buffers).find(([, buffer]) => buffer.id === id)?.[0];
    const copy = bytes.slice();
    this.buffers.set(id, copy);
    if (named !== undefined) this.buffersByName.set(named, copy);
  }

  retireResource(id: number, generation: number): void {
    if (this.#resourceGenerations.get(id) !== generation) return;
    const name = this.#resourceNames.get(id);
    this.resources.delete(id);
    if (name !== undefined) {
      this.resourcesByName.delete(name);
      this.geometriesByName.delete(name);
      if (this.#resourceIds.get(name) === id) this.#resourceIds.delete(name);
      this.#resourceNames.delete(id);
    }
    this.#resourceGenerations.delete(id);
    this.retirements.push(id);
  }

  submit(drawList: ExampleDrawList): void {
    for (const draw of drawList.draws) this.realizedDraws.push(this.realizeDraw(draw, drawList));
    this.submissions.push(drawList);
  }

  private realizeDraw(draw: ExampleDraw, drawList: ExampleDrawList): ExampleRealizedDraw {
    if (draw.primitiveCount !== 1) throw new Error('example renderer requires one primitive per draw');
    const primitive = drawList.primitiveRecords[draw.primitiveStart];
    if (primitive === undefined) throw new Error('example renderer draw references an unknown primitive');
    const geometry = this.geometryForPrimitive(primitive);
    return Object.freeze({ draw, primitive, geometry });
  }

  private geometryForPrimitive(primitive: ExamplePrimitiveRecord): ExampleGeometry {
    const instanceCount = instanceCountFor(primitive.recordCount);
    const declaration = this.shader.variant.geometry;
    if (declaration.kind === 'synthetic-quad') {
      return syntheticQuadGeometry(instanceCount);
    }
    const name = declaration.resource;
    if (name === undefined) throw new Error('example renderer supplied geometry needs a resource name');
    if (primitive.resourceId !== this.#resourceIds.get(name)) {
      throw new Error(`example renderer primitive does not reference geometry resource "${name}"`);
    }
    const geometry = this.geometriesByName.get(name);
    if (geometry === undefined) throw new Error(`example renderer has no realized geometry resource "${name}"`);
    return geometry.instancesSource === 'records' ? Object.freeze({ ...geometry, instanceCount }) : geometry;
  }
}

export interface ExampleGeometry {
  readonly kind: 'synthetic-quad' | 'supplied';
  readonly indexed: boolean;
  readonly vertexCount: number;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly instancesSource: 'records' | 'fixed';
  readonly resourceName?: string;
}

export interface ExampleRealizedDraw {
  readonly draw: ExampleDraw;
  readonly primitive: ExamplePrimitiveRecord;
  readonly geometry: ExampleGeometry;
}

function syntheticQuadGeometry(instanceCount: number): ExampleGeometry {
  return Object.freeze({
    kind: 'synthetic-quad',
    indexed: true,
    vertexCount: 4,
    indexStart: 0,
    indexCount: 6,
    instanceCount,
    instancesSource: 'records',
  });
}

function instanceCountFor(recordCount: number): number {
  if (!Number.isSafeInteger(recordCount) || recordCount < 1) {
    throw new RangeError('example renderer draws need a positive record count');
  }
  return recordCount;
}

function realizeGeometry(declaration: TechniqueGeometryDeclaration, name: string, resource: unknown): ExampleGeometry {
  if (declaration.kind === 'synthetic-quad') throw new Error('synthetic-quad geometry cannot name a resource');
  assertPortableResource('geometry', name, resource);
  const geometry = resource as PortableGeometryPayload;
  const position = geometry.attributes.find((attribute) => attribute.semantic === 'position');
  if (position === undefined) throw new Error(`example renderer geometry "${name}" has no position attribute`);
  const vertexAccessor = geometry.accessors[position.accessor];
  if (vertexAccessor === undefined)
    throw new Error(`example renderer geometry "${name}" has an invalid position accessor`);
  const indexAccessor = geometry.indices === undefined ? undefined : geometry.accessors[geometry.indices.accessor];
  const streamCount = indexAccessor?.count ?? vertexAccessor.count;
  const indexStart = geometry.drawRange?.start ?? 0;
  const indexCount = geometry.drawRange?.count ?? streamCount;
  const instancesSource = geometry.instances?.source ?? 'records';
  const instances = geometry.instances?.source === 'fixed' ? geometry.instances.count : undefined;
  return Object.freeze({
    kind: 'supplied',
    indexed: indexAccessor !== undefined,
    vertexCount: vertexAccessor.count,
    indexStart,
    indexCount,
    instanceCount: instances ?? 1,
    instancesSource,
    resourceName: name,
  });
}
