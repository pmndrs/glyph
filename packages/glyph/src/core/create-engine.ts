import type { PortablePayloadLease } from './render-planner.js';
import type { BackendMaterialBinding, BackendTransformBinding } from './backend.js';
import type {
  AnyGlyphBindings,
  BorrowedTypedCommandBuffer,
  CommandBufferView,
  DisplayListInstanceSpan,
  GlyphDisplayListProjector,
  GlyphConfig,
  GlyphInstanceSpanBindingInput,
  Retirement,
  ResourceLease,
  TypedBuffer,
  TypedInstanceSpan,
  TypedMaterial,
  TypedProgram,
  TypedResource,
} from './glyph-config.js';
import type { PolicyBuffer, PolicyDescriptor, PolicyProgram } from './render-policy.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { bindPatch, bindRetirement } from '../internal/bind-command-buffer.js';
import { mapBorrowedSequence, TypedCommandBufferMapper } from '../internal/typed-command-buffer.js';

interface RetainedResource<Resource extends object> {
  readonly generation: number;
  readonly value: Resource;
  readonly payload: PortablePayloadLease;
  readonly lease: ResourceLease<Resource>;
}

interface RetainedBuffer<Buffer extends object> {
  readonly generation: number;
  readonly value: Buffer;
}

interface ProjectedState<Bindings extends AnyGlyphBindings> {
  readonly resources: Map<number, RetainedResource<Bindings['resource']>>;
  readonly buffers: Map<number, RetainedBuffer<Bindings['buffer']>>;
  readonly fresh: ReadonlySet<RetainedResource<Bindings['resource']>>;
}

/** Inputs for the renderer-neutral command binding engine used by one publication root. */
export interface CreateEngineOptions<Bindings extends AnyGlyphBindings, Root, PortableResource> {
  readonly config: Pick<
    GlyphConfig<
      import('./glyph-config.js').GlyphHandle,
      Bindings,
      unknown,
      PortableResource,
      Readonly<Record<string, AnyRasterTechnique>>,
      Root
    >,
    'schema' | 'resolve'
  >;
  readonly codec: Readonly<{ descriptor: PolicyDescriptor }>;
  readonly root: Root;
  /** Core-owned association from an opaque plan identity to the adapter-authored value. */
  readonly materialInput?: (binding: BackendMaterialBinding) => Bindings['materialInput'];
  /** Core-owned association from an opaque plan identity to the adapter-authored value. */
  readonly transformInput?: (binding: BackendTransformBinding) => Bindings['transformInput'];
}

/**
 * Creates the retained mapper/binder for one publication root. Integrations provide only
 * their config schema; raw plan access, resource transactions, and identity settlement stay here.
 */
export function createEngine<Bindings extends AnyGlyphBindings, Root, PortableResource>(
  options: CreateEngineOptions<Bindings, Root, PortableResource>,
): GlyphDisplayListProjector<Bindings> {
  return new CommandBindingEngine(options);
}

class CommandBindingEngine<
  Bindings extends AnyGlyphBindings,
  Root,
  PortableResource,
