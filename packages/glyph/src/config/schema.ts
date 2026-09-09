/** Single authority for a Codec program family's physical shape — buffer ids, scalar kinds, lane meanings, and the portable render contract. Codec stores, binding compilers, projectors, and shader interfaces all derive from it. */

import type { RasterFormatId } from './raster-format.js';
import {
  assertPortableVertexSemantic,
  portableTextureFormats,
  type PortableTextureFormat,
  type PortableVertexInput,
} from './resources.js';
import type { CodecBuffer, CodecBufferId } from './codec.js';
import { assertGlyphId } from '../internal/glyph-id.js';

export type CodecScalarKind = 'f32' | 'u32';

export interface CodecBufferDeclaration<
  Scalar extends CodecScalarKind = CodecScalarKind,
  Lanes extends readonly string[] = readonly string[],
> {
  /** Wire buffer id — nonzero, unique within the owning program. */
  readonly id: CodecBufferId;
  readonly scalar: Scalar;
  /** One name per lane; the lane count is the buffer's vector width. */
  readonly lanes: Lanes;
}

export type CodecBufferDeclarations = Readonly<Record<string, CodecBufferDeclaration>>;

const techniqueSchemaBrand: unique symbol = Symbol('glyph.technique-schema');
const techniqueSchemaInstances = new WeakSet<object>();

/** Validates and freezes a named buffer set (nonzero unique ids, at least one lane each) into an owned, deep-frozen copy — caller input is never mutated. */
export function defineCodecBuffers<const Buffers extends CodecBufferDeclarations>(buffers: Buffers): Buffers {
  if (!isNonArrayObject(buffers)) throw new TypeError('codec buffers need a declaration object');
  const seen = new Set<number>();
  const owned: Record<string, CodecBufferDeclaration> = Object.create(null);
  for (const [name, buffer] of Object.entries(buffers)) {
    if (name.length === 0) throw new TypeError('codec buffer names must not be empty');
    const sourceLanes = isNonArrayObject(buffer) ? buffer.lanes : undefined;
    if (!Array.isArray(sourceLanes)) {
      throw new TypeError(`codec buffer "${name}" needs a declaration with named lanes`);
    }
    const id = assertGlyphId(buffer.id, 'buffer', `codec buffer "${name}" id`);
    const scalar = buffer.scalar;
    const lanes = sourceLanes.map((lane, index) => {
      if (typeof lane !== 'string' || lane.length === 0) {
        throw new TypeError(`codec buffer "${name}" lane ${index} needs a nonempty name`);
      }
      return lane;
    });
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffff) {
      throw new RangeError(`codec buffer "${name}" needs a nonzero u16 id`);
    }
    if (seen.has(id)) throw new TypeError(`codec buffer "${name}" reuses id ${id}`);
    seen.add(id);
    if (scalar !== 'f32' && scalar !== 'u32') {
      throw new TypeError(`codec buffer "${name}" needs an f32 or u32 scalar kind`);
    }
    if (lanes.length === 0 || lanes.length > 4) {
      throw new RangeError(`codec buffer "${name}" needs one to four named lanes`);
    }
    if (new Set(lanes).size !== lanes.length) throw new TypeError(`codec buffer "${name}" repeats a lane name`);
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
  readonly cardinality?: 'one' | 'many';
}

/** Immutable sample payload; retained payloads validate as `PortableTexturePayload`. */
export interface TechniqueTextureResourceDeclaration {
  readonly kind: 'texture';
  readonly format: PortableTextureFormat;
  readonly cardinality?: 'one' | 'many';
}

/** Immutable layered sample payload; retained payloads validate as `PortableTextureArrayPayload`. */
export interface TechniqueTextureArrayResourceDeclaration {
  readonly kind: 'texture-array';
  readonly format: PortableTextureFormat;
  readonly cardinality?: 'one' | 'many';
}

/** GLB-like geometry payload; retained payloads validate as `PortableGeometryPayload`. */
export interface TechniqueGeometryResourceDeclaration {
  readonly kind: 'geometry';
  /** Vertex semantics and scalar shapes the technique's shader consumes. */
  readonly attributes: readonly PortableVertexInput[];
  readonly format?: never;
  readonly cardinality?: 'one';
}

export type TechniqueResourceGroupMembers = Readonly<
  Record<
    string,
    TechniqueBufferResourceDeclaration | TechniqueTextureResourceDeclaration | TechniqueTextureArrayResourceDeclaration
  >
>;

/** Fixed named leaf payloads selected and realized as one logical resource. */
export interface TechniqueResourceGroupDeclaration {
  readonly kind: 'group';
  readonly members: TechniqueResourceGroupMembers;
  readonly cardinality?: 'one' | 'many';
}

