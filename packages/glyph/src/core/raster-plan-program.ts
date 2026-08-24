import type { LoadedFont } from '../loaded-font.js';
import type { AnyRasterTechnique, RasterResourceId } from '../raster-technique.js';
import {
  compileFontBinding,
  emptyFontBindingTable,
  fontBindingResources,
  type FontBindingDescriptor,
  type FontBindingFieldTable,
} from './font-binding.js';
import { normalizePortableResource } from './portable-resources.js';
import type { CompiledPolicyProgramBody } from './policy-program.js';
import { isTechniqueSchema, type PolicyBufferDeclaration, type TechniqueSchema } from './technique-schema.js';
import { RenderWireIdentityRegistry, type PolicyCapabilitySet } from './render-policy.js';

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

/**
 * Portable output of cold font compilation: renderer-neutral binding bytes plus
 * retained portable resources. No renderer program or GPU object crosses this
 * boundary, and every retained resource is linked to its declared schema name.
 */
export interface CompiledRasterFont<Resource = unknown> {
  readonly binding: Uint8Array;
  readonly resources: ReadonlyMap<RasterResourceId, Resource>;
  /** Each declared schema resource name mapped to the wire identity key carrying its payload. */
  readonly declaredResources: ReadonlyMap<string, RasterResourceId>;
}

export interface RasterPlanProgramFontCompiler<Technique extends AnyRasterTechnique, Resource> {
  readonly font: LoadedFont<Technique>;
  readonly techniqueId: number;
  readonly identities: RenderWireIdentityRegistry;
  readonly emptyTable: (rows: number) => FontBindingFieldTable;
  readonly resources: (keys: readonly RasterResourceId[]) => ReturnType<typeof fontBindingResources>;
  readonly compile: (descriptor: FontBindingDescriptor) => Uint8Array;
  /**
   * Retain one immutable portable payload under a schema-declared resource name
   * and its stable technique-authored key. Retaining an undeclared name,
   * repeating a name or key, or breaking the declared payload contract rejects
   * the compiled result.
   */
  readonly retain: (name: string, key: RasterResourceId, resource: Resource) => void;
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
const registeredSources = new WeakMap<object, ErasedProgram>();

/** Register one portable technique program by its technique id. */
export function registerRasterPlanProgram<Technique extends AnyRasterTechnique, Resource>(
  program: RasterPlanProgram<Technique, Resource>,
): void {
  if (typeof program !== 'object' || program === null) {
    throw new TypeError('raster plan programs need a technique with a string id');
  }
  const source = program as unknown as Record<string, unknown>;
  const technique = source.technique;
  const techniqueId =
    typeof technique === 'object' && technique !== null && !Array.isArray(technique)
      ? (technique as { id?: unknown }).id
      : undefined;
  if (typeof techniqueId !== 'string' || techniqueId.length === 0) {
    throw new TypeError('raster plan programs need a technique with a string id');
  }
  const schema = source.schema;
  const policyBody = source.policyBody;
  const compileFont = source.compileFont;
  if (!isTechniqueSchema(schema)) {
    throw new TypeError(`raster plan program "${techniqueId}" needs a schema from defineTechniqueSchema`);
  }
  if (schema.technique !== techniqueId) {
    throw new TypeError(`raster plan program "${techniqueId}" schema names technique "${schema.technique}"`);
  }
  if (typeof policyBody !== 'function' || typeof compileFont !== 'function') {
    throw new TypeError(`raster plan program "${techniqueId}" needs policyBody and compileFont callbacks`);
  }
  const registered = registeredSources.get(program as unknown as object);
  if (registered !== undefined) return;
  const existing = programs.get(techniqueId);
  if (existing !== undefined) {
    throw new TypeError(`a different raster plan program is already registered for "${techniqueId}"`);
  }
  const snapshot = Object.freeze({
    technique: Object.freeze({ id: techniqueId }) as Technique,
    schema,
    policyBody,
    compileFont,
  }) as unknown as ErasedProgram;
  programs.set(techniqueId, snapshot);
  registeredSources.set(source, snapshot);
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
  const declaredResources = new Map<string, RasterResourceId>();
  let active = true;
  const assertActive = () => {
    if (!active) throw new Error('raster plan font compiler is no longer active');
  };
  const compiler = Object.freeze({
    font,
    techniqueId: identities.resolve(font.technique.id),
    identities,
    emptyTable(rows: number) {
      assertActive();
      return emptyFontBindingTable(rows);
    },
    resources(keys: readonly RasterResourceId[]) {
      assertActive();
      return fontBindingResources(keys, identities);
    },
    compile(descriptor: FontBindingDescriptor) {
      assertActive();
      if (binding !== undefined) throw new Error('raster plan font compiler produced more than one binding');
      binding = compileFontBinding(descriptor);
      return new Uint8Array(binding);
    },
    retain(name: string, key: RasterResourceId, resource: unknown) {
      assertActive();
      if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('raster plan font retained a resource without a declared name');
      }
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError(`raster plan font retained resource "${name}" without a nonempty key`);
      }
      const declaredResourcesSchema = program.schema.resources;
      const declared =
        declaredResourcesSchema !== undefined && Object.hasOwn(declaredResourcesSchema, name)
          ? declaredResourcesSchema[name]
          : undefined;
      if (declared === undefined) {
        throw new TypeError(`raster plan font retained "${key}" under undeclared resource name "${name}"`);
      }
      if (declaredResources.has(name)) {
        throw new TypeError(`raster plan font retained declared resource "${name}" more than once`);
      }
      if (resources.has(key)) throw new TypeError(`raster plan font retained duplicate resource "${key}"`);
      const normalized = normalizePortableResource(
        declared.kind,
        name,
        resource,
        (declared.kind === 'texture' || declared.kind === 'texture-array') && 'format' in declared
          ? declared.format
          : undefined,
      );
      declaredResources.set(name, key);
      resources.set(key, normalized);
    },
  });
  try {
    program.compileFont(compiler);
  } finally {
    active = false;
  }
  if (binding === undefined) throw new Error('raster plan font compiler produced no binding');
  const geometryResource = program.schema.render?.geometry.resource;
  if (geometryResource !== undefined && !declaredResources.has(geometryResource)) {
    throw new Error(`raster plan font did not retain declared geometry resource "${geometryResource}"`);
  }
  return {
    binding,
    resources: readonlyMap(resources),
    declaredResources: readonlyMap(declaredResources),
  };
}

function readonlyMap<Key, Value>(source: Map<Key, Value>): ReadonlyMap<Key, Value> {
  return Object.freeze({
    get: source.get.bind(source),
    has: source.has.bind(source),
    get size() {
      return source.size;
    },
    entries: source.entries.bind(source),
    keys: source.keys.bind(source),
    values: source.values.bind(source),
    forEach: source.forEach.bind(source),
    [Symbol.iterator]: source[Symbol.iterator].bind(source),
  });
}
