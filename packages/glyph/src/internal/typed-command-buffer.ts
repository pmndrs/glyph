import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { HandleMaterialBinding, HandleTransformBinding } from './handle-state.js';
import type { RenderPlanTable } from '../core/plan-view.js';
import type { PlanCandidate, RenderPlanReader, ResolvedPlanTransform } from '../core/render-planner.js';
import type {
  BatchIdentity,
  BorrowedCommandSequence,
  BorrowedTypedCommandBuffer,
  ClipIdentity,
  InstanceIdentity,
  InstanceSpanIdentity,
  SemanticIdentity,
  TransformIdentity,
  TypedBatch,
  TypedBuffer,
  TypedBufferCommand,
  TypedGroupChild,
  TypedInstanceSpan,
  TypedMaterial,
  TypedPatchCommand,
  TypedProgram,
  TypedResource,
  TypedResourceCommand,
  TypedRootInstance,
  TypedRetirementCommand,
} from '../glyph-config.js';

interface TypedSourceState {
  readonly candidate: PlanCandidate;
  readonly signal: AbortSignal;
  readonly bufferOverlay: Map<number, TypedBuffer | null>;
  readonly materials: Map<number, TypedMaterial>;
  readonly batchOverlay: Map<number, BatchIdentity>;
  readonly instanceOverlay: Map<number, InstanceIdentity>;
  readonly instanceSpanOverlay: Map<number, InstanceSpanIdentity>;
  readonly batchDescriptors: WeakMap<BatchIdentity, InternalBatchDescriptor>;
  readonly instanceDescriptors: WeakMap<InstanceIdentity, InternalInstanceDescriptor>;
  readonly instanceSpanDescriptors: WeakMap<InstanceSpanIdentity, InternalInstanceSpanDescriptor>;
  transformBindings:
    | ReadonlyMap<number, Readonly<{ binding: HandleTransformBinding; recordIndex: number }>>
    | undefined;
}

interface InternalPlanDescriptor {
  readonly view: RenderPlanReader;
  readonly offset: number;
}

export interface InternalBatchDescriptor extends InternalPlanDescriptor {}

export interface InternalInstanceDescriptor extends InternalPlanDescriptor {}

export interface InternalInstanceSpanDescriptor extends InternalPlanDescriptor {}

export interface InternalDrawBindingDescriptor {
  readonly program: TypedProgram;
  readonly programVariant: number;
  readonly material: TypedMaterial | undefined;
  readonly buffers: BorrowedCommandSequence<TypedBuffer>;
  readonly resources: BorrowedCommandSequence<TypedResource>;
  readonly flags: number;
  readonly clip: ClipIdentity | undefined;
  readonly depthKey: number;
  readonly order: number;
  readonly indirect: Readonly<{ buffer: TypedBuffer; byteOffset: number }> | undefined;
}

export interface InternalInstanceSpanBindingDescriptor {
  readonly program: TypedProgram;
  readonly programVariant: number;
  readonly resource: TypedResource | undefined;
  readonly buffer: TypedBuffer | undefined;
  readonly clip: ClipIdentity | undefined;
  readonly semantic: SemanticIdentity | undefined;
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineExtent: number;
  readonly blockExtent: number;
}

export interface InternalResourceIdentity {
  readonly id: number;
  readonly generation: number;
  readonly techniqueId: number;
  readonly resourceKind: number;
  readonly referenceId: number;
}

export interface InternalBufferIdentity {
  readonly id: number;
  readonly generation: number;
  readonly programId: number;
  readonly bindingId: number | 'order';
}

const resourceLayout = textShaperAbi.layouts.engineResource;
const bufferLayout = textShaperAbi.layouts.engineBuffer;
const patchLayout = textShaperAbi.layouts.enginePatch;
const primitiveLayout = textShaperAbi.layouts.enginePrimitive;
const drawLayout = textShaperAbi.layouts.engineDraw;
const retirementLayout = textShaperAbi.layouts.engineRetirement;

/**
 * Retains only opaque JS identities. All command scalars and ranges stay in the trusted Rust
 * publication and are read lazily through the borrowed tables below.
 */