/** One declared logical resource from the constrained portable payload vocabulary — renderer-specific or opaque payloads cannot cross this boundary. */
export type TechniqueResourceDeclaration =
  | TechniqueBufferResourceDeclaration
  | TechniqueTextureResourceDeclaration
  | TechniqueTextureArrayResourceDeclaration
  | TechniqueGeometryResourceDeclaration
  | TechniqueResourceGroupDeclaration;

export type TechniqueResourceDeclarations = Readonly<Record<string, TechniqueResourceDeclaration>>;
type NoTechniqueResources = Readonly<Record<never, never>>;

/** Portable geometry kinds, deliberately disjoint from the wire `enginePrimitive` command enum. `synthetic-quad` is the implicit unit quad needing no resource; every other kind supplies an explicit geometry resource. */
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

export interface TechniqueRenderDeclaration<
  ResourceName extends string = string,
  GeometryResourceName extends string = ResourceName,
> {
  /** Logical resource role selected by each non-recordless draw. */
  readonly resource?: ResourceName;
  /** The geometry this technique's draws realize. */
  readonly geometry: TechniqueGeometryDeclaration<GeometryResourceName>;
}

type GeometryResourceNames<Resources extends TechniqueResourceDeclarations> = string extends keyof Resources
  ? string
  : {
      [Name in keyof Resources]: Resources[Name] extends TechniqueGeometryResourceDeclaration ? Name : never;
    }[keyof Resources] &
      string;

type GlyphOriginBufferNames<Buffers extends CodecBufferDeclarations> = string extends keyof Buffers
  ? string
  : {
      [Name in keyof Buffers]: Buffers[Name] extends CodecBufferDeclaration<
        'f32',
        readonly [string, string, ...string[]]
      >
        ? Name
        : never;
    }[keyof Buffers] &
      string;

export interface TechniqueSchemaDeclaration<
  Buffers extends CodecBufferDeclarations = CodecBufferDeclarations,
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
  readonly render?: TechniqueRenderDeclaration<keyof Resources & string, GeometryResourceNames<Resources>>;
  /** Opt-in glyph-origin metadata: names the f32 buffer whose first two lanes carry glyph position. Lanes need not share a space — augmenting renderers work in displacement from the Codec's rest value, so packing is space-independent. */
  readonly glyphOrigin?: { readonly buffer: GlyphOriginBufferNames<Buffers> };
}

export interface TechniqueSchema<
  Buffers extends CodecBufferDeclarations = CodecBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
  Resources extends TechniqueResourceDeclarations = NoTechniqueResources,
  TechniqueId extends string = string,
  Geometry extends TechniqueGeometryDeclaration<GeometryResourceNames<Resources>> = TechniqueGeometryDeclaration<
    GeometryResourceNames<Resources>
  >,
> extends TechniqueSchemaDeclaration<Buffers, Binding, Resources, TechniqueId> {
  readonly resources: Resources;
  readonly render: TechniqueRenderDeclaration<keyof Resources & string, GeometryResourceNames<Resources>> &
    (keyof Resources extends never
      ? { readonly resource?: never; readonly geometry: Geometry }
      : { readonly resource: keyof Resources & string; readonly geometry: Geometry });
  readonly [techniqueSchemaBrand]: true;
}

/** Renderer-neutral schema metadata retained while a generic carries the concrete declaration types. */
export interface TechniqueSchemaMetadata {
  readonly technique: string;
  readonly scope: 'glyph' | 'strike' | 'resource';
  readonly binding: TechniqueBindingDeclaration;
  readonly buffers: CodecBufferDeclarations;
  readonly resources: TechniqueResourceDeclarations;
  readonly render: TechniqueRenderDeclaration<string, string>;
  readonly glyphOrigin?: { readonly buffer: string };
  readonly [techniqueSchemaBrand]: true;
}

/** Return whether `value` is an immutable schema produced by `defineTechniqueSchema`. */
export function isTechniqueSchema(value: unknown): value is TechniqueSchemaMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.isFrozen(value) &&
    techniqueSchemaInstances.has(value)
  );
}

type DefinedTechniqueResources<Resources> = Resources extends TechniqueResourceDeclarations
  ? Resources
  : NoTechniqueResources;
