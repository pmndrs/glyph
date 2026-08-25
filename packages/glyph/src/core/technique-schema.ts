/**
 * The single authority for a raster technique's physical shape. A schema declares —
 * once, colocated with the technique — the buffer ids, scalar kinds, and lane
 * meanings that its policy programs produce and its shader realizations consume,
 * plus the portable render contract: named resources and declared geometry.
 * Policy stores, binding compilers, plan executors, and shader interfaces all
 * derive from the declaration; none of them restate it.
 */

import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { RasterTechniqueId } from '../raster-technique.js';
import {
  assertPortableVertexSemantic,
  portableTextureFormats,
  type PortableTextureFormat,
  type PortableVertexInput,
} from './portable-resources.js';
import type { PolicyBuffer } from './render-policy.js';

export type PolicyScalarKind = 'f32' | 'u32';

export interface PolicyBufferDeclaration<
  Scalar extends PolicyScalarKind = PolicyScalarKind,
  Lanes extends readonly string[] = readonly string[],
> {
  /** Wire buffer id — nonzero, unique within the owning program. */
  readonly id: number;
  readonly scalar: Scalar;
  /** One name per lane; the lane count is the buffer's vector width. */
  readonly lanes: Lanes;
}

export type PolicyBufferDeclarations = Readonly<Record<string, PolicyBufferDeclaration>>;

const techniqueSchemaBrand: unique symbol = Symbol('glyph.technique-schema');
const techniqueSchemaInstances = new WeakSet<object>();

/**
 * Validate and freeze a named buffer set: nonzero unique ids, at least one lane
 * each. The result is an owned, deeply frozen copy — caller input is never
 * mutated (rejection leaves it untouched), and caller accessors are read once
 * here so they can never change a validated width afterwards.
 */
export function definePolicyBuffers<const Buffers extends PolicyBufferDeclarations>(buffers: Buffers): Buffers {
  if (!isNonArrayObject(buffers)) throw new TypeError('policy buffers need a declaration object');
  const seen = new Set<number>();
  const owned: Record<string, PolicyBufferDeclaration> = Object.create(null);
  for (const [name, buffer] of Object.entries(buffers)) {
    if (name.length === 0) throw new TypeError('policy buffer names must not be empty');
    const sourceLanes = isNonArrayObject(buffer) ? buffer.lanes : undefined;
    if (!Array.isArray(sourceLanes)) {
      throw new TypeError(`policy buffer "${name}" needs a declaration with named lanes`);
    }
    const id = buffer.id;
    const scalar = buffer.scalar;
    const lanes = sourceLanes.map((lane, index) => {
      if (typeof lane !== 'string' || lane.length === 0) {
        throw new TypeError(`policy buffer "${name}" lane ${index} needs a nonempty name`);
      }
      return lane;
    });
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffff) {
      throw new RangeError(`policy buffer "${name}" needs a nonzero u16 id`);
    }
    if (seen.has(id)) throw new TypeError(`policy buffer "${name}" reuses id ${id}`);
    seen.add(id);
    if (scalar !== 'f32' && scalar !== 'u32') {
      throw new TypeError(`policy buffer "${name}" needs an f32 or u32 scalar kind`);
    }
    if (lanes.length === 0 || lanes.length > 4) {
      throw new RangeError(`policy buffer "${name}" needs one to four named lanes`);
    }
    if (new Set(lanes).size !== lanes.length) throw new TypeError(`policy buffer "${name}" repeats a lane name`);
    owned[name] = Object.freeze({ id, scalar, lanes: Object.freeze(lanes) });
  }
  // The copy carries exactly the declared keys read above, so it satisfies Buffers.
  return Object.freeze(owned) as Buffers;
}

export interface TechniqueBindingDeclaration {
  readonly f32?: readonly string[];
  readonly u32?: readonly string[];
}

/** Immutable byte payload; retained payloads validate as `PortableBufferPayload`. */
export interface TechniqueBufferResourceDeclaration {
  readonly kind: 'buffer';
  readonly format?: never;
}

