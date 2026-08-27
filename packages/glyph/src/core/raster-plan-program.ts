import type { Font } from '../font.js';
import { immutableFontResources, type LoadedFont } from '../loaded-font.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { isRasterTechnique, type AnyRasterTechnique, type RasterResourceId } from '../raster-technique.js';
import { compileFontBinding, emptyFontBindingTable, fontBindingResources, schemaFieldTable } from './font-binding.js';
import {
  normalizePortableResource,
  type PortableBufferPayload,
  type PortableGeometryPayload,
  type PortableResource,
  type PortableResourceGroupPayload,
  type PortableTextureArrayPayload,
  type PortableTexturePayload,
} from './portable-resources.js';
import {
  assertTechniquePolicyBody,
  normalizePolicyProgramSystemBuffers,
  type CompiledPolicyProgramBody,
  type PolicyProgramSystemBuffers,
} from './policy-program.js';
import {
  isTechniqueSchema,
  schemaPolicyBuffers,
  type AnyTechniqueSchema,
  type TechniqueBindingDeclaration,
  type TechniqueResourceDeclaration,
} from './technique-schema.js';
import {
  createProgram,
  normalizePolicyCapabilitySet,
  RenderWireIdentityRegistry,
  type PolicyAllocationMode,
  type PolicyBuffer,
  type PolicyCapabilitySet,
  type PolicyProgram,
  type PolicyTransformMode,
} from './render-policy.js';

/** System buffers are owned by the engine and are deliberately absent from a technique schema. */
export type RasterPolicySystem = PolicyProgramSystemBuffers;

/** Renderer-neutral policy body, before an engine assigns program and capability identities. */
export type RasterPolicyBodyFactory<Schema extends AnyTechniqueSchema = AnyTechniqueSchema> = (
  system: RasterPolicySystem,
  capabilities: PolicyCapabilitySet,
) => CompiledPolicyProgramBody<Schema>;

/**
 * Portable output of cold font compilation: renderer-neutral binding bytes plus
 * retained portable resources. No renderer program or GPU object crosses this
 * boundary, and every retained resource is linked to its declared schema name.
 */
export interface CompiledRasterFont {
  readonly binding: Uint8Array;
  readonly resources: ReadonlyMap<RasterResourceId, PortableResource>;
  /** Each logical schema role mapped to the one or more retained keys carrying its payloads. */
  readonly declaredResources: ReadonlyMap<string, readonly RasterResourceId[]>;
}

type ResourcePayload<Declaration extends TechniqueResourceDeclaration> = Declaration['kind'] extends 'buffer'
  ? PortableBufferPayload
  : Declaration['kind'] extends 'texture'
    ? PortableTexturePayload
    : Declaration['kind'] extends 'texture-array'
      ? PortableTextureArrayPayload
      : Declaration['kind'] extends 'geometry'
        ? PortableGeometryPayload
        : PortableResourceGroupPayload;

type SchemaResources<Schema extends AnyTechniqueSchema> = NonNullable<Schema['resources']>;
type SchemaResourceName<Schema extends AnyTechniqueSchema> = keyof SchemaResources<Schema> & string;
type RasterPlanSchema<Schema extends AnyTechniqueSchema> = Schema & {
  readonly render: { readonly resource: keyof Schema['resources'] & string };
};
type BindingReaders<Names> = Names extends readonly string[]
  ? { readonly [Name in Names[number]]: (row: number) => number }
  : Readonly<Record<never, never>>;

export type RasterFontBinding<Binding extends TechniqueBindingDeclaration> = {
  readonly strikes: readonly [number, ...number[]];
  /** Select the resource for one glyph and authored strike. */
  readonly resource: (glyphIndex: number, strikeIndex: number) => RasterResourceId | undefined;
} & (Binding['f32'] extends readonly string[]
  ? { readonly f32: BindingReaders<Binding['f32']> }
  : { readonly f32?: never }) &
  (Binding['u32'] extends readonly string[]
    ? { readonly u32: BindingReaders<Binding['u32']> }
    : { readonly u32?: never });