export class TypedCommandBufferMapper {
  readonly #sources = new WeakMap<BorrowedTypedCommandBuffer, TypedSourceState>();
  readonly #resources = new Map<string, TypedResource>();
  readonly #resourceIdentities = new WeakMap<TypedResource, InternalResourceIdentity>();
  readonly #buffers = new Map<string, TypedBuffer>();
  readonly #bufferIdentities = new WeakMap<TypedBuffer, InternalBufferIdentity>();
  readonly #currentBuffers = new Map<number, TypedBuffer>();
  readonly #programs = new Map<number, TypedProgram>();
  readonly #programIdentities = new WeakMap<TypedProgram, number>();
  readonly #batches = new Map<number, BatchIdentity>();
  readonly #instances = new Map<number, InstanceIdentity>();
  readonly #instanceSpans = new Map<number, InstanceSpanIdentity>();
  readonly #materials = new WeakMap<HandleMaterialBinding, TypedMaterial>();
  readonly #materialBindings = new WeakMap<TypedMaterial, HandleMaterialBinding>();
  readonly #transforms = new WeakMap<HandleTransformBinding, TransformIdentity>();
  readonly #transformBindings = new WeakMap<TransformIdentity, HandleTransformBinding>();
  readonly #transformIndices = new WeakMap<TransformIdentity, number>();
  readonly #clips = new Map<number, ClipIdentity>();
  readonly #semantics = new Map<number, SemanticIdentity>();
  #disposed = false;

  source(candidate: PlanCandidate, signal: AbortSignal): BorrowedTypedCommandBuffer {
    this.#assertActive();
    const plan = candidate.plan;
    const state: TypedSourceState = {
      candidate,
      signal,
      bufferOverlay: new Map(),
      materials: new Map(),
      batchOverlay: new Map(),
      instanceOverlay: new Map(),
      instanceSpanOverlay: new Map(),
      batchDescriptors: new WeakMap(),
      instanceDescriptors: new WeakMap(),
      instanceSpanDescriptors: new WeakMap(),
      transformBindings: undefined,
    };
    const resources = plan.table('resources');
    const buffers = plan.table('buffers');
    const patches = plan.table('patches');
    const primitives = plan.table('primitives');
    const draws = plan.table('draws');
    const retirements = plan.table('retirements');
    const replacesGroup =
      resources.count !== 0 ||
      buffers.count !== 0 ||
      primitives.count !== 0 ||
      draws.count !== 0 ||
      retirements.count !== 0;
    const resourceCommands = new LazyCommandSequence(
      resources.count,
      (index) => new ResourceCommandView(this, state, plan, resources, index),
    );
    const bufferCommands = new LazyCommandSequence(
      buffers.count,
      (index) => new BufferCommandView(this, state, plan, buffers, index),
    );
    const groupChildren = new LazyCommandSequence<TypedGroupChild>(draws.count, (index) => {
      const offset = plan.record(draws, index);
      return plan.u32(offset + drawLayout.transformId) === 0
        ? new BatchView(this, state, plan, offset, primitives)
        : new RootInstanceView(this, state, plan, offset);
    });
    const source = Object.freeze({
      delivery: 'borrowed' as const,
      engineRevision: candidate.engineRevision,
      planRevision: candidate.planRevision,
      publicationGeneration: candidate.publicationGeneration,
      checkpoint: candidate.checkpoint,
      updates: Object.freeze({
        resources: resourceCommands,
        buffers: bufferCommands,
        patches: new LazyCommandSequence(
          patches.count,
          (index) => new PatchCommandView(this, state, plan, patches, index) as TypedPatchCommand,
        ),
        retirements: new LazyCommandSequence(
          retirements.count,
          (index) => new RetirementCommandView(this, state, plan, retirements, index) as TypedRetirementCommand,
        ),
      }),
      group: replacesGroup
        ? Object.freeze({
            kind: 'replace' as const,
            value: Object.freeze({ children: groupChildren }),
          })
        : Object.freeze({ kind: 'unchanged' as const }),
    }) as unknown as BorrowedTypedCommandBuffer;
    this.#sources.set(source, state);
    return source;
  }

