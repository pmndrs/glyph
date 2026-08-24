/**
 * The constrained portable resource vocabulary a compiled font may retain.
 *
 * A payload is immutable data — bytes plus the typed layout a renderer needs to
 * realize it — never a GPU object, shader-language node, or renderer callback.
 * The union is deliberately small: it describes only what the shipped techniques
 * actually retain, not a universal GPU object model. Resources declared with a
 * technique-private kind keep an opaque payload; reserved kinds are validated
 * here so a mismatched index, accessor, or draw range is rejected before any
 * device is touched.
 */

export type PortableComponentType = 'f32' | 'u32' | 'i16' | 'u16' | 'u8';

export type PortableTopology = 'triangle-list' | 'triangle-strip';

export type PortableAttributeRate = 'vertex' | 'instance';

/** Reserved portable resource kinds; every other declared kind keeps an opaque payload. */
export const portableResourceKinds: readonly ['buffer', 'texture', 'geometry'] = Object.freeze([
  'buffer',
  'texture',
  'geometry',
] as const);

export const portableTopologies: readonly ['triangle-list', 'triangle-strip'] = Object.freeze([
  'triangle-list',
  'triangle-strip',
] as const);

const componentSizes: Readonly<Record<PortableComponentType, number>> = Object.freeze({
  f32: 4,
  u32: 4,
  i16: 2,
  u16: 2,
  u8: 1,
});

/** One contiguous slice of a geometry payload's immutable bytes. */
export interface PortableBufferView {
  readonly offset: number;
  readonly length: number;
}

/**
 * One typed element stream over a buffer view: `count` elements of
 * `components` scalars each, starting `offset` bytes into the view.
 */
export interface PortableAccessor {
  readonly componentType: PortableComponentType;
  readonly components: number;
  readonly view: number;
  readonly count: number;
  readonly offset?: number;
}

/** One named vertex or instance input bound to an accessor. */
export interface PortableVertexAttribute {
  readonly semantic: string;
  readonly accessor: number;
  /** Instance-rate attributes read one element per drawn instance; vertex rate is the default. */
  readonly rate?: PortableAttributeRate;
}

export interface PortableGeometryIndices {
  readonly accessor: number;
}

/** Subrange of the indexed or vertex stream one draw covers. */
export interface PortableDrawRange {
  readonly start: number;
  readonly count: number;
}

/**
 * Where one draw's instance count comes from. Records supply it by default —
 * the retained record count drives instancing exactly as for the implicit
 * synthetic quad; a fixed count decouples the draw from record addressing.
 */
export type PortableInstances = { readonly source: 'records' } | { readonly source: 'fixed'; readonly count: number };

/** Immutable byte payload with an optional fixed-width record layout. */
export interface PortableBufferPayload {
  readonly kind: 'buffer';
  readonly bytes: Uint8Array;
  /** Record width in bytes; when present the byte length must be whole records. */
  readonly stride?: number;
}