/** Immutable sample payload; retained payloads validate as `PortableTexturePayload`. */
export interface TechniqueTextureResourceDeclaration {
  readonly kind: 'texture';
  readonly format: PortableTextureFormat;
}

/** Immutable layered sample payload; retained payloads validate as `PortableTextureArrayPayload`. */
export interface TechniqueTextureArrayResourceDeclaration {
  readonly kind: 'texture-array';
  readonly format: PortableTextureFormat;
}

/** GLB-like geometry payload; retained payloads validate as `PortableGeometryPayload`. */
export interface TechniqueGeometryResourceDeclaration {
  readonly kind: 'geometry';
  /** Vertex semantics and scalar shapes the technique's shader consumes. */
  readonly attributes: readonly PortableVertexInput[];
  readonly format?: never;
}

/**
 * One declared logical resource from the constrained portable payload
 * vocabulary. Renderer-specific or opaque payloads cannot cross this boundary.
 */
export type TechniqueResourceDeclaration =
  | TechniqueBufferResourceDeclaration
  | TechniqueTextureResourceDeclaration
  | TechniqueTextureArrayResourceDeclaration
  | TechniqueGeometryResourceDeclaration;

export type TechniqueResourceDeclarations = Readonly<Record<string, TechniqueResourceDeclaration>>;
type NoTechniqueResources = Readonly<Record<never, never>>;

/**
 * Portable geometry kinds, deliberately disjoint from the wire
 * `enginePrimitive` command enum (`glyph`, `decoration`, …): a wire primitive
 * is a record-span command, while this vocabulary says what geometry one draw
 * realizes. `synthetic-quad` is the implicit generated unit quad and needs no
 * resource; every other kind — `quad` today, technique kinds such as `hull`
 * later — supplies an explicit geometry resource.
 */
declare const techniqueGeometryKindBrand: unique symbol;

/** A named supplied shape beyond the built-in quad and hull vocabulary. */
export type TechniqueCustomGeometryKind = string & { readonly [techniqueGeometryKindBrand]: true };

export type TechniqueGeometryKind = 'synthetic-quad' | 'quad' | 'hull' | 'custom';

export type TechniqueSuppliedGeometryKind = Exclude<TechniqueGeometryKind, 'synthetic-quad'>;

/** The coordinate convention a supplied geometry's positions are authored in. */
export type TechniqueGeometryCoordinates = 'unit-square' | 'em';

export type TechniqueGeometryDeclaration<ResourceName extends string = string> =
  | {
      readonly kind: 'synthetic-quad';
      readonly resource?: never;
      readonly coordinates?: never;
    }
  | (
      | {
          readonly kind: 'quad' | 'hull';
          readonly name?: never;
          /** The declared geometry resource realizing this geometry. */
          readonly resource: ResourceName;
          /** Position convention of the supplied vertex positions. */
          readonly coordinates: TechniqueGeometryCoordinates;
        }
      | {
          readonly kind: 'custom';
          readonly name: TechniqueCustomGeometryKind;
          readonly resource: ResourceName;
          readonly coordinates: TechniqueGeometryCoordinates;
        }
    );

export interface TechniqueRenderDeclaration<ResourceName extends string = string> {
  /** The geometry this technique's draws realize. */
  readonly geometry: TechniqueGeometryDeclaration<ResourceName>;
}

type GeometryResourceNames<Resources extends TechniqueResourceDeclarations> = string extends keyof Resources
  ? string
  : {
      [Name in keyof Resources]: Resources[Name] extends TechniqueGeometryResourceDeclaration ? Name : never;
    }[keyof Resources] &
      string;

type GlyphOriginBufferNames<Buffers extends PolicyBufferDeclarations> = string extends keyof Buffers
  ? string
  : {
      [Name in keyof Buffers]: Buffers[Name] extends PolicyBufferDeclaration<
        'f32',
        readonly [string, string, ...string[]]
      >
        ? Name
        : never;
    }[keyof Buffers] &
      string;

