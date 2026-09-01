import type * as THREE from 'three/webgpu';

import {
  readRenderPlanBuffer,
  readRenderPlanDraw,
  readRenderPlanPatch,
  readRenderPlanPrimitive,
  readRenderPlanResource,
  readRenderPlanRetirement,
  type BorrowedBoundCommandBuffer,
  type BorrowedTypedCommandBuffer,
  type GlyphCommandBufferBinder,
  type PlanCandidate,
  type PortablePayloadLease,
  type ResourceLease,
} from '../core.js';
import type { ThreeTextEngineCoordinator, ThreeTextEngineResource } from './engine-coordinator.js';
import type {
  ThreeBindings,
  ThreeBufferBinding,
  ThreeDrawBinding,
  ThreeGlyphConfig,
  ThreePrimitiveBinding,
  ThreeProgramBinding,
  ThreeResolvedResourceBinding,
} from './handle.js';
import type { ThreeTextEnginePlanOwner } from './engine-plan-target.js';

interface BorrowedSourceState {
  readonly candidate: PlanCandidate;
  readonly signal: AbortSignal;
}

interface RetainedResolvedResource {
  readonly generation: number;
  readonly binding: ThreeResolvedResourceBinding;
  readonly executorResource: ThreeTextEngineResource;
  readonly payload: PortablePayloadLease;
  readonly lease: ResourceLease<ThreeResolvedResourceBinding>;
}

interface BoundFrameState {
  readonly candidate: PlanCandidate;
  readonly resources: Map<number, RetainedResolvedResource>;
  readonly buffers: Map<number, Readonly<{ generation: number; binding: ThreeBufferBinding }>>;
  readonly newResources: ReadonlySet<RetainedResolvedResource>;
}

const sourceStates = new WeakMap<BorrowedTypedCommandBuffer, BorrowedSourceState>();
const frameStates = new WeakMap<BorrowedBoundCommandBuffer<ThreeBindings>, BoundFrameState>();

/** @internal The original engine candidate remains available only to the built-in renderer implementation. */
export function threeCandidateForBoundFrame(frame: BorrowedBoundCommandBuffer<ThreeBindings>): PlanCandidate {
  const state = frameStates.get(frame);
  if (state === undefined) throw new TypeError('Three renderer received a command buffer from another binding domain');
  return state.candidate;
}

/** @internal Resolve one already-bound resource for the built-in Three renderer stores. */
export function threeResourceForBoundFrame(
  frame: BorrowedBoundCommandBuffer<ThreeBindings>,
  id: number,
  generation: number,
): ThreeTextEngineResource {
  const retained = frameStates.get(frame)?.resources.get(id);
  if (retained === undefined || retained.generation !== generation) {
    throw new Error('Three renderer references a resource outside its bound command buffer');
  }
  return retained.executorResource;
}

export class ThreeCommandBufferBinder implements GlyphCommandBufferBinder<ThreeBindings> {
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #owner: ThreeTextEnginePlanOwner;
  readonly #config: ThreeGlyphConfig;
  readonly #programs = new Map<number, ThreeProgramBinding>();
  readonly #buffers = new Map<string, ThreeBufferBinding>();
  readonly #primitives = new Map<number, ThreePrimitiveBinding>();
  readonly #draws = new Map<number, ThreeDrawBinding>();
  #resources = new Map<number, RetainedResolvedResource>();
  #retainedBuffers = new Map<number, Readonly<{ generation: number; binding: ThreeBufferBinding }>>();
  #disposed = false;

  constructor(coordinator: ThreeTextEngineCoordinator, owner: ThreeTextEnginePlanOwner, config: ThreeGlyphConfig) {
    this.#coordinator = coordinator;
    this.#owner = owner;
    this.#config = config;
  }

  source(candidate: PlanCandidate, signal: AbortSignal): BorrowedTypedCommandBuffer {
    this.#assertActive();
    const source = Object.freeze({ delivery: 'borrowed' as const, checkpoint: candidate.checkpoint });
    sourceStates.set(source as BorrowedTypedCommandBuffer, { candidate, signal });
    return source as BorrowedTypedCommandBuffer;
  }

