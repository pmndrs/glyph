import type { Node, NodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';

import {
  createRasterPolicyProgram,
  resolveRasterPlanProgram,
  type AnyTechniqueSchema,
  type PolicyBufferDeclarations,
  type PolicyScalarKind,
  type RenderIdFactory,
  type PortableResource,
  type PortableTextureFormat,
  type TechniqueGeometryDeclaration,
  type TechniqueResourceDeclaration,
  type TechniqueResourceDeclarations,
  type TextEngineScalarType,
} from '../core.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { ThreeTextMaterial } from './material.js';
import { threePolicyCapabilitySet, threeSystemBuffers } from './render-policy.js';

export interface ThreePlanProgramBuffer {
  readonly scalarType: TextEngineScalarType;
  readonly vectorWidth: number;
  readonly attribute: StorageInstancedBufferAttribute;
}

export interface ThreePlanProgramMaterialContext {
  /** Portable technique selected for this draw. */
  readonly technique: AnyRasterTechnique;
  /** The portable schema selected for this draw. */
  readonly schema: AnyTechniqueSchema;
  /** The selected renderer variant's stable identity. */
  readonly variantId: string;
  /** Shader-language label for diagnostics and implementation selection. */
  readonly language: string;
  /** Buffers addressed by the schema's declared names, never host wire ids. */
  readonly namedBuffers: ReadonlyMap<string, ThreePlanProgramBuffer>;
  /** Retained resources addressed by the schema's declared names. */
  readonly namedResources: ReadonlyMap<string, PortableResource>;
  /** Named output types declared by the selected renderer implementation. */
  readonly outputTypes: Readonly<Record<string, string>>;
  /** Name of the resource referenced by this draw's wire resource record. */
  readonly resourceName: string;
  readonly instance: Node<'uint'>;
  readonly materialId: number;
  readonly material: ThreeTextMaterial | undefined;
  transformPosition(position: Node<'vec3'>): Node<'vec3'>;
}

export interface ThreeRasterPlanBufferCapability<
  Scalar extends PolicyScalarKind = PolicyScalarKind,
  VectorWidth extends number = number,
> {
  readonly scalar: Scalar;
  readonly vectorWidth: VectorWidth;
}

export type ThreeRasterPlanBufferCapabilities<Buffers extends PolicyBufferDeclarations> = {
  readonly [Name in keyof Buffers]: ThreeRasterPlanBufferCapability<
    Buffers[Name]['scalar'],
    Buffers[Name]['lanes']['length']
  >;
};

export type ThreeRasterPlanResourceCapability<Declaration> = Declaration extends TechniqueResourceDeclaration
  ? Declaration extends { readonly kind: 'group'; readonly members: infer Members }
    ? {
        readonly kind: 'group';
        readonly members: { readonly [Name in keyof Members]: ThreeRasterPlanResourceCapability<Members[Name]> };
      }
    : Declaration extends { readonly format: PortableTextureFormat }
      ? { readonly kind: Declaration['kind']; readonly format: Declaration['format'] }
      : { readonly kind: Declaration['kind']; readonly format?: never }
  : never;

export type ThreeRasterPlanResourceCapabilities<Resources extends TechniqueResourceDeclarations> = {
  readonly [Name in keyof Resources]: ThreeRasterPlanResourceCapability<Resources[Name]>;
};

/** Renderer-selected shader realization, derived from the exact portable schema witness. */
export interface ThreeRasterPlanVariant<Schema extends AnyTechniqueSchema = AnyTechniqueSchema> {
  /** Stable renderer-local id; packages may publish alternatives, but Three registers one per technique. */
  readonly id: string;
  /** Shader implementation language, for example `tsl`, `wgsl`, or `glsl`. */
  readonly language: string;
  /** Shader-visible named policy-buffer shapes consumed by this implementation. */
  readonly buffers: ThreeRasterPlanBufferCapabilities<Schema['buffers']>;
  /** Named portable resource kinds and formats consumed by this implementation. */
  readonly resources: ThreeRasterPlanResourceCapabilities<Schema['resources']>;
  /** Named shader outputs exposed to renderer-owned material composition. */
  readonly outputs: Readonly<Record<string, string>>;
  /** Geometry shape consumed by this implementation. */
  readonly geometry: Schema['render']['geometry'];
  createMaterial(context: ThreePlanProgramMaterialContext): NodeMaterial;
}

export interface ThreeRasterPlanProgram<Technique extends AnyRasterTechnique, Schema extends AnyTechniqueSchema> {
  readonly technique: Technique;
  readonly schema: Schema & { readonly technique: Technique['id'] };
  readonly variant: NoInfer<ThreeRasterPlanVariant<Schema>>;
}

export interface CompiledThreeRasterPlanProgram {
  readonly technique: AnyRasterTechnique;
  readonly schema: AnyTechniqueSchema;
  readonly variant: ThreeRasterPlanVariant;
  readonly techniqueId: number;
  readonly programId: number;
  readonly policy: import('../core.js').PolicyProgram;
  createMaterial(context: ThreePlanProgramMaterialContext): NodeMaterial;
}

const programs = new Map<string, ThreeRasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>>();
const registeredSources = new WeakMap<object, ThreeRasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>>();
const snapshotsByRegistry = new WeakMap<RenderIdFactory, WeakRef<RenderIdFactory>[]>();
const snapshotReferences = new Set<WeakRef<RenderIdFactory>>();
const snapshotFinalizer = new FinalizationRegistry<WeakRef<RenderIdFactory>>((reference) => {
  snapshotReferences.delete(reference);
});
const THREE_RESERVED_ATTRIBUTE_WIDTHS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  position: [3],
  normal: [3],
  tangent: [4],
  uv: [2],
  color: [3, 4],
});