export interface TechniqueSchemaDeclaration<
  Buffers extends PolicyBufferDeclarations = PolicyBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
  Resources extends TechniqueResourceDeclarations = TechniqueResourceDeclarations,
  TechniqueId extends string = string,
> {
  /** Wire identity string, e.g. `pmndrs.bitmap`. */
  readonly technique: TechniqueId;
  /** Binding input scope the technique's per-glyph data arrives through. */
  readonly scope: 'glyph' | 'strike' | 'resource';
  readonly binding: Binding;
  readonly buffers: Buffers;
  readonly resources?: Resources;
  /** The portable render contract: declared geometry and its resource linkage; absent means synthetic-quad. */
  readonly render?: TechniqueRenderDeclaration<GeometryResourceNames<Resources>>;
  /**
   * Opt-in glyph-origin metadata: names the declared f32 buffer whose first two
   * lanes carry the glyph's position. Renderers that augment glyph origins
   * (animation retargeting) consult this instead of assuming a layout;
   * techniques without it are never augmented.
   *
   * The lanes are deliberately NOT required to be in any particular space. All
   * three shipping techniques differ: MSDF and Slug pack the ink box's top-left
   * corner, and Bitmap stores the origin plus the baked strike's raster bearing.
   * An augmenting renderer works in displacement from the rest value the plan
   * wrote, which is space-independent, so no technique has to describe its
   * packing to be animatable.
   */
  readonly glyphOrigin?: { readonly buffer: GlyphOriginBufferNames<Buffers> };
}

export interface TechniqueSchema<
  Buffers extends PolicyBufferDeclarations = PolicyBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
  Resources extends TechniqueResourceDeclarations = NoTechniqueResources,
  TechniqueId extends string = string,
  Geometry extends TechniqueGeometryDeclaration<GeometryResourceNames<Resources>> = TechniqueGeometryDeclaration<
    GeometryResourceNames<Resources>
  >,
> extends TechniqueSchemaDeclaration<Buffers, Binding, Resources, TechniqueId> {
  readonly resources: Resources;
  readonly render: TechniqueRenderDeclaration<GeometryResourceNames<Resources>> & { readonly geometry: Geometry };
  readonly [techniqueSchemaBrand]: true;
}

/** Runtime-erased schema shape used only where exact authoring types are unavailable. */
export interface AnyTechniqueSchema {
  readonly technique: string;
  readonly scope: 'glyph' | 'strike' | 'resource';
  readonly binding: TechniqueBindingDeclaration;
  readonly buffers: PolicyBufferDeclarations;
  readonly resources: TechniqueResourceDeclarations;
  readonly render: TechniqueRenderDeclaration;
  readonly glyphOrigin?: { readonly buffer: string };
  readonly [techniqueSchemaBrand]: true;
}

export function isTechniqueSchema(value: unknown): value is AnyTechniqueSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.isFrozen(value) &&
    techniqueSchemaInstances.has(value)
  );
}

/** Validate and freeze one technique's authoritative schema. */
export function defineTechniqueSchema<
  const TechniqueId extends RasterTechniqueId | string,
  const Buffers extends PolicyBufferDeclarations,
  const Binding extends TechniqueBindingDeclaration,
  const Resources = NoTechniqueResources,
  const Geometry extends TechniqueGeometryDeclaration<
    GeometryResourceNames<Resources extends TechniqueResourceDeclarations ? Resources : NoTechniqueResources>
  > = { readonly kind: 'synthetic-quad' },
>(
  declaration: Omit<
    TechniqueSchemaDeclaration<Buffers, Binding, TechniqueResourceDeclarations, TechniqueId>,
    'resources' | 'render'
  > & {
    readonly buffers: '' extends keyof Buffers ? never : Buffers;
    readonly resources?: Resources extends TechniqueResourceDeclarations
      ? '' extends keyof Resources
        ? never
        : Resources
      : never;
    readonly render?: TechniqueRenderDeclaration<
      GeometryResourceNames<Resources extends TechniqueResourceDeclarations ? Resources : NoTechniqueResources>
    > & { readonly geometry: Geometry };
  },
): TechniqueSchema<
  Buffers,
  Binding,
  Resources extends TechniqueResourceDeclarations ? Resources : NoTechniqueResources,
  TechniqueId,
  Geometry