  settle(source: BorrowedTypedCommandBuffer, accepted: boolean): void {
    const state = this.#state(source);
    this.#sources.delete(source);
    if (!accepted) return;
    for (const [id, buffer] of state.bufferOverlay) {
      if (buffer === null) this.#currentBuffers.delete(id);
      else this.#currentBuffers.set(id, buffer);
    }
    for (const [id, token] of state.batchOverlay) this.#batches.set(id, token);
    for (const [id, token] of state.instanceOverlay) this.#instances.set(id, token);
    for (const [id, token] of state.instanceSpanOverlay) this.#instanceSpans.set(id, token);
  }

  candidate(source: BorrowedTypedCommandBuffer): PlanCandidate {
    return this.#state(source).candidate;
  }

  signal(source: BorrowedTypedCommandBuffer): AbortSignal {
    return this.#state(source).signal;
  }

  resourceIdentity(resource: TypedResource): InternalResourceIdentity {
    return this.#resourceIdentities.get(resource)!;
  }

  bufferIdentity(buffer: TypedBuffer): InternalBufferIdentity {
    return this.#bufferIdentities.get(buffer)!;
  }

  programIdentity(program: TypedProgram): number {
    return this.#programIdentities.get(program)!;
  }

  materialBinding(material: TypedMaterial): HandleMaterialBinding {
    return this.#materialBindings.get(material)!;
  }

  transformBinding(transform: TransformIdentity): HandleTransformBinding {
    return this.#transformBindings.get(transform)!;
  }

  transformIndex(transform: TransformIdentity): number {
    return this.#transformIndices.get(transform)!;
  }

  transformBindings(source: BorrowedTypedCommandBuffer): BorrowedCommandSequence<ResolvedPlanTransform> {
    return this.#state(source).candidate.transforms;
  }

  batchDescriptor(source: BorrowedTypedCommandBuffer, token: BatchIdentity): InternalBatchDescriptor {
    return this.#descriptor(this.#state(source).batchDescriptors, token, 'batch');
  }

  instanceDescriptor(source: BorrowedTypedCommandBuffer, token: InstanceIdentity): InternalInstanceDescriptor {
    return this.#descriptor(this.#state(source).instanceDescriptors, token, 'instance');
  }

  instanceSpanDescriptor(
    source: BorrowedTypedCommandBuffer,
    token: InstanceSpanIdentity,
  ): InternalInstanceSpanDescriptor {
    return this.#descriptor(this.#state(source).instanceSpanDescriptors, token, 'instance span');
  }

