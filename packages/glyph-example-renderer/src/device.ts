import tgpu from 'typegpu';

import {
  assertPortableResource,
  textShaperAbi,
  type PortableGeometryPayload,
  type TechniqueGeometryDeclaration,
  type TextEngineBufferRecord,
  type TextEnginePatchRecord,
  type TextEngineRetirementRecord,
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

export interface ExampleRendererResourceInput {
  readonly id: number;
  readonly generation: number;
  readonly name: string;
  readonly resource: unknown;
}

export interface ExampleRendererResourceRegistration {
  /** Restore exactly the resource state that preceded this registration. */
  rollback(): void;
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
  /** Materialize a font's payloads atomically and return its synchronous rollback. */
  createResources(resources: readonly ExampleRendererResourceInput[]): ExampleRendererResourceRegistration;
  /** Apply one publication's complete buffer delta atomically. */
  applyBufferPlan(
    buffers: readonly TextEngineBufferRecord[],
    patches: readonly TextEnginePatchRecord[],
    retirements: readonly TextEngineRetirementRecord[],
  ): void;
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
  readonly #retainedBuffers = new Map<string, RetainedExampleBuffer>();

  constructor(shader: ExampleRendererShader = exampleRendererShader) {
    this.shader = shader;
  }

  createResources(resources: readonly ExampleRendererResourceInput[]): ExampleRendererResourceRegistration {
    if (!Array.isArray(resources)) throw new TypeError('example renderer resources must be an array');
    const previous = this.#resourceState();
    const next = copyResourceState(previous);
    for (const input of resources) applyResourceInput(next, this.shader, input);
    this.#replaceResourceState(next);
    let active = true;
    return Object.freeze({
      rollback: () => {
        if (!active) return;
        active = false;
        this.#replaceResourceState(previous);
      },
    });
  }

  createResource(id: number, name: string, resource: unknown, generation = 1): void {
    this.createResources([{ id, generation, name, resource }]);
  }

  applyBufferPlan(
    buffers: readonly TextEngineBufferRecord[],
    patches: readonly TextEnginePatchRecord[],
    retirements: readonly TextEngineRetirementRecord[],
  ): void {
    if (!Array.isArray(buffers) || !Array.isArray(patches) || !Array.isArray(retirements)) {
      throw new TypeError('example renderer buffer plans require arrays');
    }
    const retained = cloneRetainedBuffers(this.#retainedBuffers);
    const active = new Map<number, string>();
    for (const record of buffers) retainBufferRecord(retained, active, record);
    for (const patch of patches) applyBufferPatch(retained, active, patch);
    for (const retirement of retirements) retireBuffer(retained, active, retirement);
    this.#retainedBuffers.clear();
    for (const [key, buffer] of retained) this.#retainedBuffers.set(key, buffer);
    this.buffers.clear();
    this.buffersByName.clear();
    for (const [id, key] of active) {
      const buffer = retained.get(key);
      if (buffer === undefined) continue;
      this.buffers.set(id, buffer.bytes);
      const name = bufferName(this.shader, buffer.policyBufferId);
      if (name !== undefined) this.buffersByName.set(name, buffer.bytes);
    }
  }

  bufferBytes(id: number, generation: number): Uint8Array | undefined {
    return this.#retainedBuffers.get(bufferKey(id, generation))?.bytes;
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
    const realized = drawList.draws.map((draw) => this.realizeDraw(draw, drawList));
    this.realizedDraws.push(...realized);
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

  #resourceState(): ExampleResourceState {
    return {
      resources: new Map(this.resources),
      resourcesByName: new Map(this.resourcesByName),
      geometriesByName: new Map(this.geometriesByName),
      resourceNames: new Map(this.#resourceNames),
      resourceGenerations: new Map(this.#resourceGenerations),
      resourceIds: new Map(this.#resourceIds),
    };
  }

  #replaceResourceState(state: ExampleResourceState): void {
    replaceMap(this.resources, state.resources);
    replaceMap(this.resourcesByName, state.resourcesByName);
    replaceMap(this.geometriesByName, state.geometriesByName);
    replaceMap(this.#resourceNames, state.resourceNames);
    replaceMap(this.#resourceGenerations, state.resourceGenerations);
    replaceMap(this.#resourceIds, state.resourceIds);
  }
}

interface ExampleResourceState {
  readonly resources: Map<number, unknown>;
  readonly resourcesByName: Map<string, unknown>;
  readonly geometriesByName: Map<string, ExampleGeometry>;
  readonly resourceNames: Map<number, string>;
  readonly resourceGenerations: Map<number, number>;
  readonly resourceIds: Map<string, number>;
}

interface RetainedExampleBuffer {
  readonly id: number;
  readonly generation: number;
  readonly policyBufferId: number;
  readonly bytes: Uint8Array;
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

function copyResourceState(state: ExampleResourceState): ExampleResourceState {
  return {
    resources: new Map(state.resources),
    resourcesByName: new Map(state.resourcesByName),
    geometriesByName: new Map(state.geometriesByName),
    resourceNames: new Map(state.resourceNames),
    resourceGenerations: new Map(state.resourceGenerations),
    resourceIds: new Map(state.resourceIds),
  };
}

function applyResourceInput(
  state: ExampleResourceState,
  shader: ExampleRendererShader,
  input: ExampleRendererResourceInput,
): void {
  assertObject(input, 'resource entry');
  const id = positiveInteger(input.id, 'resource id');
  const generation = positiveInteger(input.generation, 'resource generation');
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new TypeError('example renderer resource names are required');
  }
  const previousName = state.resourceNames.get(id);
  if (previousName !== undefined && previousName !== input.name) {
    throw new Error(`example renderer resource id ${id} is already bound to "${previousName}"`);
  }
  const previousId = state.resourceIds.get(input.name);
  if (previousId !== undefined && previousId !== id) {
    throw new Error(`example renderer resource "${input.name}" is already bound to id ${previousId}`);
  }
  const geometry =
    shader.variant.geometryResource === input.name
      ? realizeGeometry(shader.variant.geometry, input.name, input.resource)
      : undefined;
  state.resources.set(id, input.resource);
  state.resourcesByName.set(input.name, input.resource);
  state.resourceNames.set(id, input.name);
  state.resourceGenerations.set(id, generation);
  state.resourceIds.set(input.name, id);
  if (geometry !== undefined) state.geometriesByName.set(input.name, geometry);
}

function cloneRetainedBuffers(source: ReadonlyMap<string, RetainedExampleBuffer>): Map<string, RetainedExampleBuffer> {
  return new Map([...source].map(([key, buffer]) => [key, { ...buffer, bytes: buffer.bytes.slice() }] as const));
}

function retainBufferRecord(
  retained: Map<string, RetainedExampleBuffer>,
  active: Map<number, string>,
  record: TextEngineBufferRecord,
): void {
  assertObject(record, 'buffer record');
  const id = positiveInteger(record.id, 'buffer id');
  const generation = positiveInteger(record.generation, 'buffer generation');
  const policyBufferId = positiveInteger(record.policyBufferId, 'policy buffer id');
  const byteLength = nonnegativeInteger(record.byteLength, 'buffer byte length');
  const capacityRecords = nonnegativeInteger(record.capacityRecords, 'buffer capacity');
  if (!Number.isSafeInteger(record.scalarType) || record.scalarType < 1 || record.scalarType > 3) {
    throw new RangeError('example renderer buffer scalar types must be 1, 2, or 3');
  }
  if (!Number.isSafeInteger(record.vectorWidth) || record.vectorWidth < 1 || record.vectorWidth > 4) {
    throw new RangeError('example renderer buffer vector widths must be between 1 and 4');
  }
  const scalarBytes = record.scalarType === textShaperAbi.policy.scalarTypes.u16 ? 2 : 4;
  const expectedByteLength = capacityRecords * record.vectorWidth * scalarBytes;
  if (!Number.isSafeInteger(expectedByteLength) || byteLength !== expectedByteLength) {
    throw new RangeError('example renderer requires tightly packed physical buffers');
  }
  if (active.has(id)) throw new Error(`example renderer plan repeats active buffer id ${id}`);
  const key = bufferKey(id, generation);
  const existing = retained.get(key);
  if (
    existing !== undefined &&
    (existing.policyBufferId !== policyBufferId || existing.bytes.byteLength !== byteLength)
  ) {
    throw new Error(`example renderer buffer ${key} changed shape without changing generation`);
  }
  if (existing === undefined) {
    retained.set(key, { id, generation, policyBufferId, bytes: new Uint8Array(byteLength) });
  }
  active.set(id, key);
}

function applyBufferPatch(
  retained: Map<string, RetainedExampleBuffer>,
  active: ReadonlyMap<number, string>,
  patch: TextEnginePatchRecord,
): void {
  assertObject(patch, 'buffer patch');
  const id = positiveInteger(patch.bufferId, 'patch buffer id');
  const generation = positiveInteger(patch.bufferGeneration, 'patch buffer generation');
  const destinationOffset = nonnegativeInteger(patch.destinationOffset, 'patch destination offset');
  const byteLength = nonnegativeInteger(patch.byteLength, 'patch byte length');
  const key = bufferKey(id, generation);
  if (active.get(id) !== key) throw new Error(`example renderer patch references inactive buffer ${key}`);
  const target = retained.get(key);
  if (target === undefined) throw new Error(`example renderer patch references unknown buffer ${key}`);
  assertRange(destinationOffset, byteLength, target.bytes.byteLength, 'buffer patch');
  const opcodes = textShaperAbi.engine.patchOpcodes;
  if (patch.opcode === opcodes.allocateOrResize) {
    if (destinationOffset !== 0 || byteLength !== target.bytes.byteLength) {
      throw new RangeError(`example renderer allocation patch does not match buffer ${key}`);
    }
    return;
  }
  if (patch.opcode === opcodes.retire) return;
  if (patch.opcode === opcodes.write) {
    if (byteLength === 0) {
      if (patch.payload !== undefined && patch.payload.byteLength !== 0) {
        throw new RangeError('zero-length write patch has a payload');
      }
      return;
    }
    if (!(patch.payload instanceof Uint8Array) || patch.payload.byteLength !== byteLength) {
      throw new RangeError('write patch payload length does not match its byte length');
    }
    target.bytes.set(patch.payload, destinationOffset);
    return;
  }
  if (patch.opcode === opcodes.fill) {
    if (byteLength % 4 !== 0) throw new RangeError('fill patch is not u32 aligned');
    const fillValue = nonnegativeInteger(patch.fillValue, 'fill value');
    if (fillValue > 0xffff_ffff) throw new RangeError('fill value exceeds u32');
    const view = new DataView(target.bytes.buffer, target.bytes.byteOffset + destinationOffset, byteLength);
    for (let offset = 0; offset < byteLength; offset += 4) view.setUint32(offset, fillValue, true);
    return;
  }
  if (patch.opcode === opcodes.copy) {
    const sourceId = positiveInteger(patch.sourceBufferId, 'copy source buffer id');
    const sourceKey = active.get(sourceId);
    const source = sourceKey === undefined ? undefined : retained.get(sourceKey);
    if (source === undefined) throw new Error(`copy patch references inactive source buffer ${sourceId}`);
    const sourceOffset = nonnegativeInteger(patch.sourceOffset, 'copy source offset');
    assertRange(sourceOffset, byteLength, source.bytes.byteLength, 'copy patch source');
    if (source === target) {
      target.bytes.copyWithin(destinationOffset, sourceOffset, sourceOffset + byteLength);
    } else {
      target.bytes.set(source.bytes.subarray(sourceOffset, sourceOffset + byteLength), destinationOffset);
    }
    return;
  }
  throw new Error(`unsupported text-engine patch opcode ${patch.opcode}`);
}

function retireBuffer(
  retained: Map<string, RetainedExampleBuffer>,
  active: Map<number, string>,
  retirement: TextEngineRetirementRecord,
): void {
  assertObject(retirement, 'retirement');
  if (retirement.kind !== textShaperAbi.engine.retirementKinds.buffer) return;
  const id = positiveInteger(retirement.id, 'retired buffer id');
  const generation = positiveInteger(retirement.generation, 'retired buffer generation');
  const key = bufferKey(id, generation);
  retained.delete(key);
  if (active.get(id) === key) active.delete(id);
}

function bufferName(shader: ExampleRendererShader, policyBufferId: number): string | undefined {
  return Object.entries(shader.variant.buffers).find(([, buffer]) => buffer.id === policyBufferId)?.[0];
}

function bufferKey(id: number, generation: number): string {
  return `${id}:${generation}`;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`example renderer ${label} must be an object`);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`example renderer ${label} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`example renderer ${label} must be a nonnegative integer`);
  }
  return value;
}

function assertRange(offset: number, length: number, capacity: number, label: string): void {
  if (offset > capacity || length > capacity - offset) {
    throw new RangeError(`example renderer ${label} exceeds its buffer`);
  }
}

function replaceMap<Key, Value>(target: Map<Key, Value>, source: ReadonlyMap<Key, Value>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
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