export interface RasterPlanProgramFontCompiler<
  Technique extends AnyRasterTechnique,
  Schema extends AnyTechniqueSchema,
> {
  readonly font: RasterPlanFont<Technique>;
  readonly compile: (binding: RasterFontBinding<Schema['binding']>) => CompiledRasterFont;
  /**
   * Retain one immutable portable payload under a schema-declared resource name
   * and its stable technique-authored key. Retaining an undeclared name,
   * repeating a name or key, or breaking the declared payload contract rejects
   * the compiled result.
   */
  readonly retain: <Name extends SchemaResourceName<Schema>>(
    name: Name,
    key: RasterResourceId,
    resource: ResourcePayload<SchemaResources<Schema>[Name]>,
  ) => void;
}

/** Technique data exposed only while its registered portable font compiler is active. */
export interface RasterPlanFont<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly glyphCount: number;
  readonly data: import('../raster-technique.js').RasterDataOf<Technique>;
}

/** Portable technique data shared by every engine that consumes a raster plan. */
export interface RasterPlanProgram<Technique extends AnyRasterTechnique, Schema extends AnyTechniqueSchema> {
  readonly technique: Technique;
  readonly schema: RasterPlanSchema<Schema> & { readonly technique: Technique['id'] };
  readonly programVariant?: number;
  readonly policyBody: RasterPolicyBodyFactory<Schema>;
  readonly compileFont: (compiler: RasterPlanProgramFontCompiler<Technique, NoInfer<Schema>>) => CompiledRasterFont;
}

/** Host-owned capabilities and system lanes used to assemble one portable raster policy body. */
export interface RasterPolicyProgramOptions {
  readonly namespace: string;
  readonly programName?: string;
  readonly system: RasterPolicySystem;
  readonly capabilitySet: PolicyCapabilitySet;
  readonly transformMode: PolicyTransformMode;
  readonly allocationMode: PolicyAllocationMode;
  readonly identityRegistry?: RenderWireIdentityRegistry;
}

/** Assemble one engine PolicyProgram from a registered renderer-neutral plan. */
export function createRasterPolicyProgram<Technique extends AnyRasterTechnique, Schema extends AnyTechniqueSchema>(
  program: RasterPlanProgram<Technique, Schema>,
  options: RasterPolicyProgramOptions,
): PolicyProgram {
  const erasedProgram = program as unknown as ErasedProgram;
  if (programs.get(program.technique.id) !== erasedProgram) {
    throw new TypeError('raster policy assembly needs the registered portable plan program');
  }
  if (!isRecord(options)) throw new TypeError('raster policy assembly options need an object');
  if (typeof options.namespace !== 'string' || options.namespace.length === 0) {
    throw new TypeError('raster policy namespace must be a nonempty string');
  }
  if (
    options.programName !== undefined &&
    (typeof options.programName !== 'string' || options.programName.length === 0)
  ) {
    throw new TypeError('raster policy programName must be a nonempty string');
  }
  if (options.transformMode !== 'direct' && options.transformMode !== 'indexed') {
    throw new TypeError('raster policy transform mode must be "direct" or "indexed"');
  }
  if (options.allocationMode !== 'ordered' && options.allocationMode !== 'stable') {
    throw new TypeError('raster policy allocation mode must be "ordered" or "stable"');
  }
  if (options.identityRegistry !== undefined && !(options.identityRegistry instanceof RenderWireIdentityRegistry)) {
    throw new TypeError('raster policy identityRegistry must be a RenderWireIdentityRegistry');
  }
  const system = normalizePolicyProgramSystemBuffers(program.schema.buffers, options.system);
  const capabilitySet = normalizePolicyCapabilitySet(options.capabilitySet, 'raster policy capability set');
  const identities = options.identityRegistry ?? new RenderWireIdentityRegistry();
  const compiledTechniqueId = identities.techniqueId(program.technique);
  const compiledProgramId = identities.programId(program.technique, options.namespace, options.programName);
  const body = program.policyBody(system, capabilitySet);
  assertTechniquePolicyBody(body, program.schema, system);
  return Object.freeze({
    ...createProgram(
      compiledTechniqueId,
      compiledProgramId,
      body,
      [...schemaPolicyBuffers(program.schema), ...systemPolicyBuffers(system)],
      options.transformMode,
      options.allocationMode,
    ),
    capabilitySet,
    variant: program.programVariant ?? 0,
  });
}