  drawBindingDescriptor(
    source: BorrowedTypedCommandBuffer,
    token: BatchIdentity | InstanceIdentity,
  ): InternalDrawBindingDescriptor {
    const state = this.#state(source);
    const descriptor =
      state.batchDescriptors.get(token as BatchIdentity) ?? state.instanceDescriptors.get(token as InstanceIdentity);
    if (descriptor === undefined) throw new TypeError('draw identity does not belong to this command buffer');
    const { view, offset } = descriptor;
    const bufferTable = view.table('buffers');
    const resourceTable = view.table('resources');
    const bufferStart = view.u32(offset + drawLayout.bufferStart);
    const bufferCount = view.u32(offset + drawLayout.bufferCount);
    const resourceStart = view.u32(offset + drawLayout.resourceStart);
    const resourceCount = view.u32(offset + drawLayout.resourceCount);
    const materialId = view.u32(offset + drawLayout.materialId);
    const clipId = view.u32(offset + drawLayout.clipId);
    const indirectBufferId = view.u32(offset + drawLayout.indirectBufferId);
    return {
      program: this.program(view.u32(offset + drawLayout.programId)),
      programVariant: view.u16(offset + drawLayout.programVariant),
      material: materialId === 0 ? undefined : this.material(state, materialId),
      buffers: new LazyCommandSequence(bufferCount, (index) =>
        this.#bufferFromRecord(state, view, view.record(bufferTable, bufferStart + index)),
      ),
      resources: new LazyCommandSequence(resourceCount, (index) =>
        this.#resourceFromRecord(view, view.record(resourceTable, resourceStart + index)),
      ),
      flags: view.u16(offset + drawLayout.flags),
      clip: clipId === 0 ? undefined : intern(this.#clips, clipId),
      depthKey: view.u32(offset + drawLayout.depthKey),
      order: view.u32(offset + drawLayout.orderToken),
      indirect:
        indirectBufferId === 0
          ? undefined
          : Object.freeze({
              buffer: this.currentBuffer(state, indirectBufferId),
              byteOffset: view.u32(offset + drawLayout.indirectOffset),
            }),
    };
  }

  instanceSpanBindingDescriptor(
    source: BorrowedTypedCommandBuffer,
    token: InstanceSpanIdentity,
  ): InternalInstanceSpanBindingDescriptor {
    const state = this.#state(source);
    const { view, offset } = this.instanceSpanDescriptor(source, token);
    const resourceId = view.u32(offset + primitiveLayout.resourceId);
    const bufferId = view.u32(offset + primitiveLayout.bufferId);
    const clipId = view.u32(offset + primitiveLayout.clipId);
    const semanticId = view.u32(offset + primitiveLayout.semanticId);
    return {
      program: this.program(view.u32(offset + primitiveLayout.programId)),
      programVariant: view.u16(offset + primitiveLayout.programVariant),
      resource:
        resourceId === 0
          ? undefined
          : this.resource(
              resourceId,
              view.u32(offset + primitiveLayout.resourceGeneration),
              view.u32(offset + primitiveLayout.techniqueId),
              0,
              0,
            ),
      buffer: bufferId === 0 ? undefined : this.currentBuffer(state, bufferId),
      clip: clipId === 0 ? undefined : intern(this.#clips, clipId),
      semantic: semanticId === 0 ? undefined : intern(this.#semantics, semanticId),
      inlineStart: view.f32(offset + primitiveLayout.inlineStart),
      blockStart: view.f32(offset + primitiveLayout.blockStart),
      inlineExtent: view.f32(offset + primitiveLayout.inlineExtent),
      blockExtent: view.f32(offset + primitiveLayout.blockExtent),
    };
  }

  rootInstanceSpan(source: BorrowedTypedCommandBuffer, token: InstanceIdentity): TypedInstanceSpan {
    const state = this.#state(source);
    const { view, offset } = this.instanceDescriptor(source, token);
    const primitives = view.table('primitives');
    return new InstanceSpanView(this, state, view, primitives, view.u32(offset + drawLayout.primitiveStart));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resources.clear();
    this.#buffers.clear();
    this.#currentBuffers.clear();
    this.#programs.clear();
    this.#batches.clear();
    this.#instances.clear();
    this.#instanceSpans.clear();
    this.#clips.clear();
    this.#semantics.clear();
  }

  resource(
    id: number,
    generation: number,
    techniqueId: number,
    resourceKind: number,
    referenceId: number,
  ): TypedResource {
    const key = `${id}:${generation}`;
    let resource = this.#resources.get(key);
    if (resource === undefined) {
      resource = opaqueIdentity<TypedResource>();
      this.#resources.set(key, resource);
      this.#resourceIdentities.set(resource, { id, generation, techniqueId, resourceKind, referenceId });
    }
    return resource;
  }

  declareBuffer(
    state: TypedSourceState,
    id: number,
    generation: number,
    programId: number,
    bindingId: number | 'order',
  ): TypedBuffer {
    const buffer = this.buffer(id, generation, programId, bindingId);
    state.bufferOverlay.set(id, buffer);
    return buffer;
  }

  buffer(id: number, generation: number, programId = 0, bindingId: number | 'order' = 0): TypedBuffer {
    const key = `${id}:${generation}`;
    let buffer = this.#buffers.get(key);
    if (buffer === undefined) {
      buffer = opaqueIdentity<TypedBuffer>();
      this.#buffers.set(key, buffer);
      this.#bufferIdentities.set(buffer, { id, generation, programId, bindingId });
    }
    return buffer;
  }

  currentBuffer(state: TypedSourceState, id: number): TypedBuffer {
    return state.bufferOverlay.get(id) ?? this.#currentBuffers.get(id)!;
  }

  retireBuffer(state: TypedSourceState, id: number, generation: number): TypedBuffer {
    const buffer = this.buffer(id, generation);
    state.bufferOverlay.set(id, null);
    return buffer;
  }

  program(id: number): TypedProgram {
    let program = this.#programs.get(id);
    if (program === undefined) {
      program = opaqueIdentity<TypedProgram>();
      this.#programs.set(id, program);
      this.#programIdentities.set(program, id);
    }
    return program;
  }

  batch(state: TypedSourceState, id: number, descriptor: InternalBatchDescriptor): BatchIdentity {
    const value = this.#candidateIdentity(this.#batches, state.batchOverlay, id, opaqueIdentity<BatchIdentity>);
    state.batchDescriptors.set(value, descriptor);
    return value;
  }

  instance(state: TypedSourceState, id: number, descriptor: InternalInstanceDescriptor): InstanceIdentity {
    const value = this.#candidateIdentity(this.#instances, state.instanceOverlay, id, opaqueIdentity<InstanceIdentity>);
    state.instanceDescriptors.set(value, descriptor);
    return value;
  }

  instanceSpan(state: TypedSourceState, id: number, descriptor: InternalInstanceSpanDescriptor): InstanceSpanIdentity {
    const value = this.#candidateIdentity(
      this.#instanceSpans,
      state.instanceSpanOverlay,
      id,
      opaqueIdentity<InstanceSpanIdentity>,
    );
    state.instanceSpanDescriptors.set(value, descriptor);
    return value;
  }

  material(state: TypedSourceState, id: number): TypedMaterial {
    let material = state.materials.get(id);
    if (material !== undefined) return material;
    const binding = state.candidate.resolveMaterial(id as Parameters<PlanCandidate['resolveMaterial']>[0]);
    material = this.#materials.get(binding);
    if (material === undefined) {
      material = opaqueIdentity<TypedMaterial>();
      this.#materials.set(binding, material);
      this.#materialBindings.set(material, binding);
    }
    state.materials.set(id, material);
    return material;
  }

  transform(state: TypedSourceState, id: number): TransformIdentity {
    state.transformBindings ??= transformBindingMap(state.candidate.transforms);
    const record = state.transformBindings.get(id);
    if (record === undefined) {
      throw new Error(
        `command references unknown transform binding ${id}; candidate provided ${[
          ...state.transformBindings.keys(),
        ].join(', ')}`,
      );
    }
    const { binding, recordIndex } = record;
    let transform = this.#transforms.get(binding);
    if (transform === undefined) {
      transform = opaqueIdentity<TransformIdentity>();
      this.#transforms.set(binding, transform);
      this.#transformBindings.set(transform, binding);
    }
    this.#transformIndices.set(transform, recordIndex);
    return transform;
  }

  #bufferFromRecord(state: TypedSourceState, view: RenderPlanReader, offset: number): TypedBuffer {
    const binding = view.u16(offset + bufferLayout.policyBufferId);
    return this.declareBuffer(
      state,
      view.u32(offset + bufferLayout.id),
      view.u32(offset + bufferLayout.generation),
      view.u32(offset + bufferLayout.programId),
      binding === textShaperAbi.engine.internalBufferBindings.order ? 'order' : binding,
    );
  }

  #resourceFromRecord(view: RenderPlanReader, offset: number): TypedResource {
    return this.resource(
      view.u32(offset + resourceLayout.id),
      view.u32(offset + resourceLayout.generation),
      view.u32(offset + resourceLayout.techniqueId),
      view.u16(offset + resourceLayout.resourceKind),
      view.u32(offset + resourceLayout.referenceId),
    );
  }