/** Immutable sample payload with its sample format and dimensions. */
export interface PortableTexturePayload {
  readonly kind: 'texture';
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/**
 * GLB-like geometry: immutable bytes plus typed accessors and semantic
 * attributes over internal buffer views, optional indices, topology, draw
 * range, and instance addressing — never a renderer geometry object.
 */
export interface PortableGeometryPayload {
  readonly kind: 'geometry';
  readonly topology: PortableTopology;
  readonly bytes: Uint8Array;
  readonly views: readonly PortableBufferView[];
  readonly accessors: readonly PortableAccessor[];
  readonly attributes: readonly PortableVertexAttribute[];
  readonly indices?: PortableGeometryIndices;
  readonly drawRange?: PortableDrawRange;
  readonly instances?: PortableInstances;
}

/** The constrained payloads a technique may retain under a reserved resource kind. */
export type PortableResource = PortableBufferPayload | PortableTexturePayload | PortableGeometryPayload;

type PortableResourceKind = PortableResource['kind'];

/**
 * Validate one retained payload against its declared resource kind. Reserved
 * kinds must carry the matching portable payload; technique-private kinds stay
 * opaque. Throws TypeError for structural violations and RangeError for numeric
 * ones, naming the resource and the offending part.
 */
export function assertPortableResource(kind: string, name: string, payload: unknown): void {
  if (kind === 'buffer') return assertPortableBuffer(name, payload);
  if (kind === 'texture') return assertPortableTexture(name, payload);
  if (kind === 'geometry') return assertPortableGeometry(name, payload);
}

function assertPortableBuffer(name: string, payload: unknown): void {
  if (!isPayload(payload, name, 'buffer')) return;
  if (!(payload.bytes instanceof Uint8Array)) throw new TypeError(`portable buffer "${name}" needs Uint8Array bytes`);
  const stride = payload.stride;
  if (stride !== undefined) {
    if (!Number.isSafeInteger(stride) || stride < 1) {
      throw new RangeError(`portable buffer "${name}" needs a positive record stride`);
    }
    if (payload.bytes.byteLength % stride !== 0) {
      throw new RangeError(
        `portable buffer "${name}" byte length ${payload.bytes.byteLength} is not whole ${stride}-byte records`,
      );
    }
  }
}

function assertPortableTexture(name: string, payload: unknown): void {
  if (!isPayload(payload, name, 'texture')) return;
  if (typeof payload.format !== 'string' || payload.format.length === 0) {
    throw new TypeError(`portable texture "${name}" needs a nonempty sample format`);
  }
  for (const dimension of ['width', 'height'] as const) {
    if (!Number.isSafeInteger(payload[dimension]) || payload[dimension] < 1) {
      throw new RangeError(`portable texture "${name}" needs a positive integer ${dimension}`);
    }
  }
  if (!(payload.bytes instanceof Uint8Array)) throw new TypeError(`portable texture "${name}" needs Uint8Array bytes`);
}

function assertPortableGeometry(name: string, payload: unknown): void {
  if (!isPayload(payload, name, 'geometry')) return;
  if (!isTopology(payload.topology)) {
    throw new TypeError(`portable geometry "${name}" needs a triangle-list or triangle-strip topology`);
  }
  if (!(payload.bytes instanceof Uint8Array)) throw new TypeError(`portable geometry "${name}" needs Uint8Array bytes`);
  assertGeometryViews(payload.views, payload.bytes.byteLength, name);
  const accessors = assertGeometryAccessors(payload.accessors, payload.views, name);
  let indexCount: number | undefined;
  if (payload.indices !== undefined) indexCount = assertGeometryIndices(payload.indices, accessors, name);
  const vertexCount = assertGeometryAttributes(payload.attributes, accessors, name);
  if (payload.drawRange !== undefined) {
    assertGeometryDrawRange(payload.drawRange, indexCount ?? vertexCount, name, indexCount !== undefined);
  }
  if (payload.instances !== undefined) assertGeometryInstances(payload.instances, name);
}

function isTopology(value: unknown): value is PortableTopology {
  return value === 'triangle-list' || value === 'triangle-strip';
}

/**
 * Array.isArray without collapsing a typed readonly array's element type to
 * `any`: the built-in guard narrows through a mutable `any[]`, which erases
 * declared payload types this module still needs.
 */
function isPortableList<T>(value: unknown): value is readonly T[] {
  return Array.isArray(value);
}

function assertGeometryViews(views: readonly PortableBufferView[], byteLength: number, name: string): void {
  if (!isPortableList<PortableBufferView>(views) || views.length === 0) {
    throw new TypeError(`portable geometry "${name}" needs at least one buffer view`);
  }
  views.forEach((view, index) => {
    if (typeof view?.offset !== 'number' || !Number.isSafeInteger(view.offset) || view.offset < 0) {
      throw new RangeError(`portable geometry "${name}" buffer view ${index} needs a nonnegative byte offset`);
    }
    if (typeof view.length !== 'number' || !Number.isSafeInteger(view.length) || view.length < 0) {
      throw new RangeError(`portable geometry "${name}" buffer view ${index} needs a nonnegative byte length`);
    }
    const end = view.offset + view.length;
    if (!Number.isSafeInteger(end) || end > byteLength) {
      throw new RangeError(`portable geometry "${name}" buffer view ${index} exceeds its ${byteLength} bytes`);
    }
  });
}

function assertGeometryAccessors(
  accessors: readonly PortableAccessor[],
  views: readonly PortableBufferView[],
  name: string,
): readonly PortableAccessor[] {
  if (!isPortableList<PortableAccessor>(accessors) || accessors.length === 0) {
    throw new TypeError(`portable geometry "${name}" needs at least one accessor`);
  }
  accessors.forEach((accessor, index) => {
    const label = `portable geometry "${name}" accessor ${index}`;
    if (!isRecord(accessor)) throw new TypeError(`${label} needs an accessor object`);
    if (!(accessor.componentType in componentSizes)) {
      throw new TypeError(`${label} needs an f32, u32, i16, u16, or u8 component type`);
    }
    if (!Number.isSafeInteger(accessor.components) || accessor.components < 1 || accessor.components > 4) {
      throw new RangeError(`${label} needs one to four components`);
    }
    if (!Number.isSafeInteger(accessor.view) || accessor.view < 0 || accessor.view >= views.length) {
      throw new RangeError(`${label} names a buffer view outside the geometry`);
    }
    if (!Number.isSafeInteger(accessor.count) || accessor.count < 0) {
      throw new RangeError(`${label} needs a nonnegative element count`);
    }
    const offset = accessor.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError(`${label} needs a nonnegative byte offset`);
    const size = componentSizes[accessor.componentType];
    const span = offset + checkedSpan(accessor.count, accessor.components, size, label);
    if (span > views[accessor.view]!.length) {
      throw new RangeError(`${label} reads past its buffer view (${span} of ${views[accessor.view]!.length} bytes)`);
    }
  });
  return accessors;
}

function assertGeometryAttributes(
  attributes: readonly PortableVertexAttribute[],
  accessors: readonly PortableAccessor[],
  name: string,
): number {
  if (!isPortableList<PortableVertexAttribute>(attributes) || attributes.length === 0) {
    throw new TypeError(`portable geometry "${name}" needs at least one attribute`);
  }
  let positionSeen = false;
  let vertexCount: number | undefined;
  let instanceElementCount: number | undefined;
  attributes.forEach((attribute, index) => {
    const label = `portable geometry "${name}" attribute ${index}`;
    if (!isRecord(attribute)) throw new TypeError(`${label} needs an attribute object`);
    if (typeof attribute.semantic !== 'string' || attribute.semantic.length === 0) {
      throw new TypeError(`${label} needs a nonempty semantic name`);
    }
    if (!Number.isSafeInteger(attribute.accessor) || attribute.accessor < 0 || attribute.accessor >= accessors.length) {
      throw new RangeError(`${label} names an accessor outside the geometry`);
    }
    if (attribute.rate !== undefined && !isAttributeRate(attribute.rate)) {
      throw new TypeError(`${label} needs a vertex or instance rate`);
    }
    if (attribute.semantic === 'position') {
      positionSeen = true;
      if (attribute.rate === 'instance') throw new TypeError(`${label}: position cannot use the instance rate`);
    }
    // Vertex-rate streams address the same vertices and instance-rate streams
    // address the same instances. Mixed counts inside one group have no draw
    // meaning and are rejected before a device is touched.
    const count = accessors[attribute.accessor]!.count;
    if (attribute.rate === 'instance') {
      if (instanceElementCount === undefined) instanceElementCount = count;
      else if (instanceElementCount !== count) {
        throw new RangeError(
          `${label} disagrees with the other instance-rate accessor counts (${instanceElementCount})`,
        );
      }
    } else if (vertexCount === undefined) vertexCount = count;
    else if (vertexCount !== count) {
      throw new RangeError(`${label} disagrees with the other vertex-rate accessor counts (${vertexCount})`);
    }
  });
  if (!positionSeen) throw new TypeError(`portable geometry "${name}" needs a position attribute`);
  if (vertexCount === undefined || vertexCount < 1) {
    throw new RangeError(`portable geometry "${name}" needs at least one vertex`);
  }
  if (instanceElementCount !== undefined && instanceElementCount < 1) {
    throw new RangeError(`portable geometry "${name}" needs at least one instance element`);
  }
  return vertexCount;
}

function assertGeometryIndices(
  indices: PortableGeometryIndices,
  accessors: readonly PortableAccessor[],
  name: string,
): number {
  const label = `portable geometry "${name}" indices`;
  if (!isRecord(indices)) throw new TypeError(`${label} need an indices object`);
  if (typeof indices.accessor !== 'number' || !Number.isSafeInteger(indices.accessor)) {
    throw new TypeError(`${label} need an accessor index`);
  }
  const accessor = accessors[indices.accessor];
  if (accessor === undefined) throw new RangeError(`${label} name an accessor outside the geometry`);
  if (accessor.componentType === 'f32') throw new TypeError(`${label} need an integer component type`);
  if (accessor.components !== 1) throw new RangeError(`${label} need scalar indices`);
  if (accessor.count < 1) throw new RangeError(`${label} need at least one index`);
  return accessor.count;
}

function assertGeometryDrawRange(range: PortableDrawRange, limit: number, name: string, indexed: boolean): void {
  const label = `portable geometry "${name}" ${indexed ? 'index' : 'vertex'} draw range`;
  if (!isRecord(range)) throw new TypeError(`${label} needs a range object`);
  for (const field of ['start', 'count'] as const) {
    const value = range[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} needs a nonnegative ${field}`);
    }
  }
  if (range.count === 0) throw new RangeError(`${label} cannot be empty`);
  const end = range.start + range.count;
  if (!Number.isSafeInteger(end) || end > limit) {
    throw new RangeError(`${label} exceeds the ${limit} available ${indexed ? 'indices' : 'vertices'}`);
  }
}

function assertGeometryInstances(instances: PortableInstances, name: string): void {
  if (!isRecord(instances)) throw new TypeError(`portable geometry \"${name}\" instances need an object`);
  if (instances.source === 'records') return;
  if (instances.source === 'fixed') {
    if (!Number.isSafeInteger(instances.count) || instances.count < 1) {
      throw new RangeError(`portable geometry "${name}" needs a positive fixed instance count`);
    }
    return;
  }
  throw new TypeError(`portable geometry "${name}" instances need a records or fixed source`);
}

function isAttributeRate(value: unknown): value is PortableAttributeRate {
  return value === 'vertex' || value === 'instance';
}

function checkedSpan(count: number, components: number, size: number, label: string): number {
  const span = count * components * size;
  if (!Number.isSafeInteger(span)) throw new RangeError(`${label} exceeds a safe byte span`);
  return span;
}

function isPayload<K extends PortableResourceKind>(
  value: unknown,
  name: string,
  kind: K,
): value is Extract<PortableResource, { kind: K }> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`portable ${kind} resource "${name}" needs a payload object`);
  }
  if ((value as { kind?: unknown }).kind !== kind) {
    throw new TypeError(`portable ${kind} resource "${name}" declares the wrong payload kind`);
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
