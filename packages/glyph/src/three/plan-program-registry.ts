import type { Node, NodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';

import { textShaperAbi } from '../core.js';
import {
  compileFontBinding,
  emptyFontBindingTable,
  fontBindingResources,
  RenderWireIdentityRegistry,
  type FontBindingDescriptor,
  type FontBindingFieldTable,
  type PolicyProgram,
} from '../core.js';
import type { LoadedFont } from '../loaded-font.js';
import type { AnyRasterTechnique, RasterResourceId } from '../raster-technique.js';
import type { ThreeTextMaterial } from './material.js';
import { threeSystemBuffers } from './render-policy.js';

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

export interface ThreePlanProgramFontCompiler<Technique extends AnyRasterTechnique, Resource> {
  readonly font: LoadedFont<Technique>;
  readonly techniqueId: number;
  readonly identities: RenderWireIdentityRegistry;
  readonly emptyTable: (rows: number) => FontBindingFieldTable;
  resources(keys: readonly RasterResourceId[]): ReturnType<typeof fontBindingResources>;
  compile(descriptor: FontBindingDescriptor): Uint8Array;
  retain(key: RasterResourceId, resource: Resource): void;
}

export interface ThreeRasterPlanProgram<Technique extends AnyRasterTechnique, Resource> {
  readonly technique: Technique;
  /** Static validated policy bytecode descriptor. IDs are supplied by the renderer registry. */
  readonly policy: Omit<PolicyProgram, 'techniqueId' | 'programId'>;
  /** Cold font registration; never runs during frame shaping, layout, packing, or draw submission. */
  compileFont(compiler: ThreePlanProgramFontCompiler<Technique, Resource>): void;
  /**
   * Renderer realization invoked only when a compatible retained material is absent.
   * The callback receives borrowed plan-backed attributes and must not synchronously update or query text.
   */
  createMaterial(context: ThreePlanProgramMaterialContext<Resource>): NodeMaterial;
}

export interface CompiledThreeRasterPlanProgram {
  readonly technique: AnyRasterTechnique;
  readonly techniqueId: number;
  readonly programId: number;
  readonly policy: PolicyProgram;
  compileFont(
    font: LoadedFont<AnyRasterTechnique>,
    identities: RenderWireIdentityRegistry,
  ): Readonly<{ binding: Uint8Array; resources: ReadonlyMap<RasterResourceId, unknown> }>;
  createMaterial(context: ThreePlanProgramMaterialContext<unknown>): NodeMaterial;
}

const programs = new Map<string, ThreeRasterPlanProgram<AnyRasterTechnique, unknown>>();

/**
 * Runtimes that have already taken their snapshot of `programs`.
 *
 * A `TextRuntime`'s coordinator reads this registry exactly once, at construction, and nothing
 * re-reads it afterwards. A technique registered after that snapshot is therefore invisible to
 * every runtime already built, and the loss surfaces far away as a missing technique when a font
 * using it is bound. The set is what lets a late registration be rejected AT the registration.
 */
const snapshots = new Set<RenderWireIdentityRegistry>();

/**
 * Register declarative Rust packing policy plus cold font/resource and renderer realization code.
 *
 * Registration must happen before the first runtime-scoped Three coordinator is created -- that is,
 * before the first `Text`, `TextGroup`, or `FontLoader` for a runtime. A later registration throws
 * rather than silently applying to nothing.
 */
export function registerThreeRasterPlanProgram<Technique extends AnyRasterTechnique, Resource>(
  program: ThreeRasterPlanProgram<Technique, Resource>,
): void {
  const erased = program as unknown as ThreeRasterPlanProgram<AnyRasterTechnique, unknown>;
  const existing = programs.get(program.technique.id);
  if (existing !== undefined && existing !== erased) {
    throw new TypeError(`a different Three raster plan program is already registered for "${program.technique.id}"`);
  }
  // Re-registering the identical program is a no-op and stays legal, so a module evaluated twice
  // does not become an error. Only a technique no existing runtime holds is rejected.
  if (existing === undefined && snapshots.size !== 0) {
    throw new Error(
      `Three raster plan program "${program.technique.id}" was registered after ${snapshots.size} text runtime(s) ` +
        'already read the registry, so no existing runtime can use it; register every technique before creating ' +
        'the first Text, TextGroup, or FontLoader',
    );
  }
  programs.set(program.technique.id, erased);
}

/** @internal Compile the cold registry snapshot into one Rust policy and exact font compilers. */
export function compiledThreeRasterPlanPrograms(
  identities: RenderWireIdentityRegistry,
): readonly CompiledThreeRasterPlanProgram[] {
  snapshots.add(identities);
  return [...programs.values()]
    .sort((left, right) => left.technique.id.localeCompare(right.technique.id))
    .map((program) => compileProgram(program, identities));
}

/**
 * @internal Forget a disposed runtime's snapshot.
 *
 * Once no runtime holds a snapshot there is nothing a late registration could miss, so registration
 * is legal again. This is what keeps the module-global gate from leaking across a host that builds
 * and tears down runtimes, tests included.
 */
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
  const techniqueId = identities.resolve(program.technique.id);
  const programId = identities.resolve(`${program.technique.id}/three-plan-program`);
  return {
    technique: program.technique,
    techniqueId,
    programId,
    policy: { ...program.policy, techniqueId, programId },
    compileFont(font, bindingIdentities) {
      if (font.technique.id !== program.technique.id) {
        throw new TypeError('Three raster plan program received an incompatible loaded font');
      }
      let binding: Uint8Array | undefined;
      const resources = new Map<RasterResourceId, unknown>();
      program.compileFont({
        font,
        techniqueId,
        identities: bindingIdentities,
        emptyTable: emptyFontBindingTable,
        resources: (keys) => fontBindingResources(keys, bindingIdentities),
        compile(descriptor) {
          if (binding !== undefined) throw new Error('Three raster plan font compiler produced more than one binding');
          binding = compileFontBinding(descriptor);
          return binding;
        },
        retain(key, resource) {
          if (resources.has(key)) throw new TypeError(`Three raster plan font retained duplicate resource "${key}"`);
          resources.set(key, resource);
        },
      });
      if (binding === undefined) throw new Error('Three raster plan font compiler produced no binding');
      return { binding, resources };
    },
    createMaterial: (context) => program.createMaterial(context),
  };
}