> {
  // Read every input property exactly once into owned structures, validate the
  // owned data, then freeze and return the copy. Caller input is never mutated
  // or frozen — a rejected declaration leaves it exactly as passed — and only
  // the declared fields are carried, so no foreign reachable state survives.
  if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
    throw new TypeError('technique schemas need a declaration object');
  }
  const technique = declaration.technique;
  if (typeof technique !== 'string' || technique.length === 0)
    throw new TypeError('technique schemas need a wire identity');
  const scope = declaration.scope;
  if (scope !== 'glyph' && scope !== 'strike' && scope !== 'resource') {
    throw new TypeError(`technique "${technique}" needs a glyph, strike, or resource binding scope`);
  }
  const bindingDeclaration = declaration.binding;
  if (!isNonArrayObject(bindingDeclaration)) throw new TypeError(`technique "${technique}" needs a binding object`);
  const bindingF32 = copyBindingNames(bindingDeclaration.f32, technique, 'f32');
  const bindingU32 = copyBindingNames(bindingDeclaration.u32, technique, 'u32');
  const names = [...(bindingF32 ?? []), ...(bindingU32 ?? [])];
  if (new Set(names).size !== names.length) {
    throw new TypeError(`technique "${technique}" repeats a binding field name`);
  }
  const buffers = definePolicyBuffers(declaration.buffers);
  let resources: Readonly<Record<string, TechniqueResourceDeclaration>> = Object.freeze(
    Object.create(null) as Record<string, TechniqueResourceDeclaration>,
  );
  const resourceDeclarations = declaration.resources;
  if (resourceDeclarations !== undefined) {
    if (!isNonArrayObject(resourceDeclarations)) {
      throw new TypeError(`technique "${technique}" resources need a declaration object`);
    }
    const owned: Record<string, TechniqueResourceDeclaration> = Object.create(null);
    for (const [name, resource] of Object.entries(resourceDeclarations)) {
      if (name.length === 0) throw new TypeError(`technique "${technique}" resource names must not be empty`);
      owned[name] = defineResourceDeclaration(resource, name, technique);
    }
    resources = Object.freeze(owned);
  }
  let render: TechniqueRenderDeclaration = Object.freeze({ geometry: Object.freeze({ kind: 'synthetic-quad' }) });
  const renderDeclaration = declaration.render;
  if (renderDeclaration !== undefined) {
    if (typeof renderDeclaration !== 'object' || renderDeclaration === null || Array.isArray(renderDeclaration)) {
      throw new TypeError(`technique "${technique}" render declaration needs an object`);
    }
    render = Object.freeze({ geometry: defineGeometryDeclaration(renderDeclaration.geometry, technique, resources) });
  }
  let glyphOrigin: { readonly buffer: string } | undefined;
  const glyphOriginDeclaration = declaration.glyphOrigin;
  if (glyphOriginDeclaration !== undefined) {
    const bufferName = isNonArrayObject(glyphOriginDeclaration) ? glyphOriginDeclaration.buffer : undefined;
    if (typeof bufferName !== 'string') {
      throw new TypeError(`technique "${technique}" glyphOrigin needs a buffer name`);
    }
    const origin: PolicyBufferDeclaration | undefined = Object.hasOwn(buffers, bufferName)
      ? buffers[bufferName]
      : undefined;
    if (origin === undefined) {
      throw new TypeError(`technique "${technique}" points glyphOrigin at an undeclared buffer`);
    }
    if (origin.scalar !== 'f32' || origin.lanes.length < 2) {
      throw new TypeError(`technique "${technique}" needs an f32 glyphOrigin buffer with two origin lanes`);
    }
    glyphOrigin = Object.freeze({ buffer: bufferName });
  }
  const binding = Object.freeze({
    ...(bindingF32 === undefined ? {} : { f32: bindingF32 }),
    ...(bindingU32 === undefined ? {} : { u32: bindingU32 }),
    // The copies carry exactly the declared binding names read above.
  }) as Binding;
  const schema = {
    technique,
    scope,
    binding,
    buffers,
    resources,
    render,
    ...(glyphOrigin === undefined ? {} : { glyphOrigin }),
  } as unknown as TechniqueSchema<
    Buffers,
    Binding,
    Resources extends TechniqueResourceDeclarations ? Resources : NoTechniqueResources,
    TechniqueId,
    Geometry
  >;
  const frozen = Object.freeze(schema);
  techniqueSchemaInstances.add(frozen);
  return frozen;
}

