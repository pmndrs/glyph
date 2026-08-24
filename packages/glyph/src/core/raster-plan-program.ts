import type { LoadedFont } from '../loaded-font.js';
import type { AnyRasterTechnique, RasterResourceId } from '../raster-technique.js';
import {
  compileFontBinding,
  emptyFontBindingTable,
  fontBindingResources,
  type BindingResource,
  type FontBindingDescriptor,
  type FontBindingFieldTable,
} from './font-binding.js';
import type { CompiledPolicyProgramBody } from './policy-program.js';
import type { PolicyBufferDeclaration, TechniqueSchema } from './technique-schema.js';
import { RenderWireIdentityRegistry, type PolicyCapabilitySet, type PolicyProgram } from './render-policy.js';

/** System buffers are owned by the engine and are deliberately absent from a technique schema. */
export interface RasterPolicySystem {
  readonly stableGlyphId: PolicyBufferDeclaration;
  readonly transformIndex?: PolicyBufferDeclaration;
}

/** Renderer-neutral policy body, before an engine assigns program and capability identities. */
export type RasterPolicyBodyFactory = (
  system: RasterPolicySystem,
  capabilities: PolicyCapabilitySet,
) => CompiledPolicyProgramBody;

/** The data a renderer may retain for one logical raster resource. */
export interface CompiledRasterResource<Resource = unknown> {
  readonly key: RasterResourceId;
  readonly value: Resource;
}

/** Portable output of cold font compilation; no renderer program or GPU object crosses this boundary. */
export interface CompiledRasterFont<Resource = unknown> {
  readonly binding: Uint8Array;
  readonly resources: ReadonlyMap<RasterResourceId, Resource>;
}

export interface RasterPlanProgramFontCompiler<Technique extends AnyRasterTechnique, Resource> {
  readonly font: LoadedFont<Technique>;
  readonly techniqueId: number;
  readonly identities: RenderWireIdentityRegistry;
  readonly emptyTable: (rows: number) => FontBindingFieldTable;
  readonly resources: (keys: readonly RasterResourceId[]) => ReturnType<typeof fontBindingResources>;
  readonly compile: (descriptor: FontBindingDescriptor) => Uint8Array;
  readonly retain: (key: RasterResourceId, resource: Resource) => void;
}

/** Portable technique data shared by every engine that consumes a raster plan. */
export interface RasterPlanProgram<Technique extends AnyRasterTechnique, Resource = unknown> {
  readonly technique: Technique;
  readonly schema: TechniqueSchema;
  readonly policyBody: RasterPolicyBodyFactory;
  readonly compileFont: (compiler: RasterPlanProgramFontCompiler<Technique, Resource>) => void;
}

type ErasedProgram = RasterPlanProgram<AnyRasterTechnique, unknown>;

const programs = new Map<string, ErasedProgram>();

/** Register one portable technique program by its technique id. */
export function registerRasterPlanProgram<Technique extends AnyRasterTechnique, Resource>(
  program: RasterPlanProgram<Technique, Resource>,
): void {
  const erased = program as unknown as ErasedProgram;
  const existing = programs.get(program.technique.id);
  if (existing !== undefined && existing !== erased) {
    throw new TypeError(`a different raster plan program is already registered for "${program.technique.id}"`);
  }
  programs.set(program.technique.id, erased);
}

/** Resolve the portable program associated with a technique id. */
export function resolveRasterPlanProgram(id: string): RasterPlanProgram<AnyRasterTechnique, unknown> | undefined {
  return programs.get(id);
}

/** Compile a loaded font through the registered portable program, if it has one. */
export function compileRasterFont(
  font: LoadedFont<AnyRasterTechnique>,
  identities: RenderWireIdentityRegistry,
): CompiledRasterFont<unknown> | undefined {
  const program = programs.get(font.technique.id);
  if (program === undefined) return undefined;
  let binding: Uint8Array | undefined;
  const resources = new Map<RasterResourceId, unknown>();
  program.compileFont({
    font,
    techniqueId: identities.resolve(font.technique.id),
    identities,
    emptyTable: emptyFontBindingTable,
    resources: (keys) => fontBindingResources(keys, identities),
    compile(descriptor) {
      if (binding !== undefined) throw new Error('raster plan font compiler produced more than one binding');
      binding = compileFontBinding(descriptor);
      return binding;
    },
    retain(key, resource) {
      if (resources.has(key)) throw new TypeError(`raster plan font retained duplicate resource "${key}"`);
      resources.set(key, resource);
    },
  });
  if (binding === undefined) throw new Error('raster plan font compiler produced no binding');
  return { binding, resources };
}

/** Validate a portable program's policy body against its declared physical schema. */
export function compileRasterPolicyBody(
  program: RasterPlanProgram<AnyRasterTechnique, unknown>,
  system: RasterPolicySystem,
  capabilities: PolicyCapabilitySet,
): CompiledPolicyProgramBody {
  const body = program.policyBody(system, capabilities);
  if (!(body.inputs instanceof Array) || !(body.operations instanceof Array)) {
    throw new TypeError('raster plan policy body must contain input and operation arrays');
  }
  return body;
}

export type { BindingResource, PolicyCapabilitySet, PolicyProgram };
