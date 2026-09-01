import {
  type BackendTransformBinding,
  type BorrowedBoundCommandBuffer,
  type BorrowedTypedCommandBuffer,
  type BoundPatchCommand,
  type BoundRetirementCommand,
  type GlyphCommandBufferBinder,
  type PlanCandidate,
  type ResourceLease,
} from '@pmndrs/glyph/core';

import type {
  ExampleBindings,
  ExampleBufferBinding,
  ExampleDrawBinding,
  ExampleGlyphConfig,
  ExamplePrimitiveBinding,
  ExampleProgramBinding,
  ExampleResolvedResource,
} from './config.js';
import type { ExampleDrawList } from './draw-list.js';
import { readCandidate } from './plan-reader.js';

type DecodeSignal = Parameters<GlyphCommandBufferBinder<ExampleBindings>['source']>[1];

interface SourceState {
  readonly candidate: PlanCandidate;
  readonly signal: DecodeSignal;
}

interface RetainedResource {
  readonly generation: number;
  readonly binding: ExampleResolvedResource;
  readonly payload: ReturnType<PlanCandidate['acquirePayload']>;
  readonly lease: ResourceLease<ExampleResolvedResource>;
}

export interface FrameState {
  readonly candidate: PlanCandidate;
  readonly list: ExampleDrawList;
  readonly resources: Map<number, RetainedResource>;
  readonly buffers: Map<number, Readonly<{ generation: number; binding: ExampleBufferBinding }>>;
  readonly fresh: ReadonlySet<RetainedResource>;
}

const sourceStates = new WeakMap<BorrowedTypedCommandBuffer, SourceState>();
const frameStates = new WeakMap<BorrowedBoundCommandBuffer<ExampleBindings>, FrameState>();
const rootTransform: BackendTransformBinding = Object.freeze({}) as BackendTransformBinding;

export function exampleFrameState(frame: BorrowedBoundCommandBuffer<ExampleBindings>): FrameState {
  const state = frameStates.get(frame);
  if (state === undefined)
    throw new TypeError('example renderer received a command buffer from another binding domain');
  return state;
}

export class ExampleCommandBufferBinder implements GlyphCommandBufferBinder<ExampleBindings> {
  readonly #config: ExampleGlyphConfig;
  readonly #programs = new Map<number, ExampleProgramBinding>();
  readonly #buffers = new Map<string, ExampleBufferBinding>();
  readonly #primitives = new Map<number, ExamplePrimitiveBinding>();
  readonly #draws = new Map<number, ExampleDrawBinding>();
  #resources = new Map<number, RetainedResource>();
  #retainedBuffers = new Map<number, Readonly<{ generation: number; binding: ExampleBufferBinding }>>();
  #disposed = false;

  constructor(config: ExampleGlyphConfig) {
    this.#config = config;
  }

  source(candidate: PlanCandidate, signal: DecodeSignal): BorrowedTypedCommandBuffer {
    this.#assertActive();
    const source = Object.freeze({ delivery: 'borrowed' as const, checkpoint: candidate.checkpoint });
    sourceStates.set(source as BorrowedTypedCommandBuffer, { candidate, signal });
    return source as BorrowedTypedCommandBuffer;
  }