/** Register only the renderer-specific resource and material half of a portable program. */
export function registerThreeRasterPlanProgram<
  const Technique extends AnyRasterTechnique,
  const Schema extends AnyTechniqueSchema,
>(program: ThreeRasterPlanProgram<Technique, Schema>): void {
  if (typeof program !== 'object' || program === null || Array.isArray(program)) {
    throw new TypeError('Three raster plan programs need a program object');
  }
  const source = program as ThreeRasterPlanProgram<Technique, Schema> & Record<string, unknown>;
  const technique = source.technique;
  const techniqueId =
    typeof technique === 'object' && technique !== null && !Array.isArray(technique) ? technique.id : undefined;
  if (typeof techniqueId !== 'string' || techniqueId.length === 0) {
    throw new TypeError('Three raster plan programs need a technique with a nonempty id');
  }
  const portable = resolveRasterPlanProgram(techniqueId);
  if (portable === undefined) {
    throw new TypeError(`no portable raster plan program is registered for "${techniqueId}"`);
  }
  if (source.schema !== portable.schema) {
    throw new TypeError(`Three raster plan program "${techniqueId}" needs its registered portable schema`);
  }
  const variant = source.variant;
  if (typeof variant !== 'object' || variant === null || Array.isArray(variant)) {
    throw new TypeError(`Three raster plan program "${techniqueId}" needs a variant descriptor`);
  }
  const variantId = variant.id;
  if (typeof variantId !== 'string' || variantId.length === 0) {
    throw new TypeError(`Three raster plan program "${techniqueId}" needs a nonempty variant id`);
  }
  const language = variant.language;
  if (typeof language !== 'string' || language.length === 0) {
    throw new TypeError(`Three raster plan variant "${variantId}" needs a language label`);
  }
  const createMaterial = variant.createMaterial;
  if (typeof createMaterial !== 'function') {
    throw new TypeError(`Three raster plan variant "${variantId}" needs createMaterial`);
  }
  const registered = registeredSources.get(program as object);
  if (registered !== undefined) {
    if (registered.technique.id !== techniqueId || registered.variant.id !== variantId) {
      throw new TypeError(
        `Three raster plan program source changed identity from "${registered.technique.id}/${registered.variant.id}" to "${techniqueId}/${variantId}"`,
      );
    }
    return;
  }
  const expectedGeometry = portable.schema.render?.geometry ?? { kind: 'synthetic-quad' };
  if (!sameGeometry(expectedGeometry, variant.geometry)) {
    throw new TypeError(`Three raster variant "${variantId}" declares incompatible geometry`);
  }
  assertThreeGeometrySemantics(techniqueId, variantId, expectedGeometry, portable.schema);
  const buffers = normalizeBufferCapabilities(techniqueId, variantId, variant.buffers, portable.schema);
  const resources = normalizeResourceCapabilities(techniqueId, variantId, variant.resources, portable.schema);
  const outputs = normalizeOutputs(techniqueId, variantId, variant.outputs);
  const snapshot = Object.freeze({
    technique: portable.technique,
    schema: portable.schema,
    variant: Object.freeze({
      id: variantId,
      language,
      buffers,
      resources,
      outputs,
      geometry: expectedGeometry,
      createMaterial,
    }),
  }) as ThreeRasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>;
  const existing = programs.get(techniqueId);
  if (existing !== undefined) {
    throw new TypeError(
      `Three already selected raster variant "${existing.variant.id}" for technique "${techniqueId}"`,
    );
  }
  const engineCount = liveSnapshotCount();
  if (engineCount !== 0) {
    throw new Error(
      `Three raster variant "${techniqueId}/${variantId}" was registered after ${engineCount} glyph engine(s) ` +
        'already read the registry; register every technique before its first Text or TextGroup realization',
    );
  }
  programs.set(techniqueId, snapshot);
  registeredSources.set(program as object, snapshot);
}

