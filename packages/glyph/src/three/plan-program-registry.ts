import type { Node, NodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';

import { textShaperAbi } from '../core.js';
import {
  compileRasterFont,
  createProgram,
  RenderWireIdentityRegistry,
  resolveRasterPlanProgram,
  schemaPolicyBuffers,
  type CompiledRasterFont,
  type RasterPlanProgramFontCompiler,
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

export interface ThreePlanProgramMaterialContext<Resource> {
  readonly resource: Resource;
  readonly buffers: ReadonlyMap<number, ThreePlanProgramBuffer>;
  readonly instance: Node<'uint'>;
  readonly materialId: number;
  readonly material: ThreeTextMaterial | undefined;
  transformPosition(position: Node<'vec3'>): Node<'vec3'>;
}

/** Compatibility alias for code that only needs the portable cold compiler shape. */
export type ThreePlanProgramFontCompiler<
  Technique extends AnyRasterTechnique,
  Resource,
> = RasterPlanProgramFontCompiler<Technique, Resource>;

export interface ThreeRasterPlanProgram<Technique extends AnyRasterTechnique, Resource = unknown> {
  readonly technique: Technique;
  /** Convert a portable payload into data owned by the Three resource cache. */
  readonly realizeResource?: (resource: Resource) => unknown;
  /** Create a Three material from retained plan buffers and a realized resource. */
  createMaterial(context: ThreePlanProgramMaterialContext<unknown>): NodeMaterial;
}

export interface CompiledThreeRasterPlanProgram {
  readonly technique: AnyRasterTechnique;
  readonly techniqueId: number;
  readonly programId: number;
  readonly policy: import('../core.js').PolicyProgram;
  compileFont(
    font: LoadedFont<AnyRasterTechnique>,
    identities: RenderWireIdentityRegistry,
  ): CompiledRasterFont<unknown>;
  realizeResource(resource: unknown): unknown;
  createMaterial(context: ThreePlanProgramMaterialContext<unknown>): NodeMaterial;
}

const programs = new Map<string, ThreeRasterPlanProgram<AnyRasterTechnique, unknown>>();
const snapshots = new Set<RenderWireIdentityRegistry>();

/** Register only the renderer-specific resource and material half of a portable program. */
export function registerThreeRasterPlanProgram<Technique extends AnyRasterTechnique, Resource>(
  program: ThreeRasterPlanProgram<Technique, Resource>,
): void {
  const erased = program as unknown as ThreeRasterPlanProgram<AnyRasterTechnique, unknown>;
  const existing = programs.get(program.technique.id);
  if (existing !== undefined && existing !== erased) {
    throw new TypeError(`a different Three raster plan program is already registered for "${program.technique.id}"`);
  }
  if (existing === undefined && snapshots.size !== 0) {
    throw new Error(
      `Three raster plan program "${program.technique.id}" was registered after ${snapshots.size} text runtime(s) ` +
        'already read the registry; register every technique before creating the first Text, TextGroup, or FontLoader',
    );
  }
  programs.set(program.technique.id, erased);
}

/** @internal Compile the cold registry snapshot into policy, binding, and material factories. */
export function compiledThreeRasterPlanPrograms(
  identities: RenderWireIdentityRegistry,
): readonly CompiledThreeRasterPlanProgram[] {
  snapshots.add(identities);
  return [...programs.values()]
    .sort((left, right) => left.technique.id.localeCompare(right.technique.id))
    .map((program) => compileProgram(program, identities));
}

/** @internal Forget a disposed runtime's renderer snapshot. */
export function releaseThreeRasterPlanProgramSnapshot(identities: RenderWireIdentityRegistry): void {
  snapshots.delete(identities);
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
  program: ThreeRasterPlanProgram<AnyRasterTechnique, unknown>,
  identities: RenderWireIdentityRegistry,
): CompiledThreeRasterPlanProgram {
  const portable = resolveRasterPlanProgram(program.technique.id);
  if (portable === undefined)
    throw new Error(`no portable raster plan program is registered for "${program.technique.id}"`);
  const techniqueId = identities.resolve(program.technique.id);
  const programId = identities.resolve(`${program.technique.id}/three-plan-program`);
  const body = portable.policyBody(threeSystemBuffers, threePolicyCapabilitySet());
  return {
    technique: program.technique,
    techniqueId,
    programId,
    policy: createProgram(
      techniqueId,
      programId,
      body,
      [
        ...schemaPolicyBuffers(portable.schema),
        { id: threeSystemBuffers.stableGlyphId.id, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 },
        { id: threeSystemBuffers.transformIndex.id, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 },
      ],
      'indexed',
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
    realizeResource: (resource) => program.realizeResource?.(resource) ?? resource,
    createMaterial: (context) => program.createMaterial(context),
  };
}