type ErasedProgram = RasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>;

const programs = new Map<string, ErasedProgram>();
const registeredSources = new WeakMap<object, ErasedProgram>();
const compiledRasterFonts = new WeakSet<object>();
const compiledFonts = new WeakMap<object, CompiledRasterFont>();
const MISSING_RESOURCE = 0xffff_ffff;

/** Register one portable technique program by its technique id. */
export function registerRasterPlanProgram<
  const Technique extends AnyRasterTechnique,
  const Schema extends AnyTechniqueSchema,
>(program: RasterPlanProgram<Technique, Schema>): RasterPlanProgram<Technique, Schema> {
  return registerRasterPlanProgramOwned(program, false);
}

/** @internal Register one package-owned built-in through the same validation path. */
export function registerGlyphRasterPlanProgram<
  const Technique extends AnyRasterTechnique,
  const Schema extends AnyTechniqueSchema,
>(program: RasterPlanProgram<Technique, Schema>): RasterPlanProgram<Technique, Schema> {
  return registerRasterPlanProgramOwned(program, true);
}

function registerRasterPlanProgramOwned<
  const Technique extends AnyRasterTechnique,
  const Schema extends AnyTechniqueSchema,
>(program: RasterPlanProgram<Technique, Schema>, glyphOwned: boolean): RasterPlanProgram<Technique, Schema> {
  if (typeof program !== 'object' || program === null) {
    throw new TypeError('raster plan programs need a technique with id, kind, extension, and nonnegative version');
  }
  const source = program as unknown as Record<string, unknown>;
  const technique = source.technique;
  const techniqueId = isRasterTechnique(technique) ? technique.id : undefined;
  const techniqueRecord = technique as {
    id?: unknown;
    kind?: unknown;
    extension?: unknown;
    version?: unknown;
  };
  if (
    typeof techniqueId !== 'string' ||
    techniqueId.length === 0 ||
    typeof techniqueRecord.kind !== 'string' ||
    techniqueRecord.kind.length === 0 ||
    typeof techniqueRecord.extension !== 'string' ||
    techniqueRecord.extension.length === 0 ||
    typeof techniqueRecord.version !== 'number' ||
    !Number.isSafeInteger(techniqueRecord.version) ||
    techniqueRecord.version < 0
  ) {
    throw new TypeError('raster plan programs need a technique with id, kind, extension, and nonnegative version');
  }
  if (!glyphOwned && techniqueId.startsWith('pmndrs.')) {
    throw new TypeError(`raster plan program id "${techniqueId}" is reserved for Glyph-owned techniques`);
  }
  const schema = source.schema;
  const programVariant = source.programVariant ?? 0;
  const policyBody = source.policyBody;
  const compileFontCallback = source.compileFont;
  if (!isTechniqueSchema(schema)) {
    throw new TypeError(`raster plan program "${techniqueId}" needs a schema from defineTechniqueSchema`);
  }
  if (schema.technique !== techniqueId) {
    throw new TypeError(`raster plan program "${techniqueId}" schema names technique "${schema.technique}"`);
  }
  if (Object.keys(schema.resources).length === 0) {
    throw new TypeError(`raster plan program "${techniqueId}" needs at least one declared resource`);
  }
  if (schema.render.resource === undefined) {
    throw new TypeError(`raster plan program "${techniqueId}" needs a declared render resource`);
  }
  if (!Number.isSafeInteger(programVariant) || (programVariant as number) < 0 || (programVariant as number) > 0xffff) {
    throw new RangeError(`raster plan program "${techniqueId}" needs a u16 program variant`);
  }
  if (typeof policyBody !== 'function' || typeof compileFontCallback !== 'function') {
    throw new TypeError(`raster plan program "${techniqueId}" needs policyBody and compileFont callbacks`);
  }
  const registered = registeredSources.get(program as unknown as object);
  if (registered !== undefined) {
    if (registered.technique.id !== techniqueId) {
      throw new TypeError(
        `raster plan program source changed technique id from "${registered.technique.id}" to "${techniqueId}"`,
      );
    }
    return registered as unknown as RasterPlanProgram<Technique, Schema>;
  }
  const existing = programs.get(techniqueId);
  if (existing !== undefined) {
    throw new TypeError(`a different raster plan program is already registered for "${techniqueId}"`);
  }
  const snapshot = Object.freeze({
    technique,
    schema,
    programVariant,
    policyBody,
    compileFont: compileFontCallback,
  }) as unknown as ErasedProgram;
  programs.set(techniqueId, snapshot);
  registeredSources.set(source, snapshot);
  registeredSources.set(snapshot, snapshot);
  return snapshot as unknown as RasterPlanProgram<Technique, Schema>;
}

