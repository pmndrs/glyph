import tgpu from 'typegpu';

import {
  assertPortableResource,
  RenderWireIdentityRegistry,
  resolveRasterPlanProgram,
  textShaperAbi,
  type PortableGeometryPayload,
  type RenderProgramId,
  type RenderTechniqueId,
  type TechniqueGeometryDeclaration,
  type TechniqueResourceDeclaration,
  type TechniqueResourceDeclarations,
  type TextEngineBufferRecord,
  type TextEnginePatchRecord,
  type TextEngineRetirementRecord,
} from '@pmndrs/glyph/core';
import { glyphExamplePlanProgram } from '@pmndrs/glyph-example-raster';
import {
  glyphExampleFragment,
  glyphExampleTypeGpuVariant,
  glyphExampleVertex,
} from '@pmndrs/glyph-example-raster/typegpu';

import type { ExampleDraw, ExampleDrawList, ExamplePrimitiveRecord, ExampleResourceRecord } from './draw-list.js';
import { EXAMPLE_RENDERER_PROGRAM_NAMESPACE } from './policy.js';

export interface ExampleRendererShaderBuffer {
  readonly id: number;
  readonly scalar: 'f32' | 'u32';
  readonly vectorWidth: number;
}

type ShaderResourceName<Resources extends TechniqueResourceDeclarations> = Extract<keyof Resources, string>;

/** Renderer-facing metadata shared by shader languages that realize one technique schema. */
export interface ExampleRendererShaderVariant<
  Resources extends TechniqueResourceDeclarations = TechniqueResourceDeclarations,
  Geometry extends TechniqueGeometryDeclaration<ShaderResourceName<Resources>> = TechniqueGeometryDeclaration<
    ShaderResourceName<Resources>
  >,
> {
  readonly language: string;
  readonly techniqueId: string;
  readonly geometry: Geometry;
  readonly buffers: Readonly<Record<string, ExampleRendererShaderBuffer>>;
  readonly resources: Resources;
  readonly outputs: Readonly<Record<string, string>>;
}

export interface ExampleRendererShader<Variant extends ExampleRendererShaderVariant = ExampleRendererShaderVariant> {
  readonly variant: Variant;
  readonly programNamespace: string;
  readonly programName?: string;
  readonly programVariant: number;
  readonly vertexWgsl: string;
  readonly fragmentWgsl: string;
}

export interface ExampleRendererResourceInput {
  readonly id: number;
  readonly generation: number;
  readonly name: string;
  readonly resource: unknown;
}

/** A fully validated resource batch that has not touched live device state. */
export interface ExamplePendingResources {
  /** Apply once without throwing; stale prepared batches are discarded rather than restored. */
  commit(): void;
}

/** One fully validated publication whose commit only swaps prepared owned state. */
export interface ExamplePendingSubmission {
  commit(): void;
}

/** Candidate recording state used by a concrete backend to stage work before publication. */
export interface RecordingPendingSubmission extends ExamplePendingSubmission {
  readonly realizedDraws: readonly ExampleRealizedDraw[];
  readonly buffersByName: ReadonlyMap<string, Uint8Array>;
  publish(beforeCommit: () => void): boolean;
}

type GlyphExampleRendererShader = ExampleRendererShader<typeof glyphExampleTypeGpuVariant>;
const GLYPH_EXAMPLE_PROGRAM_VARIANT = glyphExamplePlanProgram.programVariant ?? 0;

let resolvedExampleRendererShader: GlyphExampleRendererShader | undefined;

/** Resolve WGSL only when a device actually selects the TypeGPU realization. */
export function getExampleRendererShader(): GlyphExampleRendererShader {
  if (resolvedExampleRendererShader === undefined) {
    resolvedExampleRendererShader = Object.freeze({
      variant: glyphExampleTypeGpuVariant,
      programNamespace: EXAMPLE_RENDERER_PROGRAM_NAMESPACE,
      programVariant: GLYPH_EXAMPLE_PROGRAM_VARIANT,
      vertexWgsl: tgpu.resolve([glyphExampleVertex]),
      fragmentWgsl: tgpu.resolve([glyphExampleFragment]),
    });
  }
  return resolvedExampleRendererShader;
}

