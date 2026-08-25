import type { Node, NodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';

import { textShaperAbi } from '../core.js';
import {
  compileRasterFont,
  createProgram,
  RenderWireIdentityRegistry,
  resolveRasterPlanProgram,
  schemaPolicyBuffers,
  type CompiledRasterFont,
  type PolicyScalarKind,
  type TechniqueGeometryDeclaration,
  type TechniqueResourceDeclaration,
  type TechniqueSchema,
} from '../core.js';
import type { LoadedFont } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { ThreeTextMaterial } from './material.js';
import { threePolicyCapabilitySet, threeSystemBuffers } from './render-policy.js';

export interface ThreePlanProgramBuffer {
  readonly scalarType: number;
  readonly vectorWidth: number;
  readonly attribute: StorageInstancedBufferAttribute;
}

export interface ThreePlanProgramMaterialContext {
  /** Portable technique selected for this draw. */
  readonly technique: AnyRasterTechnique;
  /** The portable schema selected for this draw. */
  readonly schema: TechniqueSchema;
  /** The selected renderer variant's stable identity. */
  readonly variantId: string;
  /** Shader-language label for diagnostics and implementation selection. */
  readonly language: string;
  /** Buffers addressed by the schema's declared names, never host wire ids. */
  readonly namedBuffers: ReadonlyMap<string, ThreePlanProgramBuffer>;
  /** Retained resources addressed by the schema's declared names. */
  readonly namedResources: ReadonlyMap<string, unknown>;
  /** Named output types declared by the selected renderer implementation. */
  readonly outputTypes: Readonly<Record<string, string>>;
  /** Name of the resource referenced by this draw's wire resource record. */
  readonly resourceName: string;
  readonly instance: Node<'uint'>;
  readonly materialId: number;
  readonly material: ThreeTextMaterial | undefined;
  transformPosition(position: Node<'vec3'>): Node<'vec3'>;
}

export interface ThreeRasterPlanVariant {
  /** Stable renderer-local id; packages may publish alternatives, but Three registers one per technique. */
  readonly id: string;
  /** Shader implementation language, for example `tsl`, `wgsl`, or `glsl`. */
  readonly language: string;
  /** Shader-visible named policy-buffer shapes consumed by this implementation. */
  readonly buffers: Readonly<Record<string, ThreeRasterPlanBufferCapability>>;
  /** Named portable resource kinds and formats consumed by this implementation. */
  readonly resources: Readonly<Record<string, TechniqueResourceDeclaration>>;
  /** Named shader outputs exposed to renderer-owned material composition. */
  readonly outputs: Readonly<Record<string, string>>;
  /** Geometry shape consumed by this implementation. */
  readonly geometry: TechniqueGeometryDeclaration;
  createMaterial(context: ThreePlanProgramMaterialContext): NodeMaterial;
}

export interface ThreeRasterPlanBufferCapability {
  readonly scalar: PolicyScalarKind;
  readonly vectorWidth: number;
}

export interface ThreeRasterPlanProgram<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly variant: ThreeRasterPlanVariant;
}

export interface CompiledThreeRasterPlanProgram {
  readonly technique: AnyRasterTechnique;
  readonly schema: TechniqueSchema;
  readonly variant: ThreeRasterPlanVariant;
  readonly techniqueId: number;
  readonly programId: number;
  readonly policy: import('../core.js').PolicyProgram;
  compileFont(
    font: LoadedFont<AnyRasterTechnique>,
    identities: RenderWireIdentityRegistry,
  ): CompiledRasterFont<unknown>;
  createMaterial(context: ThreePlanProgramMaterialContext): NodeMaterial;
}

const programs = new Map<string, ThreeRasterPlanProgram<AnyRasterTechnique>>();
const registeredSources = new WeakMap<object, ThreeRasterPlanProgram<AnyRasterTechnique>>();
const snapshots = new Map<RenderWireIdentityRegistry, number>();

/** Register only the renderer-specific resource and material half of a portable program. */
export function registerThreeRasterPlanProgram<Technique extends AnyRasterTechnique>(
  program: ThreeRasterPlanProgram<Technique>,
): void {
  if (typeof program !== 'object' || program === null || Array.isArray(program)) {
    throw new TypeError('Three raster plan programs need a program object');
  }
  const source = program as ThreeRasterPlanProgram<Technique> & Record<string, unknown>;
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
  const buffers = normalizeBufferCapabilities(techniqueId, variantId, variant.buffers, portable.schema);
  const resources = normalizeResourceCapabilities(techniqueId, variantId, variant.resources, portable.schema);
  const outputs = normalizeOutputs(techniqueId, variantId, variant.outputs);
  const snapshot = Object.freeze({
    technique: portable.technique,
    variant: Object.freeze({
      id: variantId,
      language,
      buffers,
      resources,
      outputs,
      geometry: expectedGeometry,
      createMaterial,
    }),
  }) as ThreeRasterPlanProgram<AnyRasterTechnique>;
  const existing = programs.get(techniqueId);
  if (existing !== undefined) {
    throw new TypeError(
      `Three already selected raster variant "${existing.variant.id}" for technique "${techniqueId}"`,
    );
  }
  const runtimeCount = [...snapshots.values()].reduce((sum, count) => sum + count, 0);
  if (runtimeCount !== 0) {
    throw new Error(
      `Three raster variant "${techniqueId}/${variantId}" was registered after ${runtimeCount} text runtime(s) ` +
        'already read the registry; register every technique before its first Text or TextGroup realization',
    );
  }
  programs.set(techniqueId, snapshot);
  registeredSources.set(program as object, snapshot);
}