/** Resolve the portable program associated with a technique id. */
export function resolveRasterPlanProgram(id: string): ErasedProgram | undefined {
  return programs.get(id);
}

/** Compile an immutable font through the registered portable program, if it has one. */
export function compileRasterFont(
  font: Font<AnyRasterTechnique>,
  identities: RenderWireIdentityRegistry,
): CompiledRasterFont | undefined {
  const fontResources = immutableFontResources(font);
  return compileRasterFontSource(font, font.technique, fontResources.font.glyphCount, fontResources.data, identities);
}

/** @internal Temporary bridge while first-party integrations migrate from runtime-bound fonts. */
export function compileLoadedRasterFont(
  font: LoadedFont<AnyRasterTechnique>,
  identities: RenderWireIdentityRegistry,
): CompiledRasterFont | undefined {
  if (font.disposed) throw new TypeError('cannot compile a disposed loaded font');
  return compileRasterFontSource(font, font.technique, font.font.glyphCount, font.data, identities);
}

function compileRasterFontSource(
  cacheKey: object,
  technique: AnyRasterTechnique,
  glyphCount: number,
  data: unknown,
  identities: RenderWireIdentityRegistry,
): CompiledRasterFont | undefined {
  const program = programs.get(technique.id);
  if (program === undefined) return undefined;
  if (technique !== program.technique) {
    throw new TypeError(`font technique does not match the registered program for "${technique.id}"`);
  }
  const cached = compiledFonts.get(cacheKey);
  if (cached !== undefined) {
    identities.techniqueId(program.technique);
    for (const key of cached.resources.keys()) identities.resourceId(key);
    return cached;
  }
  let compiled: CompiledRasterFont | undefined;
  let compileStarted = false;
  const resources = new Map<RasterResourceId, PortableResource>();
  const declaredResources = new Map<string, RasterResourceId[]>();
  let active = true;
  let failed = false;
  let failure: unknown;
  const assertActive = () => {
    if (!active) throw new Error('raster plan font compiler is no longer active');
    if (failed) throw new Error('raster plan font compiler already rejected an input', { cause: failure });
  };
  const compiler = Object.freeze({
    get font() {
      assertActive();
      return Object.freeze({
        get technique() {
          assertActive();
          return technique;
        },
        get glyphCount() {
          assertActive();
          return glyphCount;
        },
        get data() {
          assertActive();
          return data;
        },
      });
    },
    compile(input: RasterFontBinding<TechniqueBindingDeclaration>) {
      assertActive();
      try {
        if (compileStarted) throw new Error('raster plan font compiler already attempted a binding');
        compileStarted = true;
        const result = compileFont(program, glyphCount, identities, resources, declaredResources, input);
        compiled = result;
        compiledRasterFonts.add(result);
        return result;
      } catch (error) {
        failed = true;
        failure = error;
        throw error;
      }
    },
    retain(name: string, key: RasterResourceId, resource: unknown) {
      assertActive();
      try {
        if (compileStarted) throw new Error('raster plan font retained a resource after compile started');
        if (typeof name !== 'string' || name.length === 0) {
          throw new TypeError('raster plan font retained a resource without a declared name');
        }
        if (typeof key !== 'string' || key.length === 0) {
          throw new TypeError(`raster plan font retained resource "${name}" without a nonempty key`);
        }
        const declared = Object.hasOwn(program.schema.resources, name) ? program.schema.resources[name] : undefined;
        if (declared === undefined) {
          throw new TypeError(`raster plan font retained "${key}" under undeclared resource name "${name}"`);
        }
        const retainedKeys = declaredResources.get(name) ?? [];
        if (declared.cardinality !== 'many' && retainedKeys.length !== 0) {
          throw new TypeError(`raster plan font retained declared resource "${name}" more than once`);
        }
        if (resources.has(key)) throw new TypeError(`raster plan font retained duplicate resource "${key}"`);
        const normalized = normalizeDeclaredResource(declared, name, resource);
        retainedKeys.push(key);
        declaredResources.set(name, retainedKeys);
        resources.set(key, normalized as PortableResource);
      } catch (error) {
        failed = true;
        failure = error;
        throw error;
      }
    },
  });
  let returned: unknown;
  try {
    returned = program.compileFont(compiler);
  } finally {
    active = false;
  }
  if (failed) throw failure;
  if (isThenable(returned)) throw new TypeError('raster plan compileFont must return synchronously');
  if (compiled === undefined || returned !== compiled || !compiledRasterFonts.has(compiled)) {
    throw new Error('raster plan compileFont must return the result of compiler.compile');
  }
  compiledFonts.set(cacheKey, compiled);
  return compiled;
}

