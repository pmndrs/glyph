/**
 * The single authority for a raster technique's physical shape. A schema declares —
 * once, colocated with the technique — the buffer ids, scalar kinds, and lane
 * meanings that its policy programs produce and its shader realizations consume,
 * plus the portable render contract: named resources and declared geometry.
 * Policy stores, binding compilers, plan executors, and shader interfaces all
 * derive from the declaration; none of them restate it.
 */

import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PolicyBuffer } from './render-policy.js';

export type PolicyScalarKind = 'f32' | 'u32';

export interface PolicyBufferDeclaration {
  /** Wire buffer id — nonzero, unique within the owning program. */
  readonly id: number;
  readonly scalar: PolicyScalarKind;
  /** One name per lane; the lane count is the buffer's vector width. */
  readonly lanes: readonly string[];
}

export type PolicyBufferDeclarations = Readonly<Record<string, PolicyBufferDeclaration>>;

const techniqueSchemaBrand: unique symbol = Symbol('glyph.technique-schema');

/**
 * Validate and freeze a named buffer set: nonzero unique ids, at least one lane
 * each. The result is an owned, deeply frozen copy — caller input is never
 * mutated (rejection leaves it untouched), and caller accessors are read once
 * here so they can never change a validated width afterwards.
 */
export function definePolicyBuffers<const Buffers extends PolicyBufferDeclarations>(buffers: Buffers): Buffers {
  const seen = new Set<number>();
  const owned: Record<string, PolicyBufferDeclaration> = Object.create(null);
  for (const [name, buffer] of Object.entries(buffers)) {
    const id = buffer.id;
    const scalar = buffer.scalar;
    const lanes = [...buffer.lanes];
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
}

/** Immutable sample payload; retained payloads validate as `PortableTexturePayload`. */
export interface TechniqueTextureResourceDeclaration {
  readonly kind: 'texture';
  readonly format?: string;
}

/** GLB-like geometry payload; retained payloads validate as `PortableGeometryPayload`. */
export interface TechniqueGeometryResourceDeclaration {
  readonly kind: 'geometry';
}

/** A technique-private resource kind whose retained payload stays opaque. */
export interface TechniqueOpaqueResourceDeclaration {
  readonly kind: string & {};
  readonly format?: string;
}

/**
 * One declared logical resource. The reserved kinds name the constrained
 * portable payload vocabulary; every other kind is technique-private and
 * carries only its identity and optional format.
 */
export type TechniqueResourceDeclaration =
  | TechniqueBufferResourceDeclaration
  | TechniqueTextureResourceDeclaration
  | TechniqueGeometryResourceDeclaration
  | TechniqueOpaqueResourceDeclaration;

/**
 * Portable geometry kinds, deliberately disjoint from the wire
 * `enginePrimitive` command enum (`glyph`, `decoration`, …): a wire primitive
 * is a record-span command, while this vocabulary says what geometry one draw
 * realizes. `synthetic-quad` is the implicit generated unit quad and needs no
 * resource; every other kind — `quad` today, technique kinds such as `hull`
 * later — supplies an explicit geometry resource.
 */
export type TechniqueGeometryKind = 'synthetic-quad' | 'quad' | (string & {});

/** The coordinate convention a supplied geometry's positions are authored in. */
export type TechniqueGeometryCoordinates = 'unit-square' | 'em';

export interface TechniqueGeometryDeclaration {
  readonly kind: TechniqueGeometryKind;
  /** The declared geometry resource realizing this geometry. */
  readonly resource?: string;
  /** Position convention; required for supplied geometry and meaningless for synthetic-quad. */
  readonly coordinates?: TechniqueGeometryCoordinates;
}

export interface TechniqueRenderDeclaration {
  /** The geometry this technique's draws realize. */
  readonly geometry: TechniqueGeometryDeclaration;
}

export interface TechniqueSchemaDeclaration<
  Buffers extends PolicyBufferDeclarations = PolicyBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
> {
  /** Wire identity string, e.g. `pmndrs.bitmap`. */
  readonly technique: string;
  /** Binding input scope the technique's per-glyph data arrives through. */
  readonly scope: 'glyph' | 'strike' | 'resource';
  readonly binding: Binding;
  readonly buffers: Buffers;
  readonly resources?: Readonly<Record<string, TechniqueResourceDeclaration>>;
  /** The portable render contract: declared geometry and its resource linkage; absent means synthetic-quad. */
  readonly render?: TechniqueRenderDeclaration;
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
  readonly glyphOrigin?: { readonly buffer: string };
}

export interface TechniqueSchema<
  Buffers extends PolicyBufferDeclarations = PolicyBufferDeclarations,
  Binding extends TechniqueBindingDeclaration = TechniqueBindingDeclaration,
> extends TechniqueSchemaDeclaration<Buffers, Binding> {
  readonly [techniqueSchemaBrand]: true;
}

export function isTechniqueSchema(value: unknown): value is TechniqueSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { [techniqueSchemaBrand]?: unknown })[techniqueSchemaBrand] === true
  );
}

/** Validate and freeze one technique's authoritative schema. */
export function defineTechniqueSchema<
  const Buffers extends PolicyBufferDeclarations,
  const Binding extends TechniqueBindingDeclaration,