  #state(source: BorrowedTypedCommandBuffer): TypedSourceState {
    const state = this.#sources.get(source);
    if (state === undefined) throw new TypeError('typed command buffer does not belong to this mapper');
    return state;
  }

  #candidateIdentity<Value extends object>(
    retained: ReadonlyMap<number, Value>,
    overlay: Map<number, Value>,
    id: number,
    create: () => Value,
  ): Value {
    const existing = overlay.get(id) ?? retained.get(id);
    if (existing !== undefined) return existing;
    const value = create();
    overlay.set(id, value);
    return value;
  }

  #descriptor<Key extends object, Value>(descriptors: WeakMap<Key, Value>, key: Key, kind: string): Value {
    const descriptor = descriptors.get(key);
    if (descriptor === undefined) throw new TypeError(`${kind} identity does not belong to this command buffer`);
    return descriptor;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('typed command-buffer mapper is disposed');
  }
}

class LazyCommandSequence<Row> implements BorrowedCommandSequence<Row> {
  readonly length: number;
  readonly #rows: Array<Row | undefined>;
  readonly #create: (index: number) => Row;

  constructor(length: number, create: (index: number) => Row) {
    this.length = length;
    this.#rows = new Array(length);
    this.#create = create;
  }

  at(index: number): Row | undefined {
    if (index < 0 || index >= this.length || !Number.isInteger(index)) return undefined;
    return (this.#rows[index] ??= this.#create(index));
  }

  *[Symbol.iterator](): Iterator<Row> {
    for (let index = 0; index < this.length; index += 1) yield this.at(index)!;
  }
}

/** @internal Lazily maps one borrowed sequence without materializing an intermediate collection. */
export function mapBorrowedSequence<Source, Value>(
  source: BorrowedCommandSequence<Source>,
  map: (value: Source, index: number) => Value,
): BorrowedCommandSequence<Value> {
  return new LazyCommandSequence(source.length, (index) => map(source.at(index)!, index));
}

class ResourceCommandView implements TypedResourceCommand {
  readonly #mapper: TypedCommandBufferMapper;
  readonly #view: RenderPlanReader;
  readonly #offset: number;