function compileFont(
  program: ErasedProgram,
  glyphCount: number,
  identities: RenderWireIdentityRegistry,
  retained: Map<RasterResourceId, PortableResource>,
  declaredResources: Map<string, RasterResourceId[]>,
  input: RasterFontBinding<TechniqueBindingDeclaration>,
): CompiledRasterFont {
  if (!isRecord(input)) throw new TypeError('raster plan font binding needs an object');
  const allowed = new Set([
    'strikes',
    'resource',
    ...(program.schema.binding.f32 === undefined ? [] : ['f32']),
    ...(program.schema.binding.u32 === undefined ? [] : ['u32']),
  ]);
  for (const name of Object.keys(input)) {
    if (!allowed.has(name)) throw new TypeError(`raster plan font binding declares unknown field "${name}"`);
  }
  const strikes = copyStrikes(input.strikes);
  const resourceReader = input.resource;
  if (typeof resourceReader !== 'function') throw new TypeError('raster plan font binding needs a resource reader');
  for (const name of Object.keys(program.schema.resources ?? {})) {
    if ((declaredResources.get(name)?.length ?? 0) === 0) {
      throw new Error(`raster plan font did not retain declared resource "${name}"`);
    }
  }
  const selectedResourceName = program.schema.render.resource;
  if (selectedResourceName === undefined) throw new Error('registered raster plan program omitted its render resource');
  const selectedResourceKeys = new Set(declaredResources.get(selectedResourceName));
  const { resources, indexFor } = fontBindingResources([...retained.keys()], identities);
  const glyphRows = glyphCount;
  const strikeRows = checkedProduct(glyphCount, strikes.length, 'raster plan strike rows');
  const resourceRows = resources.length;
  const rows =
    program.schema.scope === 'glyph' ? glyphRows : program.schema.scope === 'strike' ? strikeRows : resourceRows;
  const f32Names = program.schema.binding.f32 ?? [];
  const u32Names = program.schema.binding.u32 ?? [];
  const f32Table = schemaFieldTable(f32Names, rows, readers(input.f32, f32Names, 'f32'));
  const u32Table = schemaFieldTable(u32Names, rows, readers(input.u32, u32Names, 'u32'));
  const emptyGlyph = emptyFontBindingTable(glyphRows);
  const emptyStrike = emptyFontBindingTable(strikeRows);
  const emptyResource = emptyFontBindingTable(resourceRows);
  const binding = compileFontBinding({
    techniqueId: identities.techniqueId(program.technique),
    programVariant: program.programVariant ?? 0,
    glyphCount,
    strikes,
    resources,
    resourceIndex(strikeRow) {
      const glyphIndex = strikeRow % glyphCount;
      const strikeIndex = Math.floor(strikeRow / glyphCount);
      const key = resourceReader(glyphIndex, strikeIndex);
      if (key === undefined) return MISSING_RESOURCE;
      if (!selectedResourceKeys.has(key)) {
        throw new TypeError(
          `raster plan font binding selected resource "${key}" outside render role "${selectedResourceName}"`,
        );
      }
      return indexFor(key);
    },
    glyphF32: program.schema.scope === 'glyph' ? f32Table : emptyGlyph,
    glyphU32: program.schema.scope === 'glyph' ? u32Table : emptyGlyph,
    strikeF32: program.schema.scope === 'strike' ? f32Table : emptyStrike,
    strikeU32: program.schema.scope === 'strike' ? u32Table : emptyStrike,
    resourceF32: program.schema.scope === 'resource' ? f32Table : emptyResource,
    resourceU32: program.schema.scope === 'resource' ? u32Table : emptyResource,
  });
  return Object.freeze({
    binding,
    resources: readonlyMap(retained),
    declaredResources: readonlyMap(
      new Map([...declaredResources].map(([name, keys]) => [name, Object.freeze([...keys])])),
    ),
  });
}

