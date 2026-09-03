import tgpu from 'typegpu';

import {
  type BufferPatch,
  type CommandBufferView,
  type CodecBufferId,
  type PortableGeometryPayload,
  type CodecScalarType,
  type TechniqueGeometryDeclaration,
  type TechniqueResourceDeclaration,
  type TechniqueResourceDeclarations,
} from '@pmndrs/glyph';
import { resolveRasterCodec } from '@pmndrs/glyph/config/raster';
import { assertPortableResource } from '@pmndrs/glyph/config/resources';
import { glyphExampleCodec } from '@pmndrs/glyph-example-raster';
import {
  glyphExampleFragment,
  glyphExampleTypeGpuVariant,
  glyphExampleVertex,
} from '@pmndrs/glyph-example-raster/typegpu';

import type { ExampleBindings, ExampleBufferBinding, ExampleResolvedResource } from './config.js';
import type { ExampleDraw, ExampleDrawList, ExamplePrimitiveRecord } from './draw-list.js';
import { EXAMPLE_RENDERER_PROGRAM_NAMESPACE } from './codec.js';

/** One named instance-buffer input required by an example renderer shader. */
export interface ExampleRendererShaderBuffer {
  readonly id: CodecBufferId;
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

/** A renderer-selected shader realization for one portable technique variant. */
export interface ExampleRendererShader<Variant extends ExampleRendererShaderVariant = ExampleRendererShaderVariant> {
  readonly variant: Variant;
  readonly programNamespace: string;
  readonly programName?: string;
  readonly programVariant: number;
  readonly vertexWgsl: string;
  readonly fragmentWgsl: string;
}

/** One prepared publication whose commit only swaps already-realized state. */
export interface ExamplePendingSubmission {
  readonly result: ExampleDrawList;
  commit(): boolean;
  discard(): void;
}

/** Candidate recording state used by concrete devices before publication. */
export interface RecordingPendingSubmission extends ExamplePendingSubmission {
  readonly replacesRenderState: boolean;
  readonly realizedDraws: readonly ExampleRealizedDraw[];
  readonly buffersByName: ReadonlyMap<string, Uint8Array>;
  readonly activeResources: ReadonlyMap<ExampleResolvedResource, unknown>;
  publish(beforeCommit: () => void): boolean;
  publishAsync(beforeCommit: () => Promise<void>): Promise<boolean>;
}

type GlyphExampleRendererShader = ExampleRendererShader<typeof glyphExampleTypeGpuVariant>;
const GLYPH_EXAMPLE_PROGRAM_VARIANT = glyphExampleCodec.programVariant ?? 0;

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

/** Lazily resolved TypeGPU shader metadata used by the concrete example device. */
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

/** A narrow device seam: bound command preparation is atomic and does not submit a host frame. */
export interface ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
  decode(view: CommandBufferView<ExampleBindings>): ExamplePendingSubmission;
  /** Release accepted renderer state without taking ownership of the caller's device object. */
  reset(): void;
}

interface RetainedExampleBuffer {
  readonly binding: ExampleBufferBinding;
  readonly scalarType: CodecScalarType;
  readonly vectorWidth: number;
  readonly capacityRecords: number;
  readonly bytes: Uint8Array;
}

/** Concrete geometry and draw counts resolved from one portable primitive. */
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

/** One realized draw with concrete geometry and shader bindings. */
export interface ExampleRealizedDraw extends ExampleDrawBindings {
  readonly draw: ExampleDraw;
  readonly primitive: ExamplePrimitiveRecord;
  readonly geometry: ExampleGeometry;
}

/** Deterministic CPU oracle and reference implementation of the bound renderer contract. */
export class RecordingExampleRendererDevice implements ExampleRendererDevice {
  readonly shader: ExampleRendererShader;
  readonly resources: Map<ExampleResolvedResource, unknown> = new Map();
  readonly resourcesByName: Map<string, unknown> = new Map();
  readonly geometriesByName: Map<string, ExampleGeometry> = new Map();
  readonly buffers: Map<ExampleBufferBinding, Uint8Array> = new Map();
  readonly buffersByName: Map<string, Uint8Array> = new Map();
  readonly submissions: ExampleDrawList[] = [];
  readonly realizedDraws: ExampleRealizedDraw[] = [];
  #retainedBuffers = new Map<ExampleBufferBinding, RetainedExampleBuffer>();
  #draws: readonly ExampleDraw[] = [];
  #revision = 0;
  #asyncPublicationInFlight = false;