  constructor(
    mapper: TypedCommandBufferMapper,
    _state: TypedSourceState,
    view: RenderPlanReader,
    table: RenderPlanTable,
    index: number,
  ) {
    this.#mapper = mapper;
    this.#view = view;
    this.#offset = view.record(table, index);
  }

  get kind(): TypedResourceCommand['kind'] {
    const wire = this.#view.u16(this.#offset + resourceLayout.action);
    const actions = textShaperAbi.engine.resourceActions;
    return wire === actions.create ? 'acquire' : wire === actions.update ? 'update' : 'retain';
  }

  get resource(): TypedResource {
    return this.#mapper.resource(
      this.#view.u32(this.#offset + resourceLayout.id),
      this.#view.u32(this.#offset + resourceLayout.generation),
      this.#view.u32(this.#offset + resourceLayout.techniqueId),
      this.#view.u16(this.#offset + resourceLayout.resourceKind),
      this.#view.u32(this.#offset + resourceLayout.referenceId),
    );
  }
}

class BufferCommandView implements TypedBufferCommand {
  readonly kind = 'ensure' as const;
  readonly #mapper: TypedCommandBufferMapper;
  readonly #state: TypedSourceState;
  readonly #view: RenderPlanReader;
  readonly #offset: number;

  constructor(
    mapper: TypedCommandBufferMapper,
    state: TypedSourceState,
    view: RenderPlanReader,
    table: RenderPlanTable,
    index: number,
  ) {
    this.#mapper = mapper;
    this.#state = state;
    this.#view = view;
    this.#offset = view.record(table, index);
  }

  get buffer(): TypedBuffer {
    const binding = this.#view.u16(this.#offset + bufferLayout.policyBufferId);
    return this.#mapper.declareBuffer(
      this.#state,
      this.#view.u32(this.#offset + bufferLayout.id),
      this.#view.u32(this.#offset + bufferLayout.generation),
      this.#view.u32(this.#offset + bufferLayout.programId),
      binding === textShaperAbi.engine.internalBufferBindings.order ? 'order' : binding,
    );
  }

  get program(): TypedProgram {
    return this.#mapper.program(this.#view.u32(this.#offset + bufferLayout.programId));
  }

  get scalarType(): TypedBufferCommand['scalarType'] {
    const wire = this.#view.u8(this.#offset + bufferLayout.scalarType);
    const scalars = textShaperAbi.policy.scalarTypes;
    return wire === scalars.f32 ? 'f32' : wire === scalars.u32 ? 'u32' : 'u16';
  }

  get vectorWidth(): number {
    return this.#view.u8(this.#offset + bufferLayout.vectorWidth);
  }

  get capacityRecords(): number {
    return this.#view.u32(this.#offset + bufferLayout.capacityRecords);
  }

  get byteLength(): number {
    return this.#view.u32(this.#offset + bufferLayout.byteLength);
  }
}