/** @internal Compile the cold registry snapshot into policy, binding, and material factories. */
export function compiledThreeRasterPlanPrograms(
  identities: RenderIdFactory,
  transformMode: 'indexed' | 'direct' = 'indexed',
): readonly CompiledThreeRasterPlanProgram[] {
  const selected = [...programs.values()].sort((left, right) => left.technique.id.localeCompare(right.technique.id));
  const compiled = selected.map((program) => compileProgram(program, identities, transformMode));
  const reference = new WeakRef(identities);
  const references = snapshotsByRegistry.get(identities) ?? [];
  references.push(reference);
  snapshotsByRegistry.set(identities, references);
  snapshotReferences.add(reference);
  snapshotFinalizer.register(identities, reference, reference);
  return compiled;
}

/** @internal Validate the retained payload whose attributes Three will claim. */
export function assertThreeGeometryPayload(
  program: CompiledThreeRasterPlanProgram,
  resources: ReadonlyMap<string, PortableResource>,
): void {
  const geometry = program.variant.geometry;
  if (geometry.kind === 'synthetic-quad' || geometry.resource === undefined) return;
  const payload = resources.get(geometry.resource);
  if (payload?.kind !== 'geometry') {
    throw new TypeError(
      `Three raster variant "${program.technique.id}/${program.variant.id}" needs geometry resource "${geometry.resource}"`,
    );
  }
  for (const attribute of payload.attributes) {
    const accessor = payload.accessors[attribute.accessor];
    if (accessor === undefined) {
      throw new TypeError(`portable geometry attribute "${attribute.semantic}" has no accessor`);
    }
    assertThreeAttributeWidth(
      program.technique.id,
      program.variant.id,
      attribute.semantic,
      accessor.components,
      'payload',
    );
  }
}

/** @internal Forget a disposed Three coordinator's renderer snapshot. */
export function releaseThreeRasterPlanProgramSnapshot(identities: RenderIdFactory): void {
  const references = snapshotsByRegistry.get(identities);
  if (references === undefined) return;
  const reference = references.pop();
  if (reference === undefined) return;
  snapshotFinalizer.unregister(reference);
  snapshotReferences.delete(reference);
  if (references.length === 0) snapshotsByRegistry.delete(identities);
}

function liveSnapshotCount(): number {
  let count = 0;
  for (const reference of snapshotReferences) {
    if (reference.deref() === undefined) snapshotReferences.delete(reference);
    else count += 1;
  }
  return count;
}

/** Three-owned semantic values used by renderer-specific shader adapters. */
export interface ThreePolicyAbi {
  readonly scalarTypes: Readonly<{ readonly f32: 'f32'; readonly u32: 'u32'; readonly u16: 'u16' }>;
  readonly transformBufferId: typeof threeSystemBuffers.transformIndex.id;
}

/** Three-owned policy metadata; raw shaper opcodes and layouts remain package-private. */
export const threePolicyAbi: ThreePolicyAbi = Object.freeze({
  scalarTypes: Object.freeze({ f32: 'f32', u32: 'u32', u16: 'u16' }),
  transformBufferId: threeSystemBuffers.transformIndex.id,
});