  decodeDefault(source: BorrowedTypedCommandBuffer): BorrowedBoundCommandBuffer<ThreeBindings> {
    this.#assertActive();
    const state = sourceStates.get(source);
    if (state === undefined) throw new TypeError('defaultDecoder received a command buffer from another Glyph handle');
    const { candidate, signal } = state;
    signal.throwIfAborted();
    const plan = candidate.plan;
    const resourceTable = plan.table('resources');
    const bufferTable = plan.table('buffers');
    const patchTable = plan.table('patches');
    const primitiveTable = plan.table('primitives');
    const drawTable = plan.table('draws');
    const retirementTable = plan.table('retirements');
    const replacesDraws =
      resourceTable.count !== 0 ||
      bufferTable.count !== 0 ||
      primitiveTable.count !== 0 ||
      drawTable.count !== 0 ||
      retirementTable.count !== 0;
    const resources = replacesDraws ? new Map(this.#resources) : this.#resources;
    const retainedBuffers = replacesDraws ? new Map(this.#retainedBuffers) : this.#retainedBuffers;
    const newResources = new Set<RetainedResolvedResource>();

    try {
      const boundResources = Array.from({ length: resourceTable.count }, (_, index) => {
        const record = readRenderPlanResource(plan, resourceTable, index);
        if (record.id === 0 || record.generation === 0 || record.referenceId === 0) {
          throw new Error('text-engine resources require nonzero identities and generations');
        }
        const existing = resources.get(record.id);
        if (existing !== undefined && record.generation < existing.generation) {
          throw new Error(`resource rejects stale generation ${record.generation}`);
        }
        let retained = existing;
        if (retained?.generation !== record.generation) {
          const payload = candidate.acquirePayload(record.referenceId);
          let lease: ResourceLease<ThreeResolvedResourceBinding> | undefined;
          try {
            const expectedTechnique = this.#coordinator.identities.technique(payload.techniqueId);
            if (record.techniqueId !== expectedTechnique) {
              throw new Error('resource contradicts its registered technique');
            }
            const resourcesByName = new Map(payload.resources.map((entry) => [entry.resourceName, entry.payload]));
            const referencesByName = new Map(
              payload.resources.map((entry) => [entry.resourceName, entry.referenceId as number]),
            );
            if (resourcesByName.size !== payload.resources.length) {
              throw new TypeError('portable resource repeats a named member');
            }
            lease = this.#config.resolve({
              technique: payload.techniqueId,
              resourceKind: String(record.resourceKind),
              resourceName: payload.resourceName,
              payload: {
                technique: payload.techniqueId,
                resourceName: payload.resourceName,
                resources: resourcesByName,
              },
              previous: existing?.binding,
              signal,
            });
            const program = this.#coordinator.planProgram(payload.techniqueId);
            const created: RetainedResolvedResource = {
              generation: record.generation,
              binding: lease.value,
              executorResource: {
                technique: lease.value.technique,
                resourceName: lease.value.resourceName,
                resources: lease.value.resources,
                resourceReferences: referencesByName,
                ...(program === undefined ? {} : { program }),
              },
              payload,
              lease,
            };
            retained = created;
            newResources.add(created);
            resources.set(record.id, created);
          } catch (error) {
            lease?.dispose();
            payload.dispose();
            throw error;
          }
        }
        if (retained === undefined) throw new Error('resource binding was not retained');
        const kind = record.action === 'create' ? 'acquire' : record.action;
        return Object.freeze({ kind, resource: retained.binding });
      });

      const bufferRecords = Array.from({ length: bufferTable.count }, (_, index) =>
        readRenderPlanBuffer(plan, bufferTable, index),
      );
      const boundBuffers = bufferRecords.map((record) => {
        const existing = retainedBuffers.get(record.id);
        if (existing !== undefined && record.generation < existing.generation) {
          throw new Error(`buffer rejects stale generation ${record.generation}`);
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

      const boundPatches = [];
      for (let index = 0; index < patchTable.count; index += 1) {
        const patch = readRenderPlanPatch(plan, patchTable, index);
        const buffer = this.#retainedBuffer(retainedBuffers, patch.bufferId, patch.bufferGeneration).binding;
        if (patch.kind === 'write') {
          boundPatches.push(
            Object.freeze({
              kind: 'write' as const,
              buffer,
              destinationOffset: patch.destinationOffset,
              payload: patch.payload,
            }),
          );
        } else if (patch.kind === 'fill') {
          boundPatches.push(
            Object.freeze({
              kind: 'fill' as const,
              buffer,
              destinationOffset: patch.destinationOffset,
              byteLength: patch.byteLength,
              value: patch.fillValue,
            }),
          );
        } else if (patch.kind === 'copy') {
          boundPatches.push(
            Object.freeze({
              kind: 'copy' as const,
              source: this.#retainedBuffer(retainedBuffers, patch.sourceBufferId).binding,
              sourceOffset: patch.sourceOffset,
              destination: buffer,
              destinationOffset: patch.destinationOffset,
              byteLength: patch.byteLength,
            }),
          );
        }
      }

      const primitiveRecords = Array.from({ length: primitiveTable.count }, (_, index) =>
        readRenderPlanPrimitive(plan, primitiveTable, index),
      );
      const boundPrimitives = primitiveRecords.map((record) =>
        Object.freeze({
          primitive: this.#primitive(record.id),
          kind: record.kind === 'policy' ? ('codec' as const) : record.kind,
          program: this.#program(record.programId),
          resource:
            record.resourceId === 0
              ? undefined
              : this.#resource(resources, record.resourceId, record.resourceGeneration),
          buffers: record.bufferId === 0 ? [] : [this.#retainedBuffer(retainedBuffers, record.bufferId).binding],
          recordIndex: record.recordIndex,
          recordCount: record.recordCount,
          logicalOrder: record.logicalOrder,
        }),
      );

      const transforms = new Map<number, THREE.Object3D>();
      for (const { transformIndex, binding } of candidate.transforms) {
        transforms.set(transformIndex, this.#coordinator.resolveTransform(binding));
      }
      const boundDraws = Array.from({ length: drawTable.count }, (_, index) => {
        const record = readRenderPlanDraw(plan, drawTable, index);
        const material =
          record.materialId === 0
            ? undefined
            : this.#coordinator.resolveMaterial(candidate.resolveMaterial(record.materialId));
        const transform = record.transformId === 0 ? this.#owner.drawRoot : transforms.get(record.transformId);
        if (transform === undefined) throw new Error('draw references an unknown transform binding');
        return Object.freeze({
          draw: this.#draw(record.id),
          program: this.#program(record.programId),
          material,
          transform,
          buffers: bufferRecords
            .slice(record.bufferStart, record.bufferStart + record.bufferCount)
            .map((buffer) => this.#buffer(buffer.id, buffer.generation)),
          primitives: primitiveRecords
            .slice(record.primitiveStart, record.primitiveStart + record.primitiveCount)
            .map((primitive) => this.#primitive(primitive.id)),
          depthKey: record.depthKey,
        });
      });

      const retirements = [];
      for (let index = 0; index < retirementTable.count; index += 1) {
        const retirement = readRenderPlanRetirement(plan, retirementTable, index);
        if (retirement.kind === 'resource') {
          const retained = resources.get(retirement.id);
          if (retained !== undefined && retained.generation === retirement.generation) {
            retirements.push(Object.freeze({ kind: 'resource' as const, resource: retained.binding }));
            resources.delete(retirement.id);
          }
        } else if (retirement.kind === 'buffer') {
          const retained = this.#retainedBuffer(retainedBuffers, retirement.id, retirement.generation);
          retirements.push(Object.freeze({ kind: 'buffer' as const, buffer: retained.binding }));
          retainedBuffers.delete(retirement.id);
        }
      }

      const frame: BorrowedBoundCommandBuffer<ThreeBindings> = Object.freeze({
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
      frameStates.set(frame, { candidate, resources, buffers: retainedBuffers, newResources });
      return frame;
    } catch (error) {
      for (const retained of newResources) this.#disposeResource(retained);
      throw error;
    }
  }

  settle(frame: BorrowedBoundCommandBuffer<ThreeBindings>, accepted: boolean): void {
    const state = frameStates.get(frame);
    if (state === undefined) throw new TypeError('cannot settle a command buffer from another Three binder');
    frameStates.delete(frame);
    if (!accepted) {
      for (const retained of state.newResources) this.#disposeResource(retained);
      return;
    }
    const retained = new Set(state.resources.values());
    for (const resource of this.#resources.values()) {
      if (!retained.has(resource)) this.#disposeResource(resource);
    }
    this.#resources = state.resources;
    this.#retainedBuffers = state.buffers;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const resource of this.#resources.values()) this.#disposeResource(resource);
    this.#resources.clear();
    this.#programs.clear();
    this.#buffers.clear();
    this.#retainedBuffers.clear();
    this.#primitives.clear();
    this.#draws.clear();
  }

  #program(id: number): ThreeProgramBinding {
    let binding = this.#programs.get(id);
    if (binding === undefined) {
      binding = Object.freeze({ kind: 'three-program' });
      this.#programs.set(id, binding);
    }
    return binding;
  }

  #buffer(id: number, generation: number): ThreeBufferBinding {
    const key = `${id}:${generation}`;
    let binding = this.#buffers.get(key);
    if (binding === undefined) {
      binding = Object.freeze({ kind: 'three-buffer' });
      this.#buffers.set(key, binding);
    }
    return binding;
  }

  #primitive(id: number): ThreePrimitiveBinding {
    let binding = this.#primitives.get(id);
    if (binding === undefined) {
      binding = Object.freeze({ kind: 'three-primitive' });
      this.#primitives.set(id, binding);
    }
    return binding;
  }

  #draw(id: number): ThreeDrawBinding {
    let binding = this.#draws.get(id);
    if (binding === undefined) {
      binding = Object.freeze({ kind: 'three-draw' });
      this.#draws.set(id, binding);
    }
    return binding;
  }

  #resource(
    resources: ReadonlyMap<number, RetainedResolvedResource>,
    id: number,
    generation: number,
  ): ThreeResolvedResourceBinding {
    const retained = resources.get(id);
    if (retained === undefined || retained.generation !== generation) {
      throw new Error('primitive references an unknown resource binding');
    }
    return retained.binding;
  }

  #retainedBuffer(
    buffers: ReadonlyMap<number, Readonly<{ generation: number; binding: ThreeBufferBinding }>>,
    id: number,
    generation?: number,
  ): Readonly<{ generation: number; binding: ThreeBufferBinding }> {
    const retained = buffers.get(id);
    if (retained === undefined || (generation !== undefined && retained.generation !== generation)) {
      throw new Error('command references an unknown buffer binding');
    }
    return retained;
  }

  #disposeResource(resource: RetainedResolvedResource): void {
    resource.lease.dispose();
    resource.payload.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three command-buffer binder has been disposed');
  }
}