class PatchCommandView {
  readonly #mapper: TypedCommandBufferMapper;
  readonly #state: TypedSourceState;
  readonly #view: RenderPlanReader;
  readonly #offset: number;

  constructor(
    mapper: TypedCommandBufferMapper,
    state: TypedSourceState,
    view: RenderPlanReader,
    table: RenderPlanTable,
    index: number,
  ) {
    this.#mapper = mapper;
    this.#state = state;
    this.#view = view;
    this.#offset = view.record(table, index);
  }

  get kind(): TypedPatchCommand['kind'] {
    const wire = this.#view.u16(this.#offset + patchLayout.opcode);
    const opcodes = textShaperAbi.engine.patchOpcodes;
    if (wire === opcodes.allocateOrResize) return 'allocate-or-resize';
    if (wire === opcodes.write) return 'write';
    if (wire === opcodes.fill) return 'fill';
    if (wire === opcodes.copy) return 'copy';
    return 'retire';
  }

  get buffer(): TypedBuffer {
    return this.#mapper.buffer(
      this.#view.u32(this.#offset + patchLayout.bufferId),
      this.#view.u32(this.#offset + patchLayout.bufferGeneration),
    );
  }

  get source(): TypedBuffer {
    return this.#mapper.currentBuffer(this.#state, this.#view.u32(this.#offset + patchLayout.sourceBufferId));
  }

  get sourceOffset(): number {
    return this.#view.u32(this.#offset + patchLayout.sourceOffset);
  }

  get destinationOffset(): number {
    return this.#view.u32(this.#offset + patchLayout.destinationOffset);
  }

  get byteLength(): number {
    return this.#view.u32(this.#offset + patchLayout.byteLength);
  }

  get value(): number {
    return this.#view.u32(this.#offset + patchLayout.fillValue);
  }

  get payload(): Uint8Array {
    return this.#view.bytes(this.#view.u32(this.#offset + patchLayout.payloadOffset), this.byteLength);
  }
}

class InstanceSpanView implements TypedInstanceSpan {
  readonly #mapper: TypedCommandBufferMapper;
  readonly #state: TypedSourceState;
  readonly #view: RenderPlanReader;
  readonly #offset: number;

  constructor(
    mapper: TypedCommandBufferMapper,
    state: TypedSourceState,
    view: RenderPlanReader,
    table: RenderPlanTable,
    index: number,
  ) {
    this.#mapper = mapper;
    this.#state = state;
    this.#view = view;
    this.#offset = view.record(table, index);
  }

  get identity(): InstanceSpanIdentity {
    return this.#mapper.instanceSpan(this.#state, this.#view.u32(this.#offset + primitiveLayout.id), {
      view: this.#view,
      offset: this.#offset,
    });
  }

  get kind(): TypedInstanceSpan['kind'] {
    const wire = this.#view.u16(this.#offset + primitiveLayout.kind);
    const kinds = textShaperAbi.engine.primitiveKinds;
    if (wire === kinds.glyph) return 'glyph';
    if (wire === kinds.decoration) return 'decoration';
    if (wire === kinds.inlineObject) return 'inline-object';
    if (wire === kinds.clip) return 'clip';
    return 'codec';
  }

  get recordIndex(): number {
    return this.#view.u32(this.#offset + primitiveLayout.recordIndex);
  }

  get recordCount(): number {
    return this.#view.u16(this.#offset + primitiveLayout.recordCount);
  }

  get logicalOrder(): number {
    return this.#view.u32(this.#offset + primitiveLayout.logicalOrder);
  }
}

class BatchView implements TypedBatch {
  readonly kind = 'batch' as const;
  readonly #mapper: TypedCommandBufferMapper;
  readonly #state: TypedSourceState;
  readonly #view: RenderPlanReader;
  readonly #offset: number;
  readonly #primitiveTable: RenderPlanTable;
  #instances: BorrowedCommandSequence<TypedInstanceSpan> | undefined;

  constructor(
    mapper: TypedCommandBufferMapper,
    state: TypedSourceState,
    view: RenderPlanReader,
    offset: number,
    primitiveTable: RenderPlanTable,
  ) {
    this.#mapper = mapper;
    this.#state = state;
    this.#view = view;
    this.#offset = offset;
    this.#primitiveTable = primitiveTable;
  }

