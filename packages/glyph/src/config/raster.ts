import type { Font } from '../font.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { immutableFontResources, immutableFontVariantIdentity } from '../loaded-font.js';
import type { AnyRasterFormat, RasterResourceId } from './raster-format.js';
import { isRasterFormat } from '../internal/raster-format-registry.js';
import {
  isRegisteredRasterCodec,
  registerRasterCodecInternal,
  resolveRasterCodecInternal,
} from '../internal/raster-codec-registry.js';
import {
  compileFontBinding,
  emptyFontBindingTable,
  fontBindingResources,
  schemaFieldTable,
} from '../internal/font-binding.js';
import {
  normalizePortableResource,
  type PortableBufferPayload,
  type PortableGeometryPayload,
  type PortableResource,
  type PortableResourceGroupPayload,
  type PortableTextureArrayPayload,
  type PortableTexturePayload,
} from './resources.js';
import type { CompiledCodecProgramBody, CodecProgramSystemBuffers } from './codec-program.js';
import { assertTechniqueCodecBody, normalizeCodecProgramSystemBuffers } from '../internal/codec-program-contract.js';
import {
  schemaCodecBuffers,
  type AnyTechniqueSchema,
  type TechniqueBindingDeclaration,
  type TechniqueResourceDeclaration,
} from './schema.js';
import {
  createCodecProgram,
  normalizeCodecCapabilitySet,
  type CodecAllocationMode,
  type CodecBuffer,
  type CodecCapabilitySet,
  type CodecProgram,
  type CodecTransformMode,
  type CodecIdFactory,
} from './codec.js';
import { assertCodecIdFactory, CodecIdScope } from '../internal/render-id.js';
/** System buffers are owned by the engine and are deliberately absent from a technique schema. */
export type RasterCodecSystem = CodecProgramSystemBuffers;

/** Renderer-neutral codec body, before an engine assigns program and capability identities. */
export type RasterCodecBodyFactory<Schema extends AnyTechniqueSchema = AnyTechniqueSchema> = (
  system: RasterCodecSystem,
  capabilities: CodecCapabilitySet,
) => CompiledCodecProgramBody<Schema>;

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

/** One resource row exposed by a validated compiled-font binding view. */
export interface CompiledRasterFontResource {
  /** Stable technique-authored resource identity. */
  readonly key: RasterResourceId;
  /** Immutable portable payload associated with the identity. */
  readonly payload: PortableResource;
}

type BindingFieldName<Names> = Names extends readonly string[] ? Names[number] : never;