/** Validate and freeze one technique's authoritative schema. */
export function defineTechniqueSchema<
  const TechniqueId extends RasterFormatId | string,
  const Buffers extends CodecBufferDeclarations,
  const Binding extends TechniqueBindingDeclaration,
  const Resources = NoTechniqueResources,
  const Geometry extends TechniqueGeometryDeclaration<GeometryResourceNames<DefinedTechniqueResources<Resources>>> = {
    readonly kind: 'synthetic-quad';
  },
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
  } & (keyof DefinedTechniqueResources<Resources> extends never
      ? {
          readonly render?: TechniqueRenderDeclaration<never, never> & { readonly geometry: Geometry };
        }
      : {
          readonly render: TechniqueRenderDeclaration<
            keyof DefinedTechniqueResources<Resources> & string,
            GeometryResourceNames<DefinedTechniqueResources<Resources>>
          > & { readonly resource: keyof DefinedTechniqueResources<Resources> & string; readonly geometry: Geometry };
        }),
): TechniqueSchema<Buffers, Binding, DefinedTechniqueResources<Resources>, TechniqueId, Geometry> {
  type DefinedResources = DefinedTechniqueResources<Resources>;
  type DefinedSchema = TechniqueSchema<Buffers, Binding, DefinedResources, TechniqueId, Geometry>;
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
  const buffers = defineCodecBuffers(declaration.buffers);
  let resources = Object.freeze(
    Object.create(null) as Record<string, TechniqueResourceDeclaration>,
  ) as DefinedResources;
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
    resources = Object.freeze(owned) as DefinedResources;
  }
  let render = Object.freeze({ geometry: Object.freeze({ kind: 'synthetic-quad' }) }) as DefinedSchema['render'];
  const renderDeclaration = declaration.render;
  if (Object.keys(resources).length !== 0 && renderDeclaration === undefined) {
    throw new TypeError(`technique "${technique}" with resources needs a declared render resource`);
  }
  if (renderDeclaration !== undefined) {
    if (typeof renderDeclaration !== 'object' || renderDeclaration === null || Array.isArray(renderDeclaration)) {
      throw new TypeError(`technique "${technique}" render declaration needs an object`);
    }
    const selectedResource = renderDeclaration.resource;
    if (Object.keys(resources).length !== 0 && selectedResource === undefined) {
      throw new TypeError(`technique "${technique}" with resources needs a declared render resource`);
    }
    if (
      selectedResource !== undefined &&
      (typeof selectedResource !== 'string' || !Object.hasOwn(resources, selectedResource))
    ) {
      throw new TypeError(`technique "${technique}" render resource must name a declared resource`);
    }
    const repeatedResources = Object.entries(resources)
      .filter(([, resource]) => resource.cardinality === 'many')
      .map(([name]) => name);
    if (repeatedResources.length > 1) {
      throw new TypeError(`technique "${technique}" may declare only one repeated resource role`);
    }
    if (repeatedResources.length === 1 && selectedResource !== repeatedResources[0]) {
      throw new TypeError(`technique "${technique}" must select its repeated resource as the render resource`);
    }
    render = Object.freeze({
      ...(selectedResource === undefined ? {} : { resource: selectedResource }),
      geometry: defineGeometryDeclaration(renderDeclaration.geometry, technique, resources),
    }) as DefinedSchema['render'];
  }
  let glyphOrigin: DefinedSchema['glyphOrigin'];
  const glyphOriginDeclaration = declaration.glyphOrigin;
  if (glyphOriginDeclaration !== undefined) {
    const bufferName = isNonArrayObject(glyphOriginDeclaration) ? glyphOriginDeclaration.buffer : undefined;
    if (typeof bufferName !== 'string') {
      throw new TypeError(`technique "${technique}" glyphOrigin needs a buffer name`);
    }
    const origin: CodecBufferDeclaration | undefined = Object.hasOwn(buffers, bufferName)
      ? buffers[bufferName]
      : undefined;
    if (origin === undefined) {
      throw new TypeError(`technique "${technique}" points glyphOrigin at an undeclared buffer`);
    }
    if (origin.scalar !== 'f32' || origin.lanes.length < 2) {
      throw new TypeError(`technique "${technique}" needs an f32 glyphOrigin buffer with two origin lanes`);
    }
    glyphOrigin = Object.freeze({ buffer: bufferName }) as DefinedSchema['glyphOrigin'];
  }
  const binding = Object.freeze({
    ...(bindingF32 === undefined ? {} : { f32: bindingF32 }),
    ...(bindingU32 === undefined ? {} : { u32: bindingU32 }),
    // The copies carry exactly the declared binding names read above.
  }) as Binding;
  const schema: DefinedSchema = {
    [techniqueSchemaBrand]: true as const,
    technique,
    scope,
    binding,
    buffers,
    resources,
    render,
    ...(glyphOrigin === undefined ? {} : { glyphOrigin }),
  };
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
  const cardinality = declared?.cardinality ?? 'one';
  if (cardinality !== 'one' && cardinality !== 'many') {
    throw new TypeError(`technique "${technique}" resource "${name}" needs one or many cardinality`);
  }
  if (kind === 'buffer') {
    if (keys.some((key) => key !== 'kind' && key !== 'cardinality')) {
      throw new TypeError(`technique "${technique}" ${kind} resource "${name}" declares kind and cardinality only`);
    }
    return Object.freeze({ kind, ...(cardinality === 'many' ? { cardinality } : {}) });
  }
  if (kind === 'geometry') {
    if (cardinality !== 'one') {
      throw new TypeError(`technique "${technique}" geometry resource "${name}" must have one cardinality`);
    }
    if (keys.some((key) => key !== 'kind' && key !== 'attributes' && key !== 'cardinality')) {
      throw new TypeError(
        `technique "${technique}" geometry resource "${name}" declares kind, attributes, and cardinality only`,
      );
    }
    const attributes = (declared as Partial<TechniqueGeometryResourceDeclaration>).attributes;
    return Object.freeze({ kind, attributes: defineVertexInputs(attributes, name, technique) });
  }
  if (kind === 'group') {
    if (keys.some((key) => key !== 'kind' && key !== 'members' && key !== 'cardinality')) {
      throw new TypeError(
        `technique "${technique}" group resource "${name}" declares kind, members, and cardinality only`,
      );
    }
    const members = (declared as Partial<TechniqueResourceGroupDeclaration>).members;
    if (!isNonArrayObject(members) || Object.keys(members).length === 0) {
      throw new TypeError(`technique "${technique}" group resource "${name}" needs named members`);
    }
    const owned: Record<string, TechniqueResourceGroupMembers[string]> = Object.create(null);
    for (const [memberName, member] of Object.entries(members)) {
      if (memberName.length === 0) {
        throw new TypeError(`technique "${technique}" group resource "${name}" has an empty member name`);
      }
      const memberKind: unknown = isNonArrayObject(member) ? (member as Record<PropertyKey, unknown>).kind : undefined;
      if (
        !isNonArrayObject(member) ||
        member.cardinality === 'many' ||
        memberKind === 'geometry' ||
        memberKind === 'group'
      ) {
        throw new TypeError(`technique "${technique}" group resource "${name}.${memberName}" needs one leaf payload`);
      }
      const normalized = defineResourceDeclaration(
        member as TechniqueResourceDeclaration,
        `${name}.${memberName}`,
        technique,
      );
      if (normalized.kind === 'geometry' || normalized.kind === 'group') {
        throw new TypeError(`technique "${technique}" group resource "${name}.${memberName}" needs one leaf payload`);
      }
      owned[memberName] = normalized;
    }
    return Object.freeze({ kind, members: Object.freeze(owned), ...(cardinality === 'many' ? { cardinality } : {}) });
  }
  if (kind !== 'texture' && kind !== 'texture-array') {
    throw new TypeError(`technique "${technique}" resource "${name}" needs a portable resource kind`);
  }
  const format = (declared as { format?: unknown }).format;
  if (!isPortableTextureFormat(format)) {
    throw new TypeError(`technique "${technique}" resource "${name}" needs a supported texture format`);
  }
  if (keys.some((key) => key !== 'kind' && key !== 'format' && key !== 'cardinality')) {
    throw new TypeError(`technique "${technique}" resource "${name}" declares kind, format, and cardinality only`);
  }
  return Object.freeze({ kind, format, ...(cardinality === 'many' ? { cardinality } : {}) });
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

/** Validates and freezes the geometry declaration. `synthetic-quad` is the no-resource path; every supplied kind must name a declared geometry resource and its coordinate convention. */
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
  const customKind: string = kind;
  return customKind as TechniqueCustomGeometryKind & Kind;
}

function isPortableTextureFormat(value: unknown): value is PortableTextureFormat {
  return typeof value === 'string' && portableTextureFormats.includes(value as PortableTextureFormat);
}

function copyBindingNames(value: unknown, technique: string, scalar: CodecScalarKind): readonly string[] | undefined {
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

/** Derives the wire buffer list a technique's programs publish, in declaration order — the schema is the only witness to ids, scalar kinds, and widths. */
export function schemaCodecBuffers<const Schema extends TechniqueSchemaMetadata>(schema: Schema): CodecBuffer[] {
  return Object.values(schema.buffers).map((buffer) => ({
    id: buffer.id,
    scalar: buffer.scalar,
    vectorWidth: buffer.lanes.length,
  }));
}