/** @internal Compile the cold registry snapshot into policy, binding, and material factories. */
export function compiledThreeRasterPlanPrograms(
  identities: RenderWireIdentityRegistry,
  transformMode: 'indexed' | 'direct' = 'indexed',
): readonly CompiledThreeRasterPlanProgram[] {
  const selected = [...programs.values()].sort((left, right) => left.technique.id.localeCompare(right.technique.id));
  const compiled = selected.map((program) => compileProgram(program, identities, transformMode));
  snapshots.set(identities, (snapshots.get(identities) ?? 0) + 1);
  return compiled;
}

/** @internal Forget a disposed runtime's renderer snapshot. */
export function releaseThreeRasterPlanProgramSnapshot(identities: RenderWireIdentityRegistry): void {
  const count = snapshots.get(identities);
  if (count === undefined) return;
  if (count === 1) snapshots.delete(identities);
  else snapshots.set(identities, count - 1);
}

export interface ThreePolicyAbi {
  readonly opcodes: typeof textShaperAbi.policy.opcodes;
  readonly scalarTypes: typeof textShaperAbi.policy.scalarTypes;
  readonly bufferUsage: typeof textShaperAbi.policy.bufferUsage;
  readonly allocationStrategies: typeof textShaperAbi.policy.allocationStrategies;
  readonly batchFields: typeof textShaperAbi.policy.batchFields;
  readonly semanticF32Fields: typeof textShaperAbi.engine.semanticF32Fields;
  readonly semanticU32Fields: typeof textShaperAbi.engine.semanticU32Fields;
  readonly transformBufferId: typeof threeSystemBuffers.transformIndex.id;
}

export const threePolicyAbi: ThreePolicyAbi = Object.freeze({
  opcodes: textShaperAbi.policy.opcodes,
  scalarTypes: textShaperAbi.policy.scalarTypes,
  bufferUsage: textShaperAbi.policy.bufferUsage,
  allocationStrategies: textShaperAbi.policy.allocationStrategies,
  batchFields: textShaperAbi.policy.batchFields,
  semanticF32Fields: textShaperAbi.engine.semanticF32Fields,
  semanticU32Fields: textShaperAbi.engine.semanticU32Fields,
  transformBufferId: threeSystemBuffers.transformIndex.id,
});

function compileProgram(
  program: ThreeRasterPlanProgram<AnyRasterTechnique>,
  identities: RenderWireIdentityRegistry,
  transformMode: 'indexed' | 'direct',
): CompiledThreeRasterPlanProgram {
  const portable = resolveRasterPlanProgram(program.technique.id);
  if (portable === undefined)
    throw new Error(`no portable raster plan program is registered for "${program.technique.id}"`);
  const techniqueId = identities.resolve(program.technique.id);
  const programId = identities.resolve(`${program.technique.id}/three-plan-program`);
  const system = transformMode === 'indexed' ? threeSystemBuffers : { stableGlyphId: threeSystemBuffers.stableGlyphId };
  const body = portable.policyBody(system, threePolicyCapabilitySet());
  return {
    technique: program.technique,
    schema: portable.schema,
    variant: program.variant,
    techniqueId,
    programId,
    policy: createProgram(
      techniqueId,
      programId,
      body,
      [
        ...schemaPolicyBuffers(portable.schema),
        { id: threeSystemBuffers.stableGlyphId.id, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 },
        ...(transformMode === 'indexed'
          ? [{ id: threeSystemBuffers.transformIndex.id, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 }]
          : []),
      ],
      transformMode,
      'ordered',
    ),
    compileFont(font, bindingIdentities) {
      if (font.technique.id !== program.technique.id) {
        throw new TypeError('Three raster plan program received an incompatible loaded font');
      }
      const compiled = compileRasterFont(font, bindingIdentities);
      if (compiled === undefined)
        throw new Error(`no portable raster plan program is registered for "${font.technique.id}"`);
      return compiled;
    },
    createMaterial: (context) => program.variant.createMaterial(context),
  };
}

function sameGeometry(left: TechniqueGeometryDeclaration, right: unknown): right is TechniqueGeometryDeclaration {
  if (typeof right !== 'object' || right === null || Array.isArray(right)) return false;
  const candidate = right as Partial<TechniqueGeometryDeclaration>;
  return (
    left.kind === candidate.kind && left.resource === candidate.resource && left.coordinates === candidate.coordinates
  );
}

function normalizeBufferCapabilities(
  techniqueId: string,
  variantId: string,
  value: unknown,
  schema: TechniqueSchema,
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
  schema: TechniqueSchema,
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
    const format = 'format' in declaration ? declaration.format : undefined;
    const candidateFormat = capability.format;
    if (capability.kind !== declaration.kind || candidateFormat !== format) {
      throw new TypeError(
        `Three raster variant "${techniqueId}/${variantId}" resource "${name}" must consume ` +
          `${format === undefined ? declaration.kind : `${declaration.kind}:${format}`}`,
      );
    }
    owned[name] = Object.freeze({ kind: declaration.kind, ...(format === undefined ? {} : { format }) });
  }
  return Object.freeze(owned);
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