> implements GlyphDisplayListProjector<Bindings> {
  readonly #config: CreateEngineOptions<Bindings, Root, PortableResource>['config'];
  readonly #root: Root;
  readonly #materialInput: NonNullable<CreateEngineOptions<Bindings, Root, PortableResource>['materialInput']>;
  readonly #transformInput: NonNullable<CreateEngineOptions<Bindings, Root, PortableResource>['transformInput']>;
  readonly #mapper = new TypedCommandBufferMapper();
  readonly #programsById: ReadonlyMap<number, PolicyProgram>;
  readonly #programs = new WeakMap<object, Bindings['program']>();
  readonly #buffers = new WeakMap<object, Bindings['buffer']>();
  readonly #materials = new WeakMap<object, Bindings['material']>();
  readonly #transforms = new WeakMap<object, Bindings['transform']>();
  readonly #projected = new WeakMap<BorrowedTypedCommandBuffer, CommandBufferView<Bindings>>();
  readonly #states = new WeakMap<CommandBufferView<Bindings>, ProjectedState<Bindings>>();
  #resourcesById = new Map<number, RetainedResource<Bindings['resource']>>();
  #buffersById = new Map<number, RetainedBuffer<Bindings['buffer']>>();
  #disposed = false;

  constructor(options: CreateEngineOptions<Bindings, Root, PortableResource>) {
    this.#config = options.config;
    this.#root = options.root;
    this.#materialInput = options.materialInput ?? ((binding) => binding as Bindings['materialInput']);
    this.#transformInput = options.transformInput ?? ((binding) => binding as Bindings['transformInput']);
    this.#programsById = new Map(
      options.codec.descriptor.programs.map((program) => [program.programId as number, program]),
    );
  }

  source(candidate: Parameters<GlyphDisplayListProjector<Bindings>['source']>[0], signal: AbortSignal) {
    this.#assertActive();
    return this.#mapper.source(candidate, signal);
  }

  project(source: BorrowedTypedCommandBuffer): CommandBufferView<Bindings> {
    this.#assertActive();
    if (this.#projected.has(source)) throw new TypeError('a command buffer may be projected only once');
    const candidate = this.#mapper.candidate(source);
    const signal = this.#mapper.signal(source);
    signal.throwIfAborted();
    const previousResources = this.#resourcesById;
    const previousBuffers = this.#buffersById;
    const changesBindings =
      source.updates.resources.length !== 0 ||
      source.updates.buffers.length !== 0 ||
      source.updates.retirements.length !== 0;
    const resources = changesBindings ? new Map(previousResources) : previousResources;
    const buffers = changesBindings ? new Map(previousBuffers) : previousBuffers;
    const fresh = new Set<RetainedResource<Bindings['resource']>>();
    const resourceValues = new WeakMap<object, Bindings['resource']>();

    try {
      const boundResources = Array.from(source.updates.resources, (command) => {
        const record = this.#mapper.resourceIdentity(command.resource);
        let retained = resources.get(record.id);
        if (retained?.generation !== record.generation) {
          const payload = candidate.acquirePayload(
            record.referenceId as Parameters<typeof candidate.acquirePayload>[0],
          );
          let lease: ResourceLease<Bindings['resource']> | undefined;
          try {
            const companions = new Map(
              payload.resources.map((entry) => [entry.resourceName, entry.payload as PortableResource]),
            );
            lease = this.#config.resolve({
              technique: payload.techniqueId,
              resourceKind: String(record.resourceKind),
              resourceName: payload.resourceName,
              payload: payload.payload as PortableResource,
              resources: companions,
              previous: retained?.value,
              signal,
            });
            retained = { generation: record.generation, value: lease.value, payload, lease };
            resources.set(record.id, retained);
            fresh.add(retained);
          } catch (error) {
            lease?.dispose();
            payload.dispose();
            throw error;
          }
        }
        if (retained === undefined) throw new Error('resource binding was not retained');
        resourceValues.set(command.resource, retained.value);
        return Object.freeze({ kind: command.kind, resource: retained.value });
      });

      const boundBuffers = Array.from(source.updates.buffers, (command) => {
        const record = this.#mapper.bufferIdentity(command.buffer);
        const program = this.#program(command.program);
        let retained = buffers.get(record.id);
        if (retained?.generation !== record.generation) {
          const declaration = this.#bufferDeclaration(record.programId, record.bindingId);
          const value = this.#config.schema.buffer(this.#root, { program, declaration });
          retained = { generation: record.generation, value };
          buffers.set(record.id, retained);
          this.#buffers.set(command.buffer, value);
        }
        return Object.freeze({
          kind: command.kind,
          buffer: retained.value,
          program,
          scalarType: command.scalarType,
          vectorWidth: command.vectorWidth,
          capacityRecords: command.capacityRecords,
          byteLength: command.byteLength,
        });
      });

      const boundPatches = mapBorrowedSequence(source.updates.patches, (patch) =>
        bindPatch(patch, (identity) => this.#buffer(identity, buffers)),
      );

      const boundRetirements: Retirement<Bindings['resource'], Bindings['buffer']>[] = [];
      for (const retirement of source.updates.retirements) {
        const bound = bindRetirement(retirement, {
          resource: (resource) => {
            const identity = this.#mapper.resourceIdentity(resource);
            const retired = previousResources.get(identity.id);
            if (retired === undefined || retired.generation !== identity.generation) return undefined;
            if (resources.get(identity.id)?.generation === identity.generation) resources.delete(identity.id);
            return retired.value;
          },
          buffer: (buffer) => {
            const identity = this.#mapper.bufferIdentity(buffer);
            const retired = previousBuffers.get(identity.id);
            if (retired === undefined || retired.generation !== identity.generation) return undefined;
            if (buffers.get(identity.id)?.generation === identity.generation) buffers.delete(identity.id);
            return retired.value;
          },
        });
        if (bound !== undefined) boundRetirements.push(bound);
      }

      const bindSpan = (span: TypedInstanceSpan) => {
        const details = this.#mapper.instanceSpanBindingDescriptor(source, span.identity);
        const input: GlyphInstanceSpanBindingInput<Bindings> = Object.freeze({
          identity: span.identity,
          kind: span.kind,
          program: this.#program(details.program),
          programVariant: details.programVariant,
          resource:
            details.resource === undefined ? undefined : this.#resource(details.resource, resources, resourceValues),
          buffer: details.buffer === undefined ? undefined : this.#buffer(details.buffer, buffers),
          recordIndex: span.recordIndex,
          recordCount: span.recordCount,
          logicalOrder: span.logicalOrder,
          clip: details.clip,
          semantic: details.semantic,
          inlineStart: details.inlineStart,
          blockStart: details.blockStart,
          inlineExtent: details.inlineExtent,
          blockExtent: details.blockExtent,
        });
        return Object.freeze({
          value: this.#config.schema.instanceSpan(this.#root, input),
          kind: span.kind,
          recordIndex: span.recordIndex,
          recordCount: span.recordCount,
          logicalOrder: span.logicalOrder,
        }) satisfies DisplayListInstanceSpan<Bindings['instanceSpan']>;
      };

      const group =
        source.group.kind === 'unchanged'
          ? Object.freeze({ kind: 'unchanged' as const })
          : Object.freeze({
              kind: 'replace' as const,
              value: Object.freeze({
                drawRoot: this.#config.schema.drawRoot(this.#root),
                transforms: mapBorrowedSequence(
                  arraySequence(this.#mapper.transformBindings(source)),
                  ({ binding, recordIndex }) =>
                    Object.freeze({ value: this.#transform(binding, recordIndex), recordIndex }),
                ),
                children: mapBorrowedSequence(source.group.value.children, (child) => {
                  const details = this.#mapper.drawBindingDescriptor(source, child.identity);
                  const common = {
                    program: this.#program(details.program),
                    programVariant: details.programVariant,
                    material: this.#material(details.material),
                    buffers: mapBorrowedSequence(details.buffers, (buffer) => this.#buffer(buffer, buffers)),
                    resources: mapBorrowedSequence(details.resources, (resource) =>
                      this.#resource(resource, resources, resourceValues),
                    ),
                    flags: details.flags,
                    clip: details.clip,
                    depthKey: details.depthKey,
                    order: details.order,
                    indirect:
                      details.indirect === undefined
                        ? undefined
                        : Object.freeze({
                            buffer: this.#buffer(details.indirect.buffer, buffers),
                            byteOffset: details.indirect.byteOffset,
                          }),
                  };
                  if (child.kind === 'batch') {
                    const instances = mapBorrowedSequence(child.instances, bindSpan);
                    return Object.freeze({
                      kind: child.kind,
                      value: this.#config.schema.batch(this.#root, {
                        identity: child.identity,
                        instances,
                        ...common,
                      }),
                      instances,
                    });
                  }
                  const transform =
                    child.transform === undefined
                      ? undefined
                      : this.#transform(
                          this.#mapper.transformBinding(child.transform),
                          this.#mapper.transformIndex(child.transform),
                        );
                  const instance = bindSpan(this.#mapper.rootInstanceSpan(source, child.identity));
                  return Object.freeze({
                    kind: child.kind,
                    value: this.#config.schema.instance(this.#root, {
                      identity: child.identity,
                      transform,
                      instance,
                      ...common,
                    }),
                    transform,
                  });
                }),
              }),
            });

      const frame = Object.freeze({
        delivery: 'borrowed-command-buffer' as const,
        engineRevision: source.engineRevision,
        planRevision: source.planRevision,
        publicationGeneration: source.publicationGeneration,
        checkpoint: source.checkpoint,
        updates: Object.freeze({
          resources: Object.freeze(boundResources),
          buffers: Object.freeze(boundBuffers),
          patches: boundPatches,
          retirements: Object.freeze(boundRetirements),
        }),
        displayList: group,
      });
      this.#projected.set(source, frame);
      this.#states.set(frame, { resources, buffers, fresh });
      return frame;
    } catch (error) {
      for (const retained of fresh) this.#disposeResource(retained);
      throw error;
    }
  }

  settle(source: BorrowedTypedCommandBuffer, frame: CommandBufferView<Bindings> | undefined, accepted: boolean): void {
    const projected = this.#projected.get(source);
    this.#projected.delete(source);
    let state: ProjectedState<Bindings> | undefined;
    try {
      if (projected === undefined) throw new TypeError('cannot settle an unprojected command buffer');
      state = this.#states.get(projected);
      this.#states.delete(projected);
      if (state === undefined || frame !== projected)
        throw new TypeError('cannot settle a foreign command buffer view');
      if (!accepted) return;
      const retained = new Set(state.resources.values());
      const candidates = new Set([...this.#resourcesById.values(), ...state.fresh]);
      for (const resource of candidates) {
        if (!retained.has(resource)) this.#disposeResource(resource);
      }
      this.#resourcesById = state.resources;
      this.#buffersById = state.buffers;
    } finally {
      if (!accepted && state !== undefined) for (const resource of state.fresh) this.#disposeResource(resource);
      this.#mapper.settle(source, accepted);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const retained of this.#resourcesById.values()) this.#disposeResource(retained);
    this.#resourcesById.clear();
    this.#buffersById.clear();
    this.#mapper.dispose();
  }

  #program(identity: TypedProgram): Bindings['program'] {
    let value = this.#programs.get(identity);
    if (value !== undefined) return value;
    const programId = this.#mapper.programIdentity(identity);
    const program = this.#programsById.get(programId)!;
    value = this.#config.schema.program(this.#root, program);
    this.#programs.set(identity, value);
    return value;
  }

  #buffer(
    identity: TypedBuffer,
    retained: ReadonlyMap<number, RetainedBuffer<Bindings['buffer']>>,
  ): Bindings['buffer'] {
    const cached = this.#buffers.get(identity);
    if (cached !== undefined) return cached;
    const record = this.#mapper.bufferIdentity(identity);
    const value = retained.get(record.id)?.value;
    if (value === undefined) throw new Error('command references an unknown buffer binding');
    this.#buffers.set(identity, value);
    return value;
  }

  #resource(
    identity: TypedResource,
    retained: ReadonlyMap<number, RetainedResource<Bindings['resource']>>,
    values: WeakMap<object, Bindings['resource']>,
  ): Bindings['resource'] {
    const cached = values.get(identity);
    if (cached !== undefined) return cached;
    const record = this.#mapper.resourceIdentity(identity);
    const value = retained.get(record.id)?.value;
    if (value === undefined) throw new Error('command references an unknown resource binding');
    values.set(identity, value);
    return value;
  }

  #material(identity: TypedMaterial | undefined): Bindings['material'] | undefined {
    if (identity === undefined) return undefined;
    let value = this.#materials.get(identity);
    if (value === undefined) {
      value = this.#config.schema.material(this.#root, this.#materialInput(this.#mapper.materialBinding(identity)));
      this.#materials.set(identity, value);
    }
    return value;
  }

  #transform(binding: BackendTransformBinding, recordIndex = 0): Bindings['transform'] {
    let value = this.#transforms.get(binding);
    if (value === undefined) {
      value = this.#config.schema.transform(this.#root, this.#transformInput(binding), recordIndex);
      this.#transforms.set(binding, value);
    }
    return value;
  }

  #bufferDeclaration(programId: number, bindingId: number | 'order') {
    if (bindingId === 'order') return Object.freeze({ kind: 'order' as const });
    const program = this.#programsById.get(programId)!;
    const declaration = program.buffers.find((buffer: PolicyBuffer) => (buffer.id as number) === bindingId)!;
    return Object.freeze({ kind: 'codec' as const, value: declaration });
  }

  #disposeResource(resource: RetainedResource<Bindings['resource']>): void {
    resource.lease.dispose();
    resource.payload.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('command binding engine is disposed');
  }
}

function arraySequence<Value>(values: readonly Value[]) {
  return Object.freeze({
    length: values.length,
    at: (index: number) => values.at(index),
    *[Symbol.iterator](): Iterator<Value> {
      yield* values;
    },
  });
}