function compileProgram(
  program: ThreeRasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>,
  identities: RenderIdFactory,
  transformMode: 'indexed' | 'direct',
): CompiledThreeRasterPlanProgram {
  const portable = resolveRasterPlanProgram(program.technique.id);
  if (portable === undefined)
    throw new Error(`no portable raster plan program is registered for "${program.technique.id}"`);
  const system = transformMode === 'indexed' ? threeSystemBuffers : { stableGlyphId: threeSystemBuffers.stableGlyphId };
  const policy = createRasterPolicyProgram(portable, {
    namespace: 'three',
    system,
    capabilitySet: threePolicyCapabilitySet(),
    transformMode,
    allocationMode: 'ordered',
    ids: identities,
  });
  return {
    technique: program.technique,
    schema: portable.schema,
    variant: program.variant,
    techniqueId: policy.techniqueId,
    programId: policy.programId,
    policy,
    createMaterial: (context) => program.variant.createMaterial(context),
  };
}

function sameGeometry(left: TechniqueGeometryDeclaration, right: unknown): right is TechniqueGeometryDeclaration {
  if (typeof right !== 'object' || right === null || Array.isArray(right)) return false;
  const candidate = right as Record<PropertyKey, unknown>;
  if (left.kind === 'synthetic-quad') {
    return hasExactOwnKeys(candidate, ['kind']) && candidate.kind === left.kind;
  }
  if (left.kind === 'custom') {
    return (
      hasExactOwnKeys(candidate, ['kind', 'name', 'resource', 'coordinates']) &&
      candidate.kind === left.kind &&
      candidate.name === left.name &&
      candidate.resource === left.resource &&
      candidate.coordinates === left.coordinates
    );
  }
  return (
    hasExactOwnKeys(candidate, ['kind', 'resource', 'coordinates']) &&
    candidate.kind === left.kind &&
    candidate.resource === left.resource &&
    candidate.coordinates === left.coordinates
  );
}

function assertThreeGeometrySemantics(
  techniqueId: string,
  variantId: string,
  geometry: TechniqueGeometryDeclaration,
  schema: AnyTechniqueSchema,
): void {
  if (geometry.kind === 'synthetic-quad' || geometry.resource === undefined) return;
  const resource = schema.resources?.[geometry.resource];
  if (resource?.kind !== 'geometry') {
    throw new TypeError(
      `Three raster variant "${techniqueId}/${variantId}" needs geometry resource "${geometry.resource}"`,
    );
  }
  for (const attribute of resource.attributes) {
    assertThreeAttributeWidth(techniqueId, variantId, attribute.semantic, attribute.components, 'declaration');
  }
}

function assertThreeAttributeWidth(
  techniqueId: string,
  variantId: string,
  semantic: string,
  components: number,
  source: 'declaration' | 'payload',
): void {
  const expected = Object.hasOwn(THREE_RESERVED_ATTRIBUTE_WIDTHS, semantic)
    ? THREE_RESERVED_ATTRIBUTE_WIDTHS[semantic]
    : undefined;
  if (expected === undefined || expected.includes(components)) return;
  const subject = source === 'payload' ? 'geometry payload attribute' : 'geometry attribute';
  throw new TypeError(
    `Three raster variant "${techniqueId}/${variantId}" ${subject} "${semantic}" ` +
      `needs ${expected.join(' or ')} components; got ${components}`,
  );
}

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function normalizeBufferCapabilities(
  techniqueId: string,
  variantId: string,
  value: unknown,
  schema: AnyTechniqueSchema,
): Readonly<Record<string, ThreeRasterPlanBufferCapability>> {
  if (!isNonArrayObject(value)) {
    throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" needs named buffer capabilities`);
  }
  assertExactNames(value, Object.keys(schema.buffers), techniqueId, variantId, 'buffer');
  const owned: Record<string, ThreeRasterPlanBufferCapability> = Object.create(null);
  for (const [name, declaration] of Object.entries(schema.buffers)) {
    const capability = value[name];
    if (!isNonArrayObject(capability)) {
      throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" needs buffer "${name}"`);
    }
    const scalar = capability.scalar;
    const vectorWidth = capability.vectorWidth;
    if (scalar !== declaration.scalar || vectorWidth !== declaration.lanes.length) {
      throw new TypeError(
        `Three raster variant "${techniqueId}/${variantId}" buffer "${name}" must consume ` +
          `${declaration.scalar}x${declaration.lanes.length}`,
      );
    }
    owned[name] = Object.freeze({ scalar: declaration.scalar, vectorWidth: declaration.lanes.length });
  }
  return Object.freeze(owned);
}