  decodeDefault(source: BorrowedTypedCommandBuffer): BorrowedBoundCommandBuffer<ExampleBindings> {
    this.#assertActive();
    const sourceState = sourceStates.get(source);
    if (sourceState === undefined) throw new TypeError('defaultDecoder received a foreign example command buffer');
    const { candidate, signal } = sourceState;
    signal.throwIfAborted();
    const list = readCandidate(candidate);
    const replacesDraws =
      list.resourceRecords.length !== 0 ||
      list.bufferRecords.length !== 0 ||
      list.primitiveRecords.length !== 0 ||
      list.draws.length !== 0 ||
      list.retirements.length !== 0;
    const resources = replacesDraws ? new Map(this.#resources) : this.#resources;
    const retainedBuffers = replacesDraws ? new Map(this.#retainedBuffers) : this.#retainedBuffers;
    const fresh = new Set<RetainedResource>();

    try {
      const boundResources = list.resourceRecords.map((record) => {
        const existing = resources.get(record.id);
        let retained = existing;
        if (record.referenceId !== 0 && existing?.generation !== record.generation) {
          const payload = candidate.acquirePayload(record.referenceId);
          let lease: ResourceLease<ExampleResolvedResource> | undefined;
          try {
            lease = this.#config.resolve({
              technique: payload.techniqueId,
              resourceKind: String(record.resourceKind),
              resourceName: payload.resourceName,
              payload: Object.freeze({ name: payload.resourceName, resource: payload.payload }),
              previous: existing?.binding,
              signal,
            });
            const created: RetainedResource = {
              generation: record.generation,
              binding: lease.value,
              payload,
              lease,
            };
            retained = created;
            fresh.add(created);
            resources.set(record.id, created);
          } catch (error) {
            lease?.dispose();
            payload.dispose();
            throw error;
          }
        }
        if (retained === undefined) throw new Error('example resource record has no bound payload');
        return Object.freeze({
          kind: record.action === 'create' ? ('acquire' as const) : record.action,
          resource: retained.binding,
        });
      });

      const boundBuffers = list.bufferRecords.map((record) => {
        const existing = retainedBuffers.get(record.id);
        if (existing !== undefined && record.generation < existing.generation) {
          throw new Error(`example buffer rejects stale generation ${record.generation}`);
        }
        const buffer =
          existing?.generation === record.generation ? existing.binding : this.#buffer(record.id, record.generation);
        retainedBuffers.set(record.id, Object.freeze({ generation: record.generation, binding: buffer }));
        return Object.freeze({
          kind: 'ensure' as const,
          buffer,
          program: this.#program(record.programId),
          scalarType: record.scalarType,
          vectorWidth: record.vectorWidth,
          capacityRecords: record.capacityRecords,
          byteLength: record.byteLength,
        });
      });
      const buffer = (id: number, generation?: number): ExampleBufferBinding =>
        this.#retainedBuffer(retainedBuffers, id, generation).binding;
      const boundPatches: BoundPatchCommand<ExampleBufferBinding>[] = [];
      for (const patch of list.patches) {
        if (patch.kind === 'write') {
          boundPatches.push({
            kind: 'write',
            buffer: buffer(patch.bufferId, patch.bufferGeneration),
            destinationOffset: patch.destinationOffset,
            payload: patch.payload,
          });
        } else if (patch.kind === 'fill') {
          boundPatches.push({
            kind: 'fill',
            buffer: buffer(patch.bufferId, patch.bufferGeneration),
            destinationOffset: patch.destinationOffset,
            byteLength: patch.byteLength,
            value: patch.fillValue,
          });
        } else if (patch.kind === 'copy') {
          boundPatches.push({
            kind: 'copy',
            source: buffer(patch.sourceBufferId),
            sourceOffset: patch.sourceOffset,
            destination: buffer(patch.bufferId, patch.bufferGeneration),
            destinationOffset: patch.destinationOffset,
            byteLength: patch.byteLength,
          });
        }
      }
      const primitiveBindings = new Map<number, ExamplePrimitiveBinding>();
      const boundPrimitives = list.primitiveRecords.map((record) => {
        const primitive = this.#primitive(record.id);
        primitiveBindings.set(record.id, primitive);
        return Object.freeze({
          primitive,
          kind: record.kind === 'policy' ? ('codec' as const) : record.kind,
          program: this.#program(record.programId),
          resource:
            record.resourceId === 0
              ? undefined
              : this.#resource(resources, record.resourceId, record.resourceGeneration),
          buffers: record.bufferId === 0 ? [] : [buffer(record.bufferId)],
          recordIndex: record.recordIndex,
          recordCount: record.recordCount,
          logicalOrder: record.logicalOrder,
        });
      });
      const transforms = new Map(candidate.transforms.map(({ transformIndex, binding }) => [transformIndex, binding]));
      const boundDraws = list.draws.map((record) => {
        const transform = record.transformId === 0 ? rootTransform : transforms.get(record.transformId);
        if (transform === undefined) throw new Error('example draw references an unknown transform binding');
        return Object.freeze({
          draw: this.#draw(record.id),
          program: this.#program(record.programId),
          material: record.materialId === 0 ? undefined : candidate.resolveMaterial(record.materialId),
          transform,
          buffers: list.bufferRecords
            .slice(record.bufferStart, record.bufferStart + record.bufferCount)
            .map((entry) => buffer(entry.id)),
          primitives: list.primitiveRecords
            .slice(record.primitiveStart, record.primitiveStart + record.primitiveCount)
            .map((entry) => this.#primitive(entry.id)),
          depthKey: record.depthKey,
        });
      });
      const retirements: BoundRetirementCommand<ExampleResolvedResource, ExampleBufferBinding>[] = [];
      for (const retirement of list.retirements) {
        if (retirement.kind === 'resource') {
          const retained = resources.get(retirement.id);
          if (retained === undefined || retained.generation !== retirement.generation) continue;
          resources.delete(retirement.id);
          retirements.push({ kind: 'resource', resource: retained.binding });
        } else if (retirement.kind === 'buffer') {
          const retained = this.#retainedBuffer(retainedBuffers, retirement.id, retirement.generation);
          retirements.push({ kind: 'buffer', buffer: retained.binding });
          retainedBuffers.delete(retirement.id);
        }
      }
      const frame: BorrowedBoundCommandBuffer<ExampleBindings> = Object.freeze({
        delivery: 'borrowed-bound',
        checkpoint: candidate.checkpoint,
        resources: Object.freeze(boundResources),
        buffers: Object.freeze(boundBuffers),
        patches: Object.freeze(boundPatches),
        primitives: Object.freeze(boundPrimitives),
        draws: replacesDraws
          ? Object.freeze({ kind: 'replace' as const, values: Object.freeze(boundDraws) })
          : Object.freeze({ kind: 'unchanged' as const }),
        retirements: Object.freeze(retirements),
      });
      frameStates.set(frame, { candidate, list, resources, buffers: retainedBuffers, fresh });
      return frame;
    } catch (error) {
      for (const resource of fresh) this.#disposeResource(resource);
      throw error;
    }
  }

  settle(frame: BorrowedBoundCommandBuffer<ExampleBindings>, accepted: boolean): void {
    const state = frameStates.get(frame);
    if (state === undefined) throw new TypeError('cannot settle a foreign example command buffer');
    frameStates.delete(frame);
    if (!accepted) {
      for (const resource of state.fresh) this.#disposeResource(resource);
      return;
    }
    const retained = new Set(state.resources.values());
    for (const resource of this.#resources.values()) if (!retained.has(resource)) this.#disposeResource(resource);
    this.#resources = state.resources;
    this.#retainedBuffers = state.buffers;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const resource of this.#resources.values()) this.#disposeResource(resource);
    this.#resources.clear();
    this.#retainedBuffers.clear();
    this.#programs.clear();
    this.#buffers.clear();
    this.#primitives.clear();
    this.#draws.clear();
  }

  #program(id: number): ExampleProgramBinding {
    return this.#intern(this.#programs, id, () => Object.freeze({ kind: 'example-program' as const }));
  }

  #buffer(id: number, generation: number): ExampleBufferBinding {
    return this.#intern(this.#buffers, `${id}:${generation}`, () => Object.freeze({ kind: 'example-buffer' as const }));
  }