/** Read-only semantic view over one authenticated compiled-font binding. */
export interface CompiledRasterFontView<Schema extends AnyTechniqueSchema = AnyTechniqueSchema> {
  /** Schema scope that determines the row count of named fields. */
  readonly scope: Schema['scope'];
  /** Number of glyph rows represented by the binding. */
  readonly glyphCount: number;
  /** Authored raster strikes in ascending ppem order. */
  readonly strikes: readonly number[];
  /** Resources in the exact order referenced by binding rows. */
  readonly resources: readonly CompiledRasterFontResource[];
  /** Resolve the selected resource for one glyph and strike. */
  resource(glyphIndex: number, strikeIndex: number): CompiledRasterFontResource | undefined;
  /** Read one schema-declared float field from its scoped row. */
  f32(name: BindingFieldName<Schema['binding']['f32']>, row: number): number;
  /** Read one schema-declared unsigned field from its scoped row. */
  u32(name: BindingFieldName<Schema['binding']['u32']>, row: number): number;
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
type RasterCodecSchema<Schema extends AnyTechniqueSchema> = Schema & {
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

export interface RasterCodecFontCompiler<Technique extends AnyRasterFormat, Schema extends AnyTechniqueSchema> {
  readonly font: RasterCodecFont<Technique>;
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
export interface RasterCodecFont<Technique extends AnyRasterFormat> {
  readonly raster: Technique;
  readonly glyphCount: number;
  readonly data: import('./raster-format.js').RasterDataOf<Technique>;
}

/** Portable raster Codec definition shared by every renderer integration. */
export interface RasterCodec<Technique extends AnyRasterFormat, Schema extends AnyTechniqueSchema> {
  readonly raster: Technique;
  readonly schema: RasterCodecSchema<Schema> & { readonly technique: Technique['id'] };
  readonly programVariant?: number;
  readonly codecBody: RasterCodecBodyFactory<Schema>;
  readonly compileFont: (compiler: RasterCodecFontCompiler<Technique, NoInfer<Schema>>) => CompiledRasterFont;
}

/** Host-owned capabilities and system lanes used to assemble one portable raster codec body. */
export interface RasterCodecProgramOptions {
  readonly namespace: string;
  readonly programName?: string;
  readonly system: RasterCodecSystem;
  readonly capabilitySet: CodecCapabilitySet;
  readonly transformMode: CodecTransformMode;
  readonly allocationMode: CodecAllocationMode;
  readonly ids?: CodecIdFactory;
}

/** Assemble one engine CodecProgram from a registered renderer-neutral raster Codec. */
export function createRasterCodecProgram<Technique extends AnyRasterFormat, Schema extends AnyTechniqueSchema>(
  codec: RasterCodec<Technique, Schema>,
  options: RasterCodecProgramOptions,
): CodecProgram {
  if (!isRegisteredRasterCodec(codec)) {
    throw new TypeError('raster codec assembly needs a registered RasterCodec');
  }
  if (!isRecord(options)) throw new TypeError('raster codec assembly options need an object');
  if ('identityRegistry' in options) {
    throw new TypeError('raster codec identityRegistry was renamed to ids');
  }
  if (typeof options.namespace !== 'string' || options.namespace.length === 0) {
    throw new TypeError('raster codec namespace must be a nonempty string');
  }
  if (
    options.programName !== undefined &&
    (typeof options.programName !== 'string' || options.programName.length === 0)
  ) {
    throw new TypeError('raster codec programName must be a nonempty string');
  }
  if (options.transformMode !== 'direct' && options.transformMode !== 'indexed') {
    throw new TypeError('raster codec transform mode must be "direct" or "indexed"');
  }
  if (options.allocationMode !== 'ordered' && options.allocationMode !== 'stable') {
    throw new TypeError('raster codec allocation mode must be "ordered" or "stable"');
  }
  if (options.ids !== undefined) {
    assertCodecIdFactory(options.ids, 'raster codec ids');
  }
  const system = normalizeCodecProgramSystemBuffers(codec.schema.buffers, options.system);
  const capabilitySet = normalizeCodecCapabilitySet(options.capabilitySet, 'raster codec capability set');
  const ids = options.ids ?? new CodecIdScope();
  const compiledTechniqueId = ids.technique(codec.raster);
  const compiledProgramId = ids.program(codec.raster, options.namespace, options.programName);
  const body = codec.codecBody(system, capabilitySet);
  assertTechniqueCodecBody(body, codec.schema, system);
  return Object.freeze({
    ...createCodecProgram(
      compiledTechniqueId,
      compiledProgramId,
      body,
      [...schemaCodecBuffers(codec.schema), ...systemCodecBuffers(system)],
      options.transformMode,
      options.allocationMode,
    ),
    capabilitySet,
    variant: codec.programVariant ?? 0,
  });
}

const compiledRasterFonts = new WeakSet<object>();
const compiledFonts = new WeakMap<object, CompiledRasterFont>();
const MISSING_RESOURCE = 0xffff_ffff;
type AnyRasterCodec = RasterCodec<AnyRasterFormat, AnyTechniqueSchema>;

/** Register one portable raster Codec by its RasterFormat id. */
export function registerRasterCodec<const Technique extends AnyRasterFormat, const Schema extends AnyTechniqueSchema>(
  codec: RasterCodec<Technique, Schema>,
): RasterCodec<Technique, Schema> {
  return registerRasterCodecInternal(codec, false);
}

/** Return whether `value` is the exact immutable RasterCodec produced by registration. */
export function isRasterCodec(value: unknown): value is RasterCodec<AnyRasterFormat, AnyTechniqueSchema> {
  return isRegisteredRasterCodec(value);
}

/** Compile an immutable font through the registered RasterCodec, if it has one. */
export function compileRasterFont(
  font: Font<AnyRasterFormat>,
  ids: CodecIdFactory = new CodecIdScope(),
): CompiledRasterFont | undefined {
  assertCodecIdFactory(ids, 'raster font compiler ids');
  const fontResources = immutableFontResources(font);
  return compileRasterFontSource(
    immutableFontVariantIdentity(font),
    font.raster,
    fontResources.font.glyphCount,
    fontResources.data,
    ids,
  );
}

/**
 * Read named binding fields and portable resources without exposing technique-owned decoded data.
 * The view borrows `compiled`; mutating its public byte or payload arrays invalidates later reads.
 */
export function readCompiledRasterFont<Technique extends AnyRasterFormat, Schema extends AnyTechniqueSchema>(
  compiled: CompiledRasterFont,
  codec: RasterCodec<Technique, Schema> & { readonly raster: Technique; readonly schema: Schema },
  ids: CodecIdFactory = new CodecIdScope(),
): CompiledRasterFontView<Schema> {
  if (!compiledRasterFonts.has(compiled)) throw new TypeError('compiled raster font was not created by this package');
  if (!isRecord(codec) || !isRasterFormat(codec.raster)) {
    throw new TypeError('compiled raster font reader needs a registered RasterCodec');
  }
  if (!isRegisteredRasterCodec(codec)) {
    throw new TypeError('compiled raster font reader needs a registered RasterCodec');
  }
  assertCodecIdFactory(ids, 'compiled raster font reader ids');
  const bytes = compiled.binding;
  const request = textShaperAbi.layouts.fontBindingRequest;
  const strikeLayout = textShaperAbi.layouts.fontBindingStrike;
  const resourceLayout = textShaperAbi.layouts.fontBindingResource;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < request.size) {
    throw new TypeError('compiled raster font binding is truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(request.abiVersion, true) !== textShaperAbi.version) {
    throw new TypeError('compiled raster font binding ABI version is unsupported');
  }
  if (view.getUint32(request.byteLength, true) !== bytes.byteLength) {
    throw new TypeError('compiled raster font binding byte length is invalid');
  }
  const techniqueId = ids.technique(codec.raster);
  if (view.getUint32(request.techniqueId, true) !== techniqueId) {
    throw new TypeError('compiled raster font binding technique does not match its program');
  }
  if (view.getUint16(request.programVariant, true) !== (codec.programVariant ?? 0)) {
    throw new TypeError('compiled raster font binding variant does not match its program');
  }
  const glyphCount = view.getUint32(request.glyphCount, true);
  const strikeCount = view.getUint32(request.strikeCount, true);
  const resourceCount = view.getUint32(request.resourceCount, true);
  const strikesOffset = checkedBindingRange(
    view.getUint32(request.strikesOffset, true),
    strikeCount,
    strikeLayout.size,
    bytes.byteLength,
    'strikes',
  );
  const resourcesOffset = checkedBindingRange(
    view.getUint32(request.resourcesOffset, true),
    resourceCount,
    resourceLayout.size,
    bytes.byteLength,
    'resources',
  );
  const strikeRows = checkedProduct(glyphCount, strikeCount, 'compiled raster font strike rows');
  const resourceIndicesOffset = checkedBindingRange(
    view.getUint32(request.resourceIndicesOffset, true),
    strikeRows,
    4,
    bytes.byteLength,
    'resource indices',
  );
  const strikes = Object.freeze(
    Array.from({ length: strikeCount }, (_, index) =>
      view.getUint32(strikesOffset + index * strikeLayout.size + strikeLayout.ppem, true),
    ),
  );
  const resourcesById = new Map<number, CompiledRasterFontResource>();
  for (const [key, payload] of compiled.resources) {
    const id = ids.resource(key);
    if (resourcesById.has(id)) throw new TypeError(`compiled raster font has duplicate resource identity ${id}`);
    resourcesById.set(id, Object.freeze({ key, payload }));
  }
  const resources = Object.freeze(
    Array.from({ length: resourceCount }, (_, index) => {
      const offset = resourcesOffset + index * resourceLayout.size;
      const id = view.getUint32(offset + resourceLayout.id, true);
      const resource = resourcesById.get(id);
      if (resource === undefined) throw new TypeError(`compiled raster font binding references unknown resource ${id}`);
      return resource;
    }),
  );
  if (resources.length !== resourcesById.size) {
    throw new TypeError('compiled raster font binding does not reference every portable resource');
  }
  const scope = codec.schema.scope;
  const rows = scope === 'glyph' ? glyphCount : scope === 'strike' ? strikeRows : resourceCount;
  const f32 = bindingFieldReader(view, request, bytes.byteLength, scope, 'f32', codec.schema.binding.f32 ?? [], rows);
  const u32 = bindingFieldReader(view, request, bytes.byteLength, scope, 'u32', codec.schema.binding.u32 ?? [], rows);
  return Object.freeze({
    scope,
    glyphCount,
    strikes,
    resources,
    resource(glyphIndex: number, strikeIndex: number) {
      const glyph = checkedBindingIndex(glyphIndex, glyphCount, 'glyph index');
      const strike = checkedBindingIndex(strikeIndex, strikeCount, 'strike index');
      const selected = view.getUint32(resourceIndicesOffset + (strike * glyphCount + glyph) * 4, true);
      if (selected === MISSING_RESOURCE) return undefined;
      if (selected >= resources.length) throw new RangeError('compiled raster font selected an invalid resource row');
      return resources[selected];
    },
    f32,
    u32,
  });
}

function bindingFieldReader(
  view: DataView,
  request: typeof textShaperAbi.layouts.fontBindingRequest,
  byteLength: number,
  scope: 'glyph' | 'strike' | 'resource',
  scalar: 'f32' | 'u32',
  names: readonly string[],
  rows: number,
): (name: string, row: number) => number {
  const title = `${scope}${scalar === 'f32' ? 'F32' : 'U32'}` as
    | 'glyphF32'
    | 'glyphU32'
    | 'strikeF32'
    | 'strikeU32'
    | 'resourceF32'
    | 'resourceU32';
  const fieldCount = view.getUint8(request[`${title}FieldCount`]);
  if (fieldCount !== names.length) {
    throw new TypeError(`compiled raster font ${title} fields do not match its schema`);
  }
  const offset = checkedBindingRange(
    view.getUint32(request[`${title}Offset`], true),
    checkedProduct(rows, fieldCount, `compiled raster font ${title} values`),
    4,
    byteLength,
    title,
  );
  const fields = new Map(names.map((name, index) => [name, index]));
  return (name: string, row: number) => {
    const field = fields.get(name);
    if (field === undefined) throw new TypeError(`compiled raster font has no ${scalar} field "${name}"`);
    const selectedRow = checkedBindingIndex(row, rows, `${title} row`);
    const valueOffset = offset + (field * rows + selectedRow) * 4;
    return scalar === 'f32' ? view.getFloat32(valueOffset, true) : view.getUint32(valueOffset, true);
  };
}

function checkedBindingRange(offset: number, count: number, stride: number, byteLength: number, label: string): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > byteLength) {
    throw new RangeError(`compiled raster font ${label} offset is invalid`);
  }
  const length = checkedProduct(count, stride, `compiled raster font ${label} bytes`);
  if (offset + length > byteLength) throw new RangeError(`compiled raster font ${label} is truncated`);
  return offset;
}

function checkedBindingIndex(value: number, count: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= count) {
    throw new RangeError(`compiled raster font ${label} ${value} is outside 0..${count - 1}`);
  }
  return value;
}