  get identity(): BatchIdentity {
    return this.#mapper.batch(this.#state, this.#view.u32(this.#offset + drawLayout.id), {
      view: this.#view,
      offset: this.#offset,
    });
  }

  get instances(): BorrowedCommandSequence<TypedInstanceSpan> {
    const start = this.#view.u32(this.#offset + drawLayout.primitiveStart);
    const count = this.#view.u32(this.#offset + drawLayout.primitiveCount);
    return (this.#instances ??= new LazyCommandSequence(
      count,
      (index) => new InstanceSpanView(this.#mapper, this.#state, this.#view, this.#primitiveTable, start + index),
    ));
  }
}

class RootInstanceView implements TypedRootInstance {
  readonly kind = 'instance' as const;
  readonly #mapper: TypedCommandBufferMapper;
  readonly #state: TypedSourceState;
  readonly #view: RenderPlanReader;
  readonly #offset: number;

  constructor(mapper: TypedCommandBufferMapper, state: TypedSourceState, view: RenderPlanReader, offset: number) {
    this.#mapper = mapper;
    this.#state = state;
    this.#view = view;
    this.#offset = offset;
  }

  get identity(): InstanceIdentity {
    return this.#mapper.instance(this.#state, this.#view.u32(this.#offset + drawLayout.id), {
      view: this.#view,
      offset: this.#offset,
    });
  }

  get transform(): TransformIdentity | undefined {
    const id = this.#view.u32(this.#offset + drawLayout.transformId);
    return id === 0 ? undefined : this.#mapper.transform(this.#state, id);
  }
}

class RetirementCommandView {
  readonly #mapper: TypedCommandBufferMapper;
  readonly #state: TypedSourceState;
  readonly #view: RenderPlanReader;
  readonly #offset: number;

  constructor(
    mapper: TypedCommandBufferMapper,
    state: TypedSourceState,
    view: RenderPlanReader,
    table: RenderPlanTable,
    index: number,
  ) {
    this.#mapper = mapper;
    this.#state = state;
    this.#view = view;
    this.#offset = view.record(table, index);
  }

  get kind(): TypedRetirementCommand['kind'] {
    const wire = this.#view.u16(this.#offset + retirementLayout.kind);
    const kinds = textShaperAbi.engine.retirementKinds;
    if (wire === kinds.resource) return 'resource';
    if (wire === kinds.buffer) return 'buffer';
    if (wire === kinds.slotRange) return 'slot-range';
    return 'output-bytes';
  }

  get resource(): TypedResource {
    return this.#mapper.resource(
      this.#view.u32(this.#offset + retirementLayout.id),
      this.#view.u32(this.#offset + retirementLayout.generation),
      0,
      0,
      0,
    );
  }

  get buffer(): TypedBuffer {
    return this.#mapper.retireBuffer(
      this.#state,
      this.#view.u32(this.#offset + retirementLayout.id),
      this.#view.u32(this.#offset + retirementLayout.generation),
    );
  }

  get byteOffset(): number {
    return this.#view.u32(this.#offset + retirementLayout.byteOffset);
  }

  get byteLength(): number {
    return this.#view.u32(this.#offset + retirementLayout.byteLength);
  }
}

function opaqueIdentity<Value extends object>(): Value {
  return Object.freeze({}) as Value;
}

function intern<Value extends object>(values: Map<number, Value>, id: number): Value {
  let value = values.get(id);
  if (value === undefined) {
    value = opaqueIdentity<Value>();
    values.set(id, value);
  }
  return value;
}

function transformBindingMap(
  transforms: PlanCandidate['transforms'],
): ReadonlyMap<number, Readonly<{ binding: HandleTransformBinding; recordIndex: number }>> {
  const bindings = new Map<number, Readonly<{ binding: HandleTransformBinding; recordIndex: number }>>();
  for (const { transformIndex, instanceIds, binding } of transforms) {
    const record = Object.freeze({ binding, recordIndex: transformIndex });
    bindings.set(transformIndex, record);
    if (instanceIds !== undefined) for (const instanceId of instanceIds) bindings.set(instanceId, record);
  }
  return bindings;
}