/** Validate and freeze one closed portable resource declaration. */
function defineResourceDeclaration(
  resource: TechniqueResourceDeclaration,
  name: string,
  technique: string,
): TechniqueResourceDeclaration {
  // Declared input is validated defensively so plain-JavaScript authors get a
  // named diagnostic instead of an accessor failure.
  const declared = resource as Partial<TechniqueResourceDeclaration> | undefined;
  const kind = declared?.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new TypeError(`technique "${technique}" resource "${name}" needs a nonempty resource kind`);
  }
  const keys = Object.keys(resource ?? {});
  if (kind === 'buffer') {
    if (keys.some((key) => key !== 'kind')) {
      throw new TypeError(`technique "${technique}" ${kind} resource "${name}" declares only its kind`);
    }
    return Object.freeze({ kind });
  }
  if (kind === 'geometry') {
    if (keys.some((key) => key !== 'kind' && key !== 'attributes')) {
      throw new TypeError(`technique "${technique}" geometry resource "${name}" declares only kind and attributes`);
    }
    const attributes = (declared as Partial<TechniqueGeometryResourceDeclaration>).attributes;
    return Object.freeze({ kind, attributes: defineVertexInputs(attributes, name, technique) });
  }
  if (kind !== 'texture' && kind !== 'texture-array') {
    throw new TypeError(`technique "${technique}" resource "${name}" needs a portable resource kind`);
  }
  const format = (declared as { format?: unknown }).format;
  if (!isPortableTextureFormat(format)) {
    throw new TypeError(`technique "${technique}" resource "${name}" needs a supported texture format`);
  }
  if (keys.some((key) => key !== 'kind' && key !== 'format')) {
    throw new TypeError(`technique "${technique}" resource "${name}" declares only kind and format`);
  }
  return Object.freeze({ kind, format });
}

function defineVertexInputs(value: unknown, resource: string, technique: string): readonly PortableVertexInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`technique "${technique}" geometry resource "${resource}" needs vertex inputs`);
  }
  const semantics = new Set<string>();
  return Object.freeze(
    value.map((input, index) => {
      const label = `technique "${technique}" geometry resource "${resource}" input ${index}`;
      if (!isNonArrayObject(input)) throw new TypeError(`${label} needs an object`);
      if (Object.keys(input).some((key) => key !== 'semantic' && key !== 'componentType' && key !== 'components')) {
        throw new TypeError(`${label} declares only semantic, componentType, and components`);
      }
      assertPortableVertexSemantic(input.semantic, label);
      if (semantics.has(input.semantic)) throw new TypeError(`${label} repeats semantic "${input.semantic}"`);
      semantics.add(input.semantic);
      const componentType = input.componentType;
      if (
        componentType !== 'f32' &&
        componentType !== 'u32' &&
        componentType !== 'i16' &&
        componentType !== 'u16' &&
        componentType !== 'u8'
      ) {
        throw new TypeError(`${label} needs an f32, u32, i16, u16, or u8 component type`);
      }
      const components = input.components;
      if (components !== 1 && components !== 2 && components !== 3 && components !== 4) {
        throw new RangeError(`${label} needs one to four components`);
      }
      return Object.freeze({ semantic: input.semantic, componentType, components });
    }),
  );
}