>(declaration: TechniqueSchemaDeclaration<Buffers, Binding>): TechniqueSchema<Buffers, Binding> {
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
  const bindingF32 = declaration.binding.f32 === undefined ? undefined : Object.freeze([...declaration.binding.f32]);
  const bindingU32 = declaration.binding.u32 === undefined ? undefined : Object.freeze([...declaration.binding.u32]);
  const names = [...(bindingF32 ?? []), ...(bindingU32 ?? [])];
  if (new Set(names).size !== names.length) {
    throw new TypeError(`technique "${technique}" repeats a binding field name`);
  }
  const buffers = definePolicyBuffers(declaration.buffers);
  let resources: Readonly<Record<string, TechniqueResourceDeclaration>> | undefined;
  if (declaration.resources !== undefined) {
    const owned: Record<string, TechniqueResourceDeclaration> = Object.create(null);
    for (const [name, resource] of Object.entries(declaration.resources)) {
      owned[name] = defineResourceDeclaration(resource, name, technique);
    }
    resources = Object.freeze(owned);
  }
  let render: TechniqueRenderDeclaration | undefined;
  if (declaration.render !== undefined) {
    if (typeof declaration.render !== 'object' || declaration.render === null || Array.isArray(declaration.render)) {
      throw new TypeError(`technique "${technique}" render declaration needs an object`);
    }
    render = Object.freeze({ geometry: defineGeometryDeclaration(declaration.render.geometry, technique, resources) });
  }
  let glyphOrigin: { readonly buffer: string } | undefined;
  if (declaration.glyphOrigin !== undefined) {
    const origin: PolicyBufferDeclaration | undefined = Object.hasOwn(buffers, declaration.glyphOrigin.buffer)
      ? buffers[declaration.glyphOrigin.buffer]
      : undefined;
    if (origin === undefined) {
      throw new TypeError(`technique "${technique}" points glyphOrigin at an undeclared buffer`);
    }
    if (origin.scalar !== 'f32' || origin.lanes.length < 2) {
      throw new TypeError(`technique "${technique}" needs an f32 glyphOrigin buffer with two origin lanes`);
    }
    glyphOrigin = Object.freeze({ buffer: declaration.glyphOrigin.buffer });
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
    ...(resources === undefined ? {} : { resources }),
    ...(render === undefined ? {} : { render }),
    ...(glyphOrigin === undefined ? {} : { glyphOrigin }),
  } as TechniqueSchema<Buffers, Binding>;
  Object.defineProperty(schema, techniqueSchemaBrand, { value: true });
  return Object.freeze(schema);
}

/**
 * Validate and freeze one resource declaration. Reserved portable kinds declare
 * exactly their own fields so a typo cannot silently become metadata; private
 * kinds keep the historical kind-plus-optional-format shape.
 */
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
  if (kind === 'buffer' || kind === 'geometry') {
    if (keys.some((key) => key !== 'kind')) {
      throw new TypeError(`technique "${technique}" ${kind} resource "${name}" declares only its kind`);
    }
    return Object.freeze({ kind });
  }
  const format = (declared as { format?: unknown }).format;
  if (format !== undefined && (typeof format !== 'string' || format.length === 0)) {
    throw new TypeError(`technique "${technique}" resource "${name}" needs a nonempty format`);
  }
  if (keys.some((key) => key !== 'kind' && key !== 'format')) {
    throw new TypeError(`technique "${technique}" resource "${name}" declares only kind and format`);
  }
  return Object.freeze({ kind, ...(format === undefined ? {} : { format }) });
}

/**
 * Validate and freeze the geometry declaration. `synthetic-quad` is the
 * no-resource path; every supplied kind must name a declared geometry resource
 * and state its coordinate convention.
 */
function defineGeometryDeclaration(
  geometry: TechniqueGeometryDeclaration,
  technique: string,
  resources: Readonly<Record<string, TechniqueResourceDeclaration>> | undefined,
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
    return Object.freeze({ kind });
  }
  if (typeof resource !== 'string' || resource.length === 0) {
    throw new TypeError(`technique "${technique}" geometry "${kind}" needs a declared geometry resource`);
  }
  const declared = resources !== undefined && Object.hasOwn(resources, resource) ? resources[resource] : undefined;
  if (declared === undefined) {
    throw new TypeError(`technique "${technique}" points its "${kind}" geometry at undeclared resource "${resource}"`);
  }
  if (declared.kind !== 'geometry') {
    throw new TypeError(`technique "${technique}" geometry resource "${resource}" needs the geometry resource kind`);
  }
  if (coordinates !== 'unit-square' && coordinates !== 'em') {
    throw new TypeError(`technique "${technique}" geometry "${kind}" needs unit-square or em coordinates`);
  }
  return Object.freeze({ kind, resource, coordinates });
}

/**
 * Derive the wire buffer list a technique's programs publish, in declaration
 * order — the schema is the only witness to ids, scalar kinds, and widths.
 */
export function schemaPolicyBuffers(schema: TechniqueSchema): PolicyBuffer[] {
  const scalars = textShaperAbi.policy.scalarTypes;
  return Object.values(schema.buffers).map((buffer) => ({
    id: buffer.id,
    scalar: buffer.scalar === 'f32' ? scalars.f32 : scalars.u32,
    vectorWidth: buffer.lanes.length,
  }));
}