function normalizeDeclaredResource(
  declaration: TechniqueResourceDeclaration,
  name: string,
  resource: unknown,
): PortableResource {
  if (declaration.kind !== 'group') {
    return normalizePortableResource(
      declaration.kind,
      name,
      resource,
      declaration.kind === 'texture' || declaration.kind === 'texture-array' ? declaration.format : undefined,
      declaration.kind === 'geometry' ? declaration.attributes : undefined,
    );
  }
  return normalizePortableResource('group', name, resource, undefined, undefined, declaration.members);
}

function readers(value: unknown, names: readonly string[], scalar: 'f32' | 'u32') {
  if (!isRecord(value)) {
    if (names.length === 0) return {};
    throw new TypeError(`raster plan font binding needs ${scalar} readers`);
  }
  for (const name of Object.keys(value)) {
    if (!names.includes(name))
      throw new TypeError(`raster plan font binding declares unknown ${scalar} reader "${name}"`);
  }
  const snapshot: Record<string, (row: number) => number> = Object.create(null);
  for (const name of names) {
    const reader = value[name];
    if (typeof reader !== 'function') throw new TypeError(`raster plan font binding needs ${scalar} reader "${name}"`);
    snapshot[name] = reader as (row: number) => number;
  }
  return snapshot;
}

function copyStrikes(value: unknown): readonly [number, ...number[]] {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError('raster plan font binding needs at least one strike');
  const strikes = value.map((strike, index) => {
    if (!Number.isSafeInteger(strike) || strike < 0 || strike > 0xffff_ffff) {
      throw new RangeError(`raster plan font binding strike ${index} needs a u32 ppem`);
    }
    return strike;
  });
  return Object.freeze(strikes) as unknown as readonly [number, ...number[]];
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > 0xffff_ffff) throw new RangeError(`${label} exceeds u32`);
  return value;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

function systemPolicyBuffers(system: RasterPolicySystem): PolicyBuffer[] {
  const u32Scalar = textShaperAbi.policy.scalarTypes.u32;
  return [
    { id: system.stableGlyphId.id, scalar: u32Scalar, vectorWidth: 1 },
    ...(system.transformIndex === undefined
      ? []
      : [{ id: system.transformIndex.id, scalar: u32Scalar, vectorWidth: 1 }]),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readonlyMap<Key, Value>(source: Map<Key, Value>): ReadonlyMap<Key, Value> {
  let view: ReadonlyMap<Key, Value>;
  view = Object.freeze({
    get: source.get.bind(source),
    has: source.has.bind(source),
    get size() {
      return source.size;
    },
    entries: source.entries.bind(source),
    keys: source.keys.bind(source),
    values: source.values.bind(source),
    forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator]: source[Symbol.iterator].bind(source),
  });
  return view;
}