function compileRasterFontSource(
  cacheKey: object,
  technique: AnyRasterFormat,
  glyphCount: number,
  data: unknown,
  identities: CodecIdFactory,
): CompiledRasterFont | undefined {
  const codec = resolveRasterCodecInternal(technique.id);
  if (codec === undefined) return undefined;
  if (technique !== codec.raster) {
    throw new TypeError(`font raster does not match the registered codec for "${technique.id}"`);
  }
  const cached = compiledFonts.get(cacheKey);
  if (cached !== undefined) {
    identities.technique(codec.raster);
    for (const key of cached.resources.keys()) identities.resource(key);
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
    if (!active) throw new Error('raster codec font compiler is no longer active');
    if (failed) throw new Error('raster codec font compiler already rejected an input', { cause: failure });
  };
  const compiler = Object.freeze({
    get font() {
      assertActive();
      return Object.freeze({
        get raster() {
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
        if (compileStarted) throw new Error('raster codec font compiler already attempted a binding');
        compileStarted = true;
        const result = compileFont(codec, glyphCount, identities, resources, declaredResources, input);
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
        if (compileStarted) throw new Error('raster codec font retained a resource after compile started');
        if (typeof name !== 'string' || name.length === 0) {
          throw new TypeError('raster codec font retained a resource without a declared name');
        }
        if (typeof key !== 'string' || key.length === 0) {
          throw new TypeError(`raster codec font retained resource "${name}" without a nonempty key`);
        }
        const declared = Object.hasOwn(codec.schema.resources, name) ? codec.schema.resources[name] : undefined;
        if (declared === undefined) {
          throw new TypeError(`raster codec font retained "${key}" under undeclared resource name "${name}"`);
        }
        const retainedKeys = declaredResources.get(name) ?? [];
        if (declared.cardinality !== 'many' && retainedKeys.length !== 0) {
          throw new TypeError(`raster codec font retained declared resource "${name}" more than once`);
        }
        if (resources.has(key)) throw new TypeError(`raster codec font retained duplicate resource "${key}"`);
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
    returned = codec.compileFont(compiler);
  } finally {
    active = false;
  }
  if (failed) throw failure;
  if (isThenable(returned)) throw new TypeError('raster codec compileFont must return synchronously');
  if (compiled === undefined || returned !== compiled || !compiledRasterFonts.has(compiled)) {
    throw new Error('raster codec compileFont must return the result of compiler.compile');
  }
  compiledFonts.set(cacheKey, compiled);
  return compiled;
}

function compileFont(
  codec: AnyRasterCodec,
  glyphCount: number,
  identities: CodecIdFactory,
  retained: Map<RasterResourceId, PortableResource>,
  declaredResources: Map<string, RasterResourceId[]>,
  input: RasterFontBinding<TechniqueBindingDeclaration>,
): CompiledRasterFont {
  if (!isRecord(input)) throw new TypeError('raster codec font binding needs an object');
  const allowed = new Set([
    'strikes',
    'resource',
    ...(codec.schema.binding.f32 === undefined ? [] : ['f32']),
    ...(codec.schema.binding.u32 === undefined ? [] : ['u32']),
  ]);
  for (const name of Object.keys(input)) {
    if (!allowed.has(name)) throw new TypeError(`raster codec font binding declares unknown field "${name}"`);
  }
  const strikes = copyStrikes(input.strikes);
  const resourceReader = input.resource;
  if (typeof resourceReader !== 'function') throw new TypeError('raster codec font binding needs a resource reader');
  for (const name of Object.keys(codec.schema.resources ?? {})) {
    if ((declaredResources.get(name)?.length ?? 0) === 0) {
      throw new Error(`raster codec font did not retain declared resource "${name}"`);
    }
  }
  const selectedResourceName = codec.schema.render.resource;
  if (selectedResourceName === undefined) throw new Error('registered RasterCodec omitted its render resource');
  const selectedResourceKeys = new Set(declaredResources.get(selectedResourceName));
  const { resources, indexFor } = fontBindingResources([...retained.keys()], identities);
  const glyphRows = glyphCount;
  const strikeRows = checkedProduct(glyphCount, strikes.length, 'raster codec strike rows');
  const resourceRows = resources.length;
  const rows = codec.schema.scope === 'glyph' ? glyphRows : codec.schema.scope === 'strike' ? strikeRows : resourceRows;
  const f32Names = codec.schema.binding.f32 ?? [];
  const u32Names = codec.schema.binding.u32 ?? [];
  const f32Table = schemaFieldTable(f32Names, rows, readers(input.f32, f32Names, 'f32'));
  const u32Table = schemaFieldTable(u32Names, rows, readers(input.u32, u32Names, 'u32'));
  const emptyGlyph = emptyFontBindingTable(glyphRows);
  const emptyStrike = emptyFontBindingTable(strikeRows);
  const emptyResource = emptyFontBindingTable(resourceRows);
  const binding = compileFontBinding({
    techniqueId: identities.technique(codec.raster),
    programVariant: codec.programVariant ?? 0,
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
          `raster codec font binding selected resource "${key}" outside render role "${selectedResourceName}"`,
        );
      }
      return indexFor(key);
    },
    glyphF32: codec.schema.scope === 'glyph' ? f32Table : emptyGlyph,
    glyphU32: codec.schema.scope === 'glyph' ? u32Table : emptyGlyph,
    strikeF32: codec.schema.scope === 'strike' ? f32Table : emptyStrike,
    strikeU32: codec.schema.scope === 'strike' ? u32Table : emptyStrike,
    resourceF32: codec.schema.scope === 'resource' ? f32Table : emptyResource,
    resourceU32: codec.schema.scope === 'resource' ? u32Table : emptyResource,
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
    throw new TypeError(`raster codec font binding needs ${scalar} readers`);
  }
  for (const name of Object.keys(value)) {
    if (!names.includes(name))
      throw new TypeError(`raster codec font binding declares unknown ${scalar} reader "${name}"`);
  }
  const snapshot: Record<string, (row: number) => number> = Object.create(null);
  for (const name of names) {
    const reader = value[name];
    if (typeof reader !== 'function') throw new TypeError(`raster codec font binding needs ${scalar} reader "${name}"`);
    snapshot[name] = reader as (row: number) => number;
  }
  return snapshot;
}

function copyStrikes(value: unknown): readonly [number, ...number[]] {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError('raster codec font binding needs at least one strike');
  const strikes = value.map((strike, index) => {
    if (!Number.isSafeInteger(strike) || strike < 0 || strike > 0xffff_ffff) {
      throw new RangeError(`raster codec font binding strike ${index} needs a u32 ppem`);
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

function systemCodecBuffers(system: RasterCodecSystem): CodecBuffer[] {
  return [
    { id: system.stableGlyphId.id, scalar: 'u32', vectorWidth: 1 },
    ...(system.transformIndex === undefined
      ? []
      : [{ id: system.transformIndex.id, scalar: 'u32' as const, vectorWidth: 1 }]),
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