  #primitive(id: number): ExamplePrimitiveBinding {
    return this.#intern(this.#primitives, id, () => Object.freeze({ kind: 'example-primitive' as const }));
  }

  #draw(id: number): ExampleDrawBinding {
    return this.#intern(this.#draws, id, () => Object.freeze({ kind: 'example-draw' as const }));
  }

  #resource(resources: ReadonlyMap<number, RetainedResource>, id: number, generation: number): ExampleResolvedResource {
    const retained = resources.get(id);
    if (retained === undefined || retained.generation !== generation) {
      throw new Error('example primitive references an unknown resource binding');
    }
    return retained.binding;
  }

  #retainedBuffer(
    buffers: ReadonlyMap<number, Readonly<{ generation: number; binding: ExampleBufferBinding }>>,
    id: number,
    generation?: number,
  ): Readonly<{ generation: number; binding: ExampleBufferBinding }> {
    const retained = buffers.get(id);
    if (retained === undefined || (generation !== undefined && retained.generation !== generation)) {
      throw new Error('example command references an unknown buffer binding');
    }
    return retained;
  }

  #intern<Key, Value>(map: Map<Key, Value>, key: Key, create: () => Value): Value {
    let value = map.get(key);
    if (value === undefined) {
      value = create();
      map.set(key, value);
    }
    return value;
  }

  #disposeResource(resource: RetainedResource): void {
    resource.lease.dispose();
    resource.payload.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('example command-buffer binder is disposed');
  }
}