export const exampleRendererShader: GlyphExampleRendererShader = Object.freeze({
  variant: glyphExampleTypeGpuVariant,
  programNamespace: EXAMPLE_RENDERER_PROGRAM_NAMESPACE,
  programVariant: GLYPH_EXAMPLE_PROGRAM_VARIANT,
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
  /** Validate and realize one font's resources without mutating live device state. */
  prepareResources(resources: readonly ExampleRendererResourceInput[]): ExamplePendingResources;
  /** Validate and realize a whole publication without touching accepted device state. */
  prepareSubmission(drawList: ExampleDrawList): ExamplePendingSubmission;
}

/** Deterministic CPU oracle for plan validation and backend tests. */
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
  readonly #resourceIds = new Map<string, Set<number>>();
  readonly #planResources = new Map<number, RetainedExamplePlanResource>();
  readonly #retainedBuffers = new Map<string, RetainedExampleBuffer>();
  readonly #techniqueWireId: RenderTechniqueId;
  readonly #programWireId: RenderProgramId;
  readonly #programVariant: number;
  readonly #renderResourceName: string;
  #resourceRevision = 0;
  #submissionRevision = 0;

  constructor(shader: ExampleRendererShader = exampleRendererShader) {
    assertExampleRendererShader(shader);
    this.shader = shader;
    const identities = new RenderWireIdentityRegistry();
    const portable = resolveRasterPlanProgram(shader.variant.techniqueId)!;
    this.#renderResourceName = portable.schema.render.resource!;
    this.#techniqueWireId = identities.techniqueId(shader.variant.techniqueId);
    this.#programWireId = identities.programId(shader.variant.techniqueId, shader.programNamespace, shader.programName);
    this.#programVariant = unsignedInteger(shader.programVariant, 0xffff, 'shader program variant');
  }

  prepareResources(resources: readonly ExampleRendererResourceInput[]): ExamplePendingResources {
    if (!Array.isArray(resources)) throw new TypeError('example renderer resources must be an array');
    const revision = this.#resourceRevision;
    const state = this.#resourceState();
    const entries: ExampleResourceEntry[] = [];
    for (const input of resources) {
      const entry = validateResourceEntry(state, this.shader, input);
      entries.push(entry);
      absorbResourceEntry(state, entry);
    }
    let active = true;
    return Object.freeze({
      commit: () => {
        if (!active) return;
        active = false;
        // Another commit owns the newer state. Discard this stale batch instead of overwriting it.
        if (this.#resourceRevision !== revision) return;
        this.#replaceResourceState(state);
        if (entries.length !== 0) this.#resourceRevision += 1;
      },
    });
  }

  prepareSubmission(drawList: ExampleDrawList): RecordingPendingSubmission {
    assertDrawList(drawList);
    const resourceRevision = this.#resourceRevision;
    const submissionRevision = this.#submissionRevision;
    const replacesRenderState =
      drawList.resourceRecords.length !== 0 ||
      drawList.bufferRecords.length !== 0 ||
      drawList.primitiveRecords.length !== 0 ||
      drawList.draws.length !== 0 ||
      drawList.patches.length !== 0 ||
      drawList.retirements.length !== 0;
    if (!replacesRenderState) {
      let active = true;
      const publish = (beforeCommit: () => void): boolean => {
        if (!active) return false;
        active = false;
        if (this.#resourceRevision !== resourceRevision || this.#submissionRevision !== submissionRevision)
          return false;
        beforeCommit();
        this.submissions.push(drawList);
        this.#submissionRevision += 1;
        return true;
      };
      return Object.freeze({
        realizedDraws: Object.freeze([...this.realizedDraws]),
        buffersByName: new Map(this.buffersByName),
        publish,
        commit: () => void publish(() => {}),
      });
    }
    const buffers = prepareBufferState(
      this.shader,
      this.#programWireId,
      this.#retainedBuffers,
      drawList.bufferRecords,
      drawList.patches,
      drawList.retirements,
    );
    const resources = this.#resourceState();
    const planResources = preparePlanResourceState(
      this.#techniqueWireId,
      resources,
      this.#planResources,
      drawList.resourceRecords,
      drawList.retirements,
    );
    for (const primitive of drawList.primitiveRecords) {
      validatePrimitiveRecord(
        primitive,
        this.#techniqueWireId,
        this.#programWireId,
        this.#programVariant,
        planResources.retained,
      );
    }
    const realized = drawList.draws.map((draw) =>
      this.#realizeDraw(draw, drawList, buffers, resources, planResources.retained),
    );
    let active = true;
    const publish = (beforeCommit: () => void): boolean => {
      if (!active) return false;
      active = false;
      if (this.#resourceRevision !== resourceRevision || this.#submissionRevision !== submissionRevision) return false;
      beforeCommit();
      replaceMap(this.#retainedBuffers, buffers.retained);
      replaceMap(this.buffers, buffers.activeById);
      replaceMap(this.buffersByName, buffers.activeByName);
      replaceMap(this.#planResources, planResources.retained);
      this.retirements.push(...planResources.retiredIds);
      this.realizedDraws.splice(0, this.realizedDraws.length, ...realized);
      this.submissions.push(drawList);
      this.#submissionRevision += 1;
      return true;
    };
    return Object.freeze({
      realizedDraws: Object.freeze(realized),
      buffersByName: new Map(buffers.activeByName),
      publish,
      commit: () => void publish(() => {}),
    });
  }

  createResource(id: number, name: string, resource: unknown, generation = 1): void {
    this.prepareResources([{ id, generation, name, resource }]).commit();
  }

  applyBufferPlan(
    buffers: readonly TextEngineBufferRecord[],
    patches: readonly TextEnginePatchRecord[],
    retirements: readonly TextEngineRetirementRecord[],
  ): void {
    if (!Array.isArray(buffers) || !Array.isArray(patches) || !Array.isArray(retirements)) {
      throw new TypeError('example renderer buffer plans require arrays');
    }
    const prepared = prepareBufferState(
      this.shader,
      this.#programWireId,
      this.#retainedBuffers,
      buffers,
      patches,
      retirements,
    );
    replaceMap(this.#retainedBuffers, prepared.retained);
    replaceMap(this.buffers, prepared.activeById);
    replaceMap(this.buffersByName, prepared.activeByName);
    this.#submissionRevision += 1;
  }

  bufferBytes(id: number, generation: number): Uint8Array | undefined {
    return this.#retainedBuffers.get(bufferKey(id, generation))?.bytes;
  }

  retireResource(id: number, generation: number): void {
    const state = this.#resourceState();
    const retired = retireResourceState(state, {
      kind: textShaperAbi.engine.retirementKinds.resource,
      id,
      generation,
      afterPublicationGeneration: 0,
      byteOffset: 0,
      byteLength: 0,
    });
    if (!retired) return;
    this.#replaceResourceState(state);
    this.retirements.push(id);
    this.#resourceRevision += 1;
  }

  submit(drawList: ExampleDrawList): void {
    assertDrawList(drawList);
    const buffers: ExampleBufferState = {
      retained: this.#retainedBuffers,
      activeById: this.buffers,
      activeByName: this.buffersByName,
    };
    const resources = this.#resourceState();
    const realized = drawList.draws.map((draw) =>
      this.#realizeDraw(draw, drawList, buffers, resources, this.#planResources),
    );
    this.realizedDraws.push(...realized);
    this.submissions.push(drawList);
    this.#submissionRevision += 1;
  }

  #bufferBindings(
    records: readonly TextEngineBufferRecord[],
    primitive: ExamplePrimitiveRecord,
    state: ExampleBufferState,
  ): ReadonlyMap<string, Uint8Array> {
    const byPolicyId = new Map<number, RetainedExampleBuffer>();
    for (const record of records) {
      const retained = currentBuffer(state, record);
      if (byPolicyId.has(retained.policyBufferId)) {
        throw new Error(`example renderer draw repeats policy buffer ${retained.policyBufferId}`);
      }
      byPolicyId.set(retained.policyBufferId, retained);
    }
    const buffers = new Map<string, Uint8Array>();
    const recordEnd = checkedAdd(primitive.recordIndex, primitive.recordCount, 'primitive record span');
    for (const [name, declaration] of Object.entries(this.shader.variant.buffers)) {
      const retained = byPolicyId.get(declaration.id);
      if (retained === undefined) {
        throw new Error(`example renderer submission is missing its required "${name}" buffer`);
      }
      const scalarType = shaderScalarType(declaration.scalar);
      if (retained.scalarType !== scalarType || retained.vectorWidth !== declaration.vectorWidth) {
        throw new Error(`example renderer buffer "${name}" does not match its shader declaration`);
      }
      if (recordEnd > retained.capacityRecords) {
        throw new RangeError(`example renderer primitive record span exceeds buffer "${name}"`);
      }
      buffers.set(name, retained.bytes);
    }
    return buffers;
  }

  #resourceBindings(
    records: readonly ExampleResourceRecord[],
    primitive: ExamplePrimitiveRecord,
    state: ExampleResourceState,
    planResources: ReadonlyMap<number, RetainedExamplePlanResource>,
  ): ReadonlyMap<string, unknown> {
    const selected = new Set<string>();
    const selectedByName = new Map<string, { readonly referenceId: number; readonly resource: unknown }>();
    for (const record of records) {
      const retained = currentPlanResource(planResources, record);
      const { id, generation, referenceId } = retained;
      if (retained.techniqueId !== this.#techniqueWireId) {
        throw new Error('example renderer resource technique does not match its selected shader');
      }
      if (!state.resources.has(referenceId)) {
        throw new Error(`example renderer draw references stale or unknown resource ${id}:${generation}`);
      }
      const key = resourceKey(id, generation);
      if (selected.has(key)) throw new Error(`example renderer draw repeats resource ${key}`);
      selected.add(key);
      const name = state.resourceNames.get(referenceId);
      const resource = state.resources.get(referenceId);
      if (name === undefined || resource === undefined) {
        throw new Error(`example renderer draw references unbound resource ${key}`);
      }
      if (selectedByName.has(name)) throw new Error(`example renderer draw repeats resource "${name}"`);
      selectedByName.set(name, { referenceId, resource });
    }
    const primaryId = positiveInteger(primitive.resourceId, 'primitive resource id');
    const primaryGeneration = positiveInteger(primitive.resourceGeneration, 'primitive resource generation');
    if (!selected.has(resourceKey(primaryId, primaryGeneration))) {
      throw new Error('example renderer primitive resource is not included in its draw resource span');
    }
    const primary = planResources.get(primaryId);
    if (
      primary?.generation !== primaryGeneration ||
      state.resourceNames.get(primary.referenceId) !== this.#renderResourceName
    ) {
      throw new Error(`example renderer primitive does not select primary resource "${this.#renderResourceName}"`);
    }

    const resources = new Map<string, unknown>();
    for (const name of Object.keys(this.shader.variant.resources)) {
      const selectedResource = selectedByName.get(name);
      if (selectedResource === undefined || !state.resourceIds.get(name)?.has(selectedResource.referenceId)) {
        throw new Error(`example renderer submission is missing its required "${name}" resource`);
      }
      resources.set(name, selectedResource.resource);
    }
    return resources;
  }

  #realizeDraw(
    draw: ExampleDraw,
    drawList: ExampleDrawList,
    bufferState: ExampleBufferState,
    resourceState: ExampleResourceState,
    planResources: ReadonlyMap<number, RetainedExamplePlanResource>,
  ): ExampleRealizedDraw {
    assertObject(draw, 'draw');
    positiveInteger(draw.id, 'draw id');
    unsignedInteger(draw.flags, 0xffff, 'draw flags');
    nonnegativeInteger(draw.materialId, 'draw material id');
    nonnegativeInteger(draw.clipId, 'draw clip id');
    nonnegativeInteger(draw.depthKey, 'draw depth key');
    nonnegativeInteger(draw.transformId, 'draw transform id');
    nonnegativeInteger(draw.orderToken, 'draw order token');
    if (draw.indirectBufferId !== 0 || draw.indirectOffset !== 0) {
      throw new Error('example renderer ordered program does not accept indirect draw addressing');
    }
    if (draw.primitiveCount !== 1) throw new Error('example renderer requires one primitive per draw');
    const [primitive] = recordSpan(drawList.primitiveRecords, draw.primitiveStart, draw.primitiveCount, 'primitive');
    if (primitive === undefined) throw new Error('example renderer draw references an unknown primitive');
    assertObject(primitive, 'primitive');
    if (draw.programId !== primitive.programId) {
      throw new Error('example renderer draw and primitive program IDs do not match');
    }
    if (draw.programVariant !== primitive.programVariant) {
      throw new Error('example renderer draw and primitive program variants do not match');
    }
    if (draw.programId !== this.#programWireId || draw.programVariant !== this.#programVariant) {
      throw new Error('example renderer draw program does not match its selected shader');
    }
    if (primitive.techniqueId !== this.#techniqueWireId) {
      throw new Error('example renderer primitive technique does not match its selected shader');
    }
    if (primitive.kind !== textShaperAbi.engine.primitiveKinds.glyph) {
      throw new Error('example renderer selected shader requires a glyph primitive');
    }
    const bufferRecords = recordSpan(drawList.bufferRecords, draw.bufferStart, draw.bufferCount, 'buffer');
    const resourceRecords = recordSpan(drawList.resourceRecords, draw.resourceStart, draw.resourceCount, 'resource');
    const buffers = this.#bufferBindings(bufferRecords, primitive, bufferState);
    const resources = this.#resourceBindings(resourceRecords, primitive, resourceState, planResources);
    const geometry = this.#geometryFor(primitive, resourceState);
    const bindings = Object.freeze({ buffers, resources });
    return Object.freeze({ draw, primitive, geometry, buffers: bindings.buffers, resources: bindings.resources });
  }

  #geometryFor(primitive: ExamplePrimitiveRecord, resources: ExampleResourceState): ExampleGeometry {
    const instanceCount = instanceCountFromRecords(primitive.recordCount);
    const declaration = this.shader.variant.geometry;
    if (declaration.kind === 'synthetic-quad') {
      return syntheticQuadGeometry(instanceCount);
    }
    const name = declaration.resource;
    if (name === undefined) throw new Error('example renderer supplied geometry needs a resource name');
    const geometry = resources.geometriesByName.get(name);
    if (geometry === undefined) throw new Error(`example renderer has no realized geometry resource "${name}"`);
    return Object.freeze({ ...geometry, instanceCount });
  }

  #resourceState(): ExampleResourceState {
    return {
      resources: new Map(this.resources),
      resourcesByName: new Map(this.resourcesByName),
      geometriesByName: new Map(this.geometriesByName),
      resourceNames: new Map(this.#resourceNames),
      resourceGenerations: new Map(this.#resourceGenerations),
      resourceIds: new Map([...this.#resourceIds].map(([name, ids]) => [name, new Set(ids)])),
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
  readonly resourceIds: Map<string, Set<number>>;
}

interface ExampleResourceEntry {
  readonly id: number;
  readonly generation: number;
  readonly name: string;
  readonly resource: unknown;
  readonly geometry?: ExampleGeometry;
}

interface RetainedExamplePlanResource {
  readonly id: number;
  readonly generation: number;
  readonly techniqueId: number;
  readonly resourceKind: number;
  readonly referenceId: number;
}

interface ExamplePlanResourceState {
  readonly retained: ReadonlyMap<number, RetainedExamplePlanResource>;
  readonly retiredIds: readonly number[];
}

interface RetainedExampleBuffer {
  readonly id: number;
  readonly generation: number;
  readonly programId: number;
  readonly policyBufferId: number;
  readonly scalarType: number;
  readonly vectorWidth: number;
  readonly capacityRecords: number;
  readonly bytes: Uint8Array;
}

interface ExampleBufferState {
  readonly retained: ReadonlyMap<string, RetainedExampleBuffer>;
  readonly activeById: ReadonlyMap<number, Uint8Array>;
  readonly activeByName: ReadonlyMap<string, Uint8Array>;
}

export interface ExampleGeometry {
  readonly kind: 'synthetic-quad' | 'supplied';
  readonly indexed: boolean;
  readonly vertexCount: number;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly resourceName?: string;
}

/** Named inputs resolved from the selected shader contract for one submission. */
export interface ExampleDrawBindings {
  readonly buffers: ReadonlyMap<string, Uint8Array>;
  readonly resources: ReadonlyMap<string, unknown>;
}

export interface ExampleRealizedDraw extends ExampleDrawBindings {
  readonly draw: ExampleDraw;
  readonly primitive: ExamplePrimitiveRecord;
  readonly geometry: ExampleGeometry;
  readonly buffers: ReadonlyMap<string, Uint8Array>;
  readonly resources: ReadonlyMap<string, unknown>;
}

function validateResourceEntry(
  state: ExampleResourceState,
  shader: ExampleRendererShader,
  input: ExampleRendererResourceInput,
): ExampleResourceEntry {
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
  const previousGeneration = state.resourceGenerations.get(id);
  if (previousGeneration !== undefined && generation < previousGeneration) {
    throw new Error(`example renderer resource ${id} rejects stale generation ${generation}`);
  }
  if (previousGeneration === generation && state.resources.get(id) !== input.resource) {
    throw new Error(`example renderer resource ${id} changed content without changing generation`);
  }
  const declaration = Object.hasOwn(shader.variant.resources, input.name)
    ? shader.variant.resources[input.name as keyof typeof shader.variant.resources]
    : undefined;
  if (declaration !== undefined) {
    const previousIds = state.resourceIds.get(input.name);
    if (declaration.cardinality !== 'many' && previousIds !== undefined && !previousIds.has(id)) {
      throw new Error(`example renderer resource "${input.name}" already has its singleton binding`);
    }
    assertDeclaredResource(declaration, input.name, input.resource);
  } else if (shader.variant.geometry.kind === 'synthetic-quad' || shader.variant.geometry.resource !== input.name) {
    throw new Error(`example renderer shader does not declare resource "${input.name}"`);
  }
  const geometry =
    shader.variant.geometry.kind !== 'synthetic-quad' && shader.variant.geometry.resource === input.name
      ? realizeGeometry(shader.variant.geometry, input.name, input.resource)
      : undefined;
  return {
    id,
    generation,
    name: input.name,
    resource: input.resource,
    ...(geometry === undefined ? {} : { geometry }),
  };
}

function assertDeclaredResource(declaration: TechniqueResourceDeclaration, name: string, resource: unknown): void {
  assertPortableResource(
    declaration.kind,
    name,
    resource,
    declaration.kind === 'texture' || declaration.kind === 'texture-array' ? declaration.format : undefined,
    declaration.kind === 'geometry' ? declaration.attributes : undefined,
  );
  if (declaration.kind !== 'group') return;
  assertObject(resource, `resource group "${name}"`);
  assertObject(resource.members, `resource group "${name}" members`);
  const expected = Object.keys(declaration.members);
  const actual = Object.keys(resource.members);
  if (expected.length !== actual.length || actual.some((member) => !Object.hasOwn(declaration.members, member))) {
    throw new TypeError(`resource group "${name}" members do not match its shader declaration`);
  }
  for (const member of expected) {
    assertDeclaredResource(declaration.members[member]!, `${name}.${member}`, resource.members[member]);
  }
}

function absorbResourceEntry(state: ExampleResourceState, entry: ExampleResourceEntry): void {
  state.resources.set(entry.id, entry.resource);
  state.resourcesByName.set(entry.name, entry.resource);
  state.resourceNames.set(entry.id, entry.name);
  state.resourceGenerations.set(entry.id, entry.generation);
  const ids = state.resourceIds.get(entry.name) ?? new Set<number>();
  ids.add(entry.id);
  state.resourceIds.set(entry.name, ids);
  if (entry.geometry !== undefined) state.geometriesByName.set(entry.name, entry.geometry);
}

function retireResourceState(state: ExampleResourceState, retirement: TextEngineRetirementRecord): boolean {
  assertObject(retirement, 'resource retirement');
  if (retirement.kind !== textShaperAbi.engine.retirementKinds.resource) return false;
  const id = positiveInteger(retirement.id, 'retired resource id');
  const generation = positiveInteger(retirement.generation, 'retired resource generation');
  if (state.resourceGenerations.get(id) !== generation) return false;
  const name = state.resourceNames.get(id);
  state.resources.delete(id);
  state.resourceGenerations.delete(id);
  state.resourceNames.delete(id);
  if (name !== undefined) {
    const ids = state.resourceIds.get(name);
    ids?.delete(id);
    if (ids?.size === 0) {
      state.resourceIds.delete(name);
      state.resourcesByName.delete(name);
      state.geometriesByName.delete(name);
    } else if (ids !== undefined) {
      const replacement = ids.values().next().value as number | undefined;
      if (replacement !== undefined) state.resourcesByName.set(name, state.resources.get(replacement));
    }
  }
  return true;
}

function preparePlanResourceState(
  techniqueWireId: RenderTechniqueId,
  resources: ExampleResourceState,
  source: ReadonlyMap<number, RetainedExamplePlanResource>,
  records: readonly ExampleResourceRecord[],
  retirements: readonly TextEngineRetirementRecord[],
): ExamplePlanResourceState {
  const retained = new Map(source);
  const seen = new Set<number>();
  for (const record of records) {
    assertObject(record, 'resource record');
    const id = positiveInteger(record.id, 'resource record id');
    const generation = positiveInteger(record.generation, 'resource record generation');
    const referenceId = positiveInteger(record.referenceId, 'resource record reference id');
    const resourceKind = unsignedInteger(record.resourceKind, 32, 'resource record kind');
    if (resourceKind === 0) throw new RangeError('example renderer resource record kind must be positive');
    if (record.techniqueId !== techniqueWireId) {
      throw new Error('example renderer resource technique does not match its selected shader');
    }
    const actions = textShaperAbi.engine.resourceActions;
    if (record.action !== actions.create && record.action !== actions.update && record.action !== actions.retain) {
      throw new Error(`example renderer resource ${id}:${generation} has unsupported action ${record.action}`);
    }
    if (seen.has(id)) throw new Error(`example renderer plan repeats active resource id ${id}`);
    seen.add(id);
    const name = resources.resourceNames.get(referenceId);
    if (name === undefined || !resources.resources.has(referenceId)) {
      throw new Error(`example renderer resource ${id}:${generation} references unknown payload ${referenceId}`);
    }
    const existing = retained.get(id);
    if (existing !== undefined && generation < existing.generation) {
      throw new Error(`example renderer resource ${id} rejects stale generation ${generation}`);
    }
    if (
      existing?.generation === generation &&
      (existing.techniqueId !== techniqueWireId ||
        existing.resourceKind !== resourceKind ||
        existing.referenceId !== referenceId)
    ) {
      throw new Error(`example renderer resource ${id}:${generation} changed metadata without advancing generation`);
    }
    retained.set(id, { id, generation, techniqueId: techniqueWireId, resourceKind, referenceId });
  }
  const retiredIds: number[] = [];
  const resourceRetirement = textShaperAbi.engine.retirementKinds.resource;
  for (const retirement of retirements) {
    if (retirement.kind !== resourceRetirement) continue;
    const current = retained.get(retirement.id);
    if (current?.generation !== retirement.generation) continue;
    retained.delete(retirement.id);
    retiredIds.push(retirement.id);
  }
  return { retained, retiredIds };
}

function currentPlanResource(
  retained: ReadonlyMap<number, RetainedExamplePlanResource>,
  record: ExampleResourceRecord,
): RetainedExamplePlanResource {
  assertObject(record, 'draw resource record');
  const id = positiveInteger(record.id, 'draw resource id');
  const generation = positiveInteger(record.generation, 'draw resource generation');
  const current = retained.get(id);
  if (
    current === undefined ||
    current.generation !== generation ||
    current.techniqueId !== record.techniqueId ||
    current.resourceKind !== record.resourceKind ||
    current.referenceId !== record.referenceId
  ) {
    throw new Error(`example renderer draw references stale or contradictory resource ${id}:${generation}`);
  }
  return current;
}

function validatePrimitiveRecord(
  primitive: ExamplePrimitiveRecord,
  techniqueWireId: RenderTechniqueId,
  programWireId: RenderProgramId,
  programVariant: number,
  resources: ReadonlyMap<number, RetainedExamplePlanResource>,
): void {
  assertObject(primitive, 'primitive');
  positiveInteger(primitive.id, 'primitive id');
  if (primitive.techniqueId !== techniqueWireId) {
    throw new Error('example renderer primitive technique does not match its selected shader');
  }
  if (primitive.programId !== programWireId || primitive.programVariant !== programVariant) {
    throw new Error('example renderer primitive program does not match its selected shader');
  }
  if (primitive.kind !== textShaperAbi.engine.primitiveKinds.glyph) {
    throw new Error('example renderer selected shader requires a glyph primitive');
  }
  const count = positiveInteger(primitive.recordCount, 'primitive record count');
  if (count > 0xffff) throw new RangeError('example renderer primitive record count exceeds u16');
  nonnegativeInteger(primitive.recordIndex, 'primitive record index');
  const resourceId = positiveInteger(primitive.resourceId, 'primitive resource id');
  const resourceGeneration = positiveInteger(primitive.resourceGeneration, 'primitive resource generation');
  if (resources.get(resourceId)?.generation !== resourceGeneration) {
    throw new Error(
      `example renderer primitive references stale or unknown resource ${resourceId}:${resourceGeneration}`,
    );
  }
}

function prepareBufferState(
  shader: ExampleRendererShader,
  programWireId: RenderProgramId,
  source: ReadonlyMap<string, RetainedExampleBuffer>,
  buffers: readonly TextEngineBufferRecord[],
  patches: readonly TextEnginePatchRecord[],
  retirements: readonly TextEngineRetirementRecord[],
): ExampleBufferState {
  if (!Array.isArray(buffers) || !Array.isArray(patches) || !Array.isArray(retirements)) {
    throw new TypeError('example renderer buffer plans require arrays');
  }
  const retained = cloneRetainedBuffers(source);
  const active = new Map<number, string>();
  for (const record of buffers) retainBufferRecord(retained, active, record, programWireId);
  for (const patch of patches) applyBufferPatch(retained, active, patch);
  for (const retirement of retirements) validateRetirement(retirement);
  for (const retirement of retirements) retireBuffer(retained, active, retirement);
  const activeById = new Map<number, Uint8Array>();
  const activeByName = new Map<string, Uint8Array>();
  for (const [id, key] of active) {
    const buffer = retained.get(key);
    if (buffer === undefined) continue;
    activeById.set(id, buffer.bytes);
    const name = declaredBufferName(shader, buffer.policyBufferId);
    if (name !== undefined) activeByName.set(name, buffer.bytes);
  }
  return { retained, activeById, activeByName };
}

function currentBuffer(state: ExampleBufferState, record: TextEngineBufferRecord): RetainedExampleBuffer {
  assertObject(record, 'draw buffer record');
  const id = positiveInteger(record.id, 'draw buffer id');
  const generation = positiveInteger(record.generation, 'draw buffer generation');
  const retained = state.retained.get(bufferKey(id, generation));
  if (retained === undefined || state.activeById.get(id) !== retained.bytes) {
    throw new Error(`example renderer draw references stale or unknown buffer ${id}:${generation}`);
  }
  if (
    record.programId !== retained.programId ||
    record.policyBufferId !== retained.policyBufferId ||
    record.scalarType !== retained.scalarType ||
    record.vectorWidth !== retained.vectorWidth ||
    record.capacityRecords !== retained.capacityRecords ||
    record.byteLength !== retained.bytes.byteLength
  ) {
    throw new Error(`example renderer draw buffer ${id}:${generation} changed shape after retention`);
  }
  return retained;
}

function cloneRetainedBuffers(source: ReadonlyMap<string, RetainedExampleBuffer>): Map<string, RetainedExampleBuffer> {
  return new Map([...source].map(([key, buffer]) => [key, { ...buffer, bytes: buffer.bytes.slice() }] as const));
}

function retainBufferRecord(
  retained: Map<string, RetainedExampleBuffer>,
  active: Map<number, string>,
  record: TextEngineBufferRecord,
  programWireId: RenderProgramId,
): void {
  assertObject(record, 'buffer record');
  const id = positiveInteger(record.id, 'buffer id');
  const generation = positiveInteger(record.generation, 'buffer generation');
  const retainedProgramId = positiveInteger(record.programId, 'buffer program id');
  if (retainedProgramId !== programWireId) {
    throw new Error(`example renderer buffer ${id}:${generation} belongs to a different renderer program`);
  }
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
    (existing.programId !== retainedProgramId ||
      existing.policyBufferId !== policyBufferId ||
      existing.scalarType !== record.scalarType ||
      existing.vectorWidth !== record.vectorWidth ||
      existing.capacityRecords !== capacityRecords ||
      existing.bytes.byteLength !== byteLength)
  ) {
    throw new Error(`example renderer buffer ${key} changed shape without changing generation`);
  }
  if (existing === undefined) {
    retained.set(key, {
      id,
      generation,
      programId: retainedProgramId,
      policyBufferId,
      scalarType: record.scalarType,
      vectorWidth: record.vectorWidth,
      capacityRecords,
      bytes: new Uint8Array(byteLength),
    });
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
  const targetScalarBytes = retainedScalarBytes(target);
  assertAligned(destinationOffset, byteLength, targetScalarBytes, 'buffer patch');
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
    assertAligned(sourceOffset, byteLength, retainedScalarBytes(source), 'copy patch source');
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

function validateRetirement(retirement: TextEngineRetirementRecord): void {
  assertObject(retirement, 'retirement');
  const kinds = textShaperAbi.engine.retirementKinds;
  if (
    retirement.kind !== kinds.resource &&
    retirement.kind !== kinds.buffer &&
    retirement.kind !== kinds.slotRange &&
    retirement.kind !== kinds.outputBytes
  ) {
    throw new Error(`unsupported text-engine retirement kind ${retirement.kind}`);
  }
  positiveInteger(retirement.id, 'retired id');
  positiveInteger(retirement.generation, 'retired generation');
  nonnegativeInteger(retirement.afterPublicationGeneration, 'retirement publication generation');
  nonnegativeInteger(retirement.byteOffset, 'retirement byte offset');
  nonnegativeInteger(retirement.byteLength, 'retirement byte length');
}

function declaredBufferName(shader: ExampleRendererShader, policyBufferId: number): string | undefined {
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

function assertAligned(offset: number, length: number, alignment: number, label: string): void {
  if (offset % alignment !== 0 || length % alignment !== 0) {
    throw new RangeError(`example renderer ${label} is not scalar aligned`);
  }
}

function retainedScalarBytes(buffer: RetainedExampleBuffer): number {
  return buffer.scalarType === textShaperAbi.policy.scalarTypes.u16 ? 2 : 4;
}

function syntheticQuadGeometry(instanceCount: number): ExampleGeometry {
  return Object.freeze({
    kind: 'synthetic-quad',
    indexed: true,
    vertexCount: 4,
    indexStart: 0,
    indexCount: 6,
    instanceCount,
  });
}

function instanceCountFromRecords(recordCount: number): number {
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
  return Object.freeze({
    kind: 'supplied',
    indexed: indexAccessor !== undefined,
    vertexCount: vertexAccessor.count,
    indexStart,
    indexCount,
    instanceCount: 1,
    resourceName: name,
  });
}

function assertExampleRendererShader(shader: ExampleRendererShader): void {
  assertObject(shader, 'shader');
  assertObject(shader.variant, 'shader variant');
  if (typeof shader.variant.language !== 'string' || shader.variant.language.length === 0) {
    throw new TypeError('example renderer shader language is required');
  }
  if (typeof shader.variant.techniqueId !== 'string' || shader.variant.techniqueId.length === 0) {
    throw new TypeError('example renderer shader technique id is required');
  }
  const portable = resolveRasterPlanProgram(shader.variant.techniqueId);
  if (portable === undefined) {
    throw new TypeError(`example renderer has no portable plan for "${shader.variant.techniqueId}"`);
  }
  if (
    shader.variant.geometry !== portable.schema.render.geometry ||
    shader.variant.resources !== portable.schema.resources
  ) {
    throw new TypeError('example renderer shader must use its registered portable geometry and resource schema');
  }
  if (typeof shader.programNamespace !== 'string' || shader.programNamespace.length === 0) {
    throw new TypeError('example renderer shader program namespace is required');
  }
  if (shader.programName !== undefined && (typeof shader.programName !== 'string' || shader.programName.length === 0)) {
    throw new TypeError('example renderer shader program name must be nonempty');
  }
  const variant = unsignedInteger(shader.programVariant, 0xffff, 'shader program variant');
  if (variant !== (portable.programVariant ?? 0)) {
    throw new TypeError('example renderer shader program variant does not match its portable plan');
  }
  assertObject(shader.variant.buffers, 'shader buffers');
  const expectedBufferNames = Object.keys(portable.schema.buffers);
  const actualBufferNames = Object.keys(shader.variant.buffers);
  if (
    actualBufferNames.length !== expectedBufferNames.length ||
    expectedBufferNames.some((name) => !Object.hasOwn(shader.variant.buffers, name))
  ) {
    throw new TypeError('example renderer shader buffers do not match its portable schema');
  }
  const bufferIds = new Set<number>();
  for (const [name, buffer] of Object.entries(shader.variant.buffers)) {
    if (name.length === 0) throw new TypeError('example renderer shader buffer names must not be empty');
    assertObject(buffer, `shader buffer "${name}"`);
    const id = positiveInteger(buffer.id, `shader buffer "${name}" id`);
    if (bufferIds.has(id)) throw new TypeError(`example renderer shader repeats buffer id ${id}`);
    bufferIds.add(id);
    if (buffer.scalar !== 'f32' && buffer.scalar !== 'u32') {
      throw new TypeError(`example renderer shader buffer "${name}" has an unsupported scalar`);
    }
    if (!Number.isSafeInteger(buffer.vectorWidth) || buffer.vectorWidth < 1 || buffer.vectorWidth > 4) {
      throw new RangeError(`example renderer shader buffer "${name}" needs one to four lanes`);
    }
    const declaration = portable.schema.buffers[name];
    if (
      declaration === undefined ||
      id !== declaration.id ||
      buffer.scalar !== declaration.scalar ||
      buffer.vectorWidth !== declaration.lanes.length
    ) {
      throw new TypeError(`example renderer shader buffer "${name}" contradicts its portable schema`);
    }
  }
  assertObject(shader.variant.resources, 'shader resources');
  const renderResource = portable.schema.render.resource;
  if (renderResource === undefined || !Object.hasOwn(shader.variant.resources, renderResource)) {
    throw new TypeError('example renderer portable plan does not select a declared render resource');
  }
  const geometryResource =
    shader.variant.geometry.kind === 'synthetic-quad' ? undefined : shader.variant.geometry.resource;
  if (geometryResource !== undefined && !Object.hasOwn(shader.variant.resources, geometryResource)) {
    throw new TypeError(`example renderer shader geometry resource "${geometryResource}" is not declared`);
  }
  assertObject(shader.variant.outputs, 'shader outputs');
  if (
    Object.keys(shader.variant.outputs).length === 0 ||
    Object.entries(shader.variant.outputs).some(
      ([name, output]) => name.length === 0 || typeof output !== 'string' || output.length === 0,
    )
  ) {
    throw new TypeError('example renderer shader needs named output types');
  }
  if (typeof shader.vertexWgsl !== 'string' || shader.vertexWgsl.length === 0) {
    throw new TypeError('example renderer vertex WGSL is required');
  }
  if (typeof shader.fragmentWgsl !== 'string' || shader.fragmentWgsl.length === 0) {
    throw new TypeError('example renderer fragment WGSL is required');
  }
}

function assertDrawList(drawList: ExampleDrawList): void {
  assertObject(drawList, 'draw list');
  nonnegativeInteger(drawList.engineRevision, 'engine revision');
  nonnegativeInteger(drawList.planRevision, 'plan revision');
  positiveInteger(drawList.publicationGeneration, 'publication generation');
  for (const [name, records] of Object.entries({
    draws: drawList.draws,
    resources: drawList.resourceRecords,
    buffers: drawList.bufferRecords,
    primitives: drawList.primitiveRecords,
    patches: drawList.patches,
    retirements: drawList.retirements,
  })) {
    if (!Array.isArray(records)) throw new TypeError(`example renderer draw list ${name} must be an array`);
  }
}

function recordSpan<Record>(
  records: readonly Record[],
  start: number,
  count: number,
  label: string,
): readonly Record[] {
  if (!Array.isArray(records)) throw new TypeError(`example renderer ${label} records must be an array`);
  const first = nonnegativeInteger(start, `${label} start`);
  const length = nonnegativeInteger(count, `${label} count`);
  const end = checkedAdd(first, length, `${label} span`);
  if (end > records.length) throw new RangeError(`example renderer ${label} span exceeds its table`);
  return records.slice(first, end);
}

function shaderScalarType(scalar: ExampleRendererShaderBuffer['scalar']): number {
  return scalar === 'f32' ? textShaperAbi.policy.scalarTypes.f32 : textShaperAbi.policy.scalarTypes.u32;
}

function resourceKey(id: number, generation: number): string {
  return `${id}:${generation}`;
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`example renderer ${label} exceeds the safe integer range`);
  return result;
}

function unsignedInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`example renderer ${label} must be between 0 and ${maximum}`);
  }
  return value;
}