  constructor(shader: ExampleRendererShader = exampleRendererShader) {
    assertExampleRendererShader(shader);
    this.shader = shader;
  }

  decode(frame: CommandBufferView<ExampleBindings>): RecordingPendingSubmission {
    this.#assertMutable('prepare a publication');
    const revision = this.#revision;
    const resources = new Map(this.resources);
    for (const command of frame.updates.resources) {
      validateResolvedResource(this.shader, command.resource);
      resources.set(command.resource, command.resource.resource);
    }
    for (const retirement of frame.updates.retirements) {
      if (retirement.kind === 'resource') resources.delete(retirement.resource);
    }

    const buffers = cloneBuffers(this.#retainedBuffers);
    for (const command of frame.updates.buffers) {
      const existing = buffers.get(command.buffer);
      buffers.set(command.buffer, {
        binding: command.buffer,
        scalarType: command.scalarType,
        vectorWidth: command.vectorWidth,
        capacityRecords: command.capacityRecords,
        bytes: existing?.bytes ?? new Uint8Array(command.byteLength),
      });
    }
    for (const patch of frame.updates.patches) applyPatch(buffers, patch);
    for (const retirement of frame.updates.retirements) {
      if (retirement.kind === 'buffer') buffers.delete(retirement.buffer);
    }

    const groupChanged = frame.displayList.kind === 'replace';
    const draws = groupChanged ? retainDraws(frame) : this.#draws;
    const replacesRenderState =
      groupChanged ||
      frame.updates.resources.length !== 0 ||
      frame.updates.buffers.length !== 0 ||
      frame.updates.patches.length !== 0 ||
      frame.updates.retirements.length !== 0;
    const realized = replacesRenderState
      ? draws.map((draw) => realizeDraw(this.shader, draw, buffers))
      : [...this.realizedDraws];
    const resourcesByName = resourcesByNameFrom(resources);
    const geometriesByName = geometriesByNameFrom(this.shader, resources);
    const buffersByName = buffersByNameFrom(this.shader, buffers);
    const result: ExampleDrawList = Object.freeze({
      engineRevision: frame.engineRevision,
      revision: frame.revision,
      publicationGeneration: frame.publicationGeneration,
      checkpoint: frame.checkpoint,
      changed: replacesRenderState,
      draws: Object.freeze(groupChanged ? [...draws] : []),
    });
    const commitPreparedState = (): void => {
      replaceMap(this.resources, resources);
      replaceMap(this.resourcesByName, resourcesByName);
      replaceMap(this.geometriesByName, geometriesByName);
      replaceMap(this.#retainedBuffers, buffers);
      replaceMap(this.buffers, new Map([...buffers].map(([binding, value]) => [binding, value.bytes])));
      replaceMap(this.buffersByName, buffersByName);
      this.#draws = draws;
      this.realizedDraws.splice(0, this.realizedDraws.length, ...realized);
      this.submissions.push(result);
      this.#revision += 1;
    };
    let active = true;
    const publish = (beforeCommit: () => void): boolean => {
      if (!active) return false;
      this.#assertMutable('publish a submission');
      active = false;
      if (this.#revision !== revision) return false;
      beforeCommit();
      commitPreparedState();
      return true;
    };
    const publishAsync = async (beforeCommit: () => Promise<void>): Promise<boolean> => {
      if (!active) return false;
      this.#assertMutable('publish a submission');
      active = false;
      if (this.#revision !== revision) return false;
      this.#asyncPublicationInFlight = true;
      try {
        await beforeCommit();
        commitPreparedState();
        return true;
      } finally {
        this.#asyncPublicationInFlight = false;
      }
    };
    return Object.freeze({
      result,
      replacesRenderState,
      realizedDraws: Object.freeze(realized),
      buffersByName,
      activeResources: resources,
      publish,
      publishAsync,
      commit: () => publish(() => undefined),
      discard: () => {
        active = false;
      },
    });
  }

  reset(): void {
    this.resources.clear();
    this.resourcesByName.clear();
    this.geometriesByName.clear();
    this.buffers.clear();
    this.buffersByName.clear();
    this.#retainedBuffers.clear();
    this.#draws = [];
    this.realizedDraws.splice(0);
    this.#revision += 1;
  }

  #assertMutable(operation: string): void {
    if (this.#asyncPublicationInFlight) {
      throw new Error(`example renderer cannot ${operation} while an asynchronous publication is in progress`);
    }
  }
}

function retainDraws(frame: CommandBufferView<ExampleBindings>): readonly ExampleDraw[] {
  if (frame.displayList.kind !== 'replace') return [];
  const draws: ExampleDraw[] = [];
  for (const child of frame.displayList.value.children) {
    const input = child.value.input;
    const spans = child.kind === 'batch' ? child.instances : [child.value.input.instance];
    for (const span of spans) {
      const primitive = span.value.input;
      draws.push(
        Object.freeze({
          kind: child.kind,
          program: input.program.program,
          programVariant: input.programVariant,
          material: input.material,
          buffers: Object.freeze(Array.from(input.buffers)),
          resources: Object.freeze(Array.from(input.resources)),
          flags: input.flags,
          depthKey: input.depthKey,
          order: input.order,
          transform: child.kind === 'instance' ? child.transform : undefined,
          primitive: Object.freeze({
            kind: primitive.kind,
            programVariant: primitive.programVariant,
            resource: primitive.resource,
            buffer: primitive.buffer,
            recordIndex: primitive.recordIndex,
            recordCount: primitive.recordCount,
            logicalOrder: primitive.logicalOrder,
            clip: primitive.clip,
            semantic: primitive.semantic,
            inlineStart: primitive.inlineStart,
            blockStart: primitive.blockStart,
            inlineExtent: primitive.inlineExtent,
            blockExtent: primitive.blockExtent,
          }),
        }),
      );
    }
  }
  return Object.freeze(draws);
}

function realizeDraw(
  shader: ExampleRendererShader,
  draw: ExampleDraw,
  buffers: ReadonlyMap<ExampleBufferBinding, RetainedExampleBuffer>,
): ExampleRealizedDraw {
  if (draw.primitive.kind !== 'glyph') {
    throw new Error(`example renderer does not realize ${draw.primitive.kind} primitives`);
  }
  const namedBuffers = new Map<string, Uint8Array>();
  for (const [name, declaration] of Object.entries(shader.variant.buffers)) {
    const binding = draw.buffers.find(
      (candidate) =>
        candidate.input.declaration.kind === 'codec' && candidate.input.declaration.value.id === declaration.id,
    );
    const retained = binding === undefined ? undefined : buffers.get(binding);
    if (retained === undefined) throw new Error(`example renderer is missing its required "${name}" buffer`);
    namedBuffers.set(name, retained.bytes);
  }
  const namedResources = new Map(draw.resources.map((resource) => [resource.name, resource.resource] as const));
  for (const name of Object.keys(shader.variant.resources)) {
    if (!namedResources.has(name)) throw new Error(`example renderer is missing its required "${name}" resource`);
  }
  const geometry = geometryFor(shader.variant.geometry, namedResources, draw.primitive.recordCount);
  return Object.freeze({ draw, primitive: draw.primitive, geometry, buffers: namedBuffers, resources: namedResources });
}

function cloneBuffers(
  source: ReadonlyMap<ExampleBufferBinding, RetainedExampleBuffer>,
): Map<ExampleBufferBinding, RetainedExampleBuffer> {
  return new Map([...source].map(([binding, buffer]) => [binding, { ...buffer, bytes: buffer.bytes.slice() }]));
}

function applyPatch(
  buffers: Map<ExampleBufferBinding, RetainedExampleBuffer>,
  patch: BufferPatch<ExampleBufferBinding>,
): void {
  const targetBinding = patch.kind === 'copy' ? patch.destination : patch.buffer;
  const target = buffers.get(targetBinding);
  if (target === undefined) throw new Error('example renderer patch references an unknown buffer binding');
  switch (patch.kind) {
    case 'allocate-or-resize':
    case 'retire':
      return;
    case 'write':
      target.bytes.set(patch.payload, patch.destinationOffset);
      return;
    case 'fill': {
      const view = new DataView(
        target.bytes.buffer,
        target.bytes.byteOffset + patch.destinationOffset,
        patch.byteLength,
      );
      for (let offset = 0; offset < patch.byteLength; offset += 4) view.setUint32(offset, patch.value, true);
      return;
    }
    case 'copy': {
      const source = buffers.get(patch.source);
      if (source === undefined) throw new Error('example renderer copy references an unknown source buffer binding');
      if (source === target) {
        target.bytes.copyWithin(patch.destinationOffset, patch.sourceOffset, patch.sourceOffset + patch.byteLength);
      } else {
        target.bytes.set(
          source.bytes.subarray(patch.sourceOffset, patch.sourceOffset + patch.byteLength),
          patch.destinationOffset,
        );
      }
    }
  }
}

function resourcesByNameFrom(resources: ReadonlyMap<ExampleResolvedResource, unknown>): Map<string, unknown> {
  return new Map([...resources].map(([binding, resource]) => [binding.name, resource]));
}

function geometriesByNameFrom(
  shader: ExampleRendererShader,
  resources: ReadonlyMap<ExampleResolvedResource, unknown>,
): Map<string, ExampleGeometry> {
  const geometries = new Map<string, ExampleGeometry>();
  if (shader.variant.geometry.kind === 'synthetic-quad') return geometries;
  for (const [binding, resource] of resources) {
    if (binding.name === shader.variant.geometry.resource) {
      geometries.set(binding.name, realizeGeometry(shader.variant.geometry, binding.name, resource));
    }
  }
  return geometries;
}

function buffersByNameFrom(
  shader: ExampleRendererShader,
  buffers: ReadonlyMap<ExampleBufferBinding, RetainedExampleBuffer>,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const buffer of buffers.values()) {
    const declaration = buffer.binding.input.declaration;
    if (declaration.kind !== 'codec') continue;
    const name = Object.entries(shader.variant.buffers).find(([, value]) => value.id === declaration.value.id)?.[0];
    if (name !== undefined) result.set(name, buffer.bytes);
  }
  return result;
}

function validateResolvedResource(shader: ExampleRendererShader, input: ExampleResolvedResource): void {
  const declaration = Object.hasOwn(shader.variant.resources, input.name)
    ? shader.variant.resources[input.name as keyof typeof shader.variant.resources]
    : undefined;
  if (declaration !== undefined) {
    assertDeclaredResource(declaration, input.name, input.resource);
    return;
  }
  if (shader.variant.geometry.kind !== 'synthetic-quad' && shader.variant.geometry.resource === input.name) {
    assertPortableResource('geometry', input.name, input.resource);
    return;
  }
  throw new Error(`example renderer shader does not declare resource "${input.name}"`);
}

function assertDeclaredResource(declaration: TechniqueResourceDeclaration, name: string, resource: unknown): void {
  assertPortableResource(declaration.kind, name, resource);
}

function geometryFor(
  declaration: TechniqueGeometryDeclaration,
  resources: ReadonlyMap<string, unknown>,
  instanceCount: number,
): ExampleGeometry {
  if (declaration.kind === 'synthetic-quad') return syntheticQuadGeometry(instanceCount);
  const name = declaration.resource;
  if (name === undefined) throw new Error('example renderer supplied geometry needs a resource name');
  const resource = resources.get(name);
  if (resource === undefined) throw new Error(`example renderer has no geometry resource "${name}"`);
  return Object.freeze({ ...realizeGeometry(declaration, name, resource), instanceCount });
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
  return Object.freeze({
    kind: 'supplied',
    indexed: indexAccessor !== undefined,
    vertexCount: vertexAccessor.count,
    indexStart: geometry.drawRange?.start ?? 0,
    indexCount: geometry.drawRange?.count ?? streamCount,
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
  const portable = resolveRasterCodec(shader.variant.techniqueId);
  if (portable === undefined)
    throw new TypeError(`example renderer has no portable raster codec for "${shader.variant.techniqueId}"`);
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
  if (!Number.isSafeInteger(shader.programVariant) || shader.programVariant < 0 || shader.programVariant > 0xffff) {
    throw new RangeError('example renderer shader program variant must be an unsigned u16');
  }
  if (shader.programVariant !== (portable.programVariant ?? 0)) {
    throw new TypeError('example renderer shader program variant does not match its portable raster codec');
  }
  assertObject(shader.variant.buffers, 'shader buffers');
  const expected = Object.keys(portable.schema.buffers);
  const actual = Object.keys(shader.variant.buffers);
  if (actual.length !== expected.length || expected.some((name) => !Object.hasOwn(shader.variant.buffers, name))) {
    throw new TypeError('example renderer shader buffers do not match its portable schema');
  }
  for (const [name, buffer] of Object.entries(shader.variant.buffers)) {
    const declaration = portable.schema.buffers[name];
    if (
      declaration === undefined ||
      buffer.id !== declaration.id ||
      buffer.scalar !== declaration.scalar ||
      buffer.vectorWidth !== declaration.lanes.length
    ) {
      throw new TypeError(`example renderer shader buffer "${name}" does not match its portable declaration`);
    }
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`example renderer ${label} must be an object`);
  }
}

function replaceMap<Key, Value>(target: Map<Key, Value>, source: ReadonlyMap<Key, Value>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}