/**
 * Validate and freeze the geometry declaration. `synthetic-quad` is the
 * no-resource path; every supplied kind must name a declared geometry resource
 * and state its coordinate convention.
 */
function defineGeometryDeclaration(
  geometry: TechniqueGeometryDeclaration,
  technique: string,
  resources: Readonly<Record<string, TechniqueResourceDeclaration>>,
): TechniqueGeometryDeclaration {
  const kind = geometry?.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new TypeError(`technique "${technique}" needs a nonempty render geometry kind`);
  }
  const resource = geometry.resource;
  const coordinates = geometry.coordinates;
  if (kind === 'synthetic-quad') {
    if (resource !== undefined || coordinates !== undefined) {
      throw new TypeError(
        `technique "${technique}" synthetic-quad geometry declares no resource or coordinate convention`,
      );
    }
    return Object.freeze({ kind: 'synthetic-quad' as const });
  }
  if (typeof resource !== 'string' || resource.length === 0) {
    throw new TypeError(`technique "${technique}" geometry "${kind}" needs a declared geometry resource`);
  }
  const declared = Object.hasOwn(resources, resource) ? resources[resource] : undefined;
  if (declared === undefined) {
    throw new TypeError(`technique "${technique}" points its "${kind}" geometry at undeclared resource "${resource}"`);
  }
  if (declared.kind !== 'geometry') {
    throw new TypeError(`technique "${technique}" geometry resource "${resource}" needs the geometry resource kind`);
  }
  if (coordinates !== 'unit-square' && coordinates !== 'em') {
    throw new TypeError(`technique "${technique}" geometry "${kind}" needs unit-square or em coordinates`);
  }
  if (kind === 'custom') {
    const name = geometry.name;
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError(`technique "${technique}" custom geometry needs a branded name`);
    }
    return Object.freeze({ kind, name, resource, coordinates });
  }
  if (kind !== 'quad' && kind !== 'hull') {
    throw new TypeError(`technique "${technique}" geometry needs a supported or branded custom kind`);
  }
  return Object.freeze({ kind, resource, coordinates });
}

/** Brand one extension geometry kind without widening the supplied/synthetic union. */
export function defineTechniqueGeometryKind<const Kind extends string>(
  kind: Kind extends 'synthetic-quad' | 'quad' | 'hull' | 'custom' ? never : Kind,
): TechniqueCustomGeometryKind & Kind {
  if (typeof kind !== 'string' || kind.length === 0) throw new TypeError('technique geometry kinds must not be empty');
  if (kind === 'synthetic-quad' || kind === 'quad' || kind === 'hull' || kind === 'custom') {
    throw new TypeError(`built-in geometry kind "${kind}" does not need branding`);
  }
  return kind as unknown as TechniqueCustomGeometryKind & Kind;
}

function isPortableTextureFormat(value: unknown): value is PortableTextureFormat {
  return typeof value === 'string' && portableTextureFormats.includes(value as PortableTextureFormat);
}

function copyBindingNames(value: unknown, technique: string, scalar: PolicyScalarKind): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`technique "${technique}" ${scalar} binding needs a name list`);
  const names = value.map((name, index) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError(`technique "${technique}" ${scalar} binding name ${index} needs a nonempty string`);
    }
    return name;
  });
  return Object.freeze(names);
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Derive the wire buffer list a technique's programs publish, in declaration
 * order — the schema is the only witness to ids, scalar kinds, and widths.
 */
export function schemaPolicyBuffers(schema: AnyTechniqueSchema): PolicyBuffer[] {
  const scalars = textShaperAbi.policy.scalarTypes;
  return Object.values(schema.buffers).map((buffer) => ({
    id: buffer.id,
    scalar: buffer.scalar === 'f32' ? scalars.f32 : scalars.u32,
    vectorWidth: buffer.lanes.length,
  }));
}