function normalizeResourceCapabilities(
  techniqueId: string,
  variantId: string,
  value: unknown,
  schema: AnyTechniqueSchema,
): Readonly<Record<string, TechniqueResourceDeclaration>> {
  if (!isNonArrayObject(value)) {
    throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" needs named resource capabilities`);
  }
  const declaredResources = schema.resources ?? {};
  assertExactNames(value, Object.keys(declaredResources), techniqueId, variantId, 'resource');
  const owned: Record<string, TechniqueResourceDeclaration> = Object.create(null);
  for (const [name, declaration] of Object.entries(declaredResources)) {
    const capability = value[name];
    if (!isNonArrayObject(capability)) {
      throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" needs resource "${name}"`);
    }
    owned[name] = normalizeResourceCapability(techniqueId, variantId, name, capability, declaration);
  }
  return Object.freeze(owned);
}

function normalizeResourceCapability(
  techniqueId: string,
  variantId: string,
  name: string,
  capability: Record<PropertyKey, unknown>,
  declaration: TechniqueResourceDeclaration,
): TechniqueResourceDeclaration {
  const format =
    declaration.kind === 'texture' || declaration.kind === 'texture-array' ? declaration.format : undefined;
  if (capability.kind !== declaration.kind || capability.format !== format) {
    throw new TypeError(
      `Three raster variant "${techniqueId}/${variantId}" resource "${name}" must consume ` +
        `${format === undefined ? declaration.kind : `${declaration.kind}:${format}`}`,
    );
  }
  if (declaration.kind === 'group') {
    const members = capability.members;
    if (!isNonArrayObject(members)) {
      throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" resource "${name}" needs group members`);
    }
    assertExactNames(members, Object.keys(declaration.members), techniqueId, variantId, `resource "${name}" member`);
    const owned: Record<string, TechniqueResourceDeclaration> = Object.create(null);
    for (const [memberName, memberDeclaration] of Object.entries(declaration.members)) {
      const member = members[memberName];
      if (!isNonArrayObject(member)) {
        throw new TypeError(
          `Three raster variant "${techniqueId}/${variantId}" resource "${name}" needs member "${memberName}"`,
        );
      }
      owned[memberName] = normalizeResourceCapability(
        techniqueId,
        variantId,
        `${name}.${memberName}`,
        member,
        memberDeclaration,
      );
    }
    return Object.freeze({
      kind: 'group',
      members: Object.freeze(owned),
      ...(declaration.cardinality === undefined ? {} : { cardinality: declaration.cardinality }),
    }) as TechniqueResourceDeclaration;
  }
  if (declaration.kind === 'buffer') {
    return Object.freeze({
      kind: declaration.kind,
      ...(declaration.cardinality === undefined ? {} : { cardinality: declaration.cardinality }),
    });
  }
  if (declaration.kind === 'geometry') {
    return Object.freeze({
      kind: declaration.kind,
      attributes: Object.freeze(declaration.attributes.map((attribute) => Object.freeze({ ...attribute }))),
      ...(declaration.cardinality === undefined ? {} : { cardinality: declaration.cardinality }),
    });
  }
  if (declaration.kind === 'texture') {
    return Object.freeze({
      kind: declaration.kind,
      format: declaration.format,
      ...(declaration.cardinality === undefined ? {} : { cardinality: declaration.cardinality }),
    });
  }
  return Object.freeze({
    kind: declaration.kind,
    format: declaration.format,
    ...(declaration.cardinality === undefined ? {} : { cardinality: declaration.cardinality }),
  });
}

function normalizeOutputs(techniqueId: string, variantId: string, value: unknown): Readonly<Record<string, string>> {
  if (!isNonArrayObject(value) || Object.keys(value).length === 0) {
    throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" needs named shader outputs`);
  }
  const owned: Record<string, string> = Object.create(null);
  for (const [name, type] of Object.entries(value)) {
    if (name.length === 0 || typeof type !== 'string' || type.length === 0) {
      throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" has an invalid shader output`);
    }
    owned[name] = type;
  }
  return Object.freeze(owned);
}

function assertExactNames(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  techniqueId: string,
  variantId: string,
  label: string,
): void {
  const actual = Object.keys(value);
  const missing = expected.find((name) => !Object.hasOwn(value, name));
  if (missing !== undefined) {
    throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" omits ${label} "${missing}"`);
  }
  const extra = actual.find((name) => !expected.includes(name));
  if (extra !== undefined) {
    throw new TypeError(`Three raster variant "${techniqueId}/${variantId}" declares unknown ${label} "${extra}"`);
  }
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
