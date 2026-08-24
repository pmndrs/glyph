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
export const portableResourceKinds: readonly ['buffer', 'texture', 'texture-array', 'geometry'] = Object.freeze([
  'buffer',
  'texture',
  'texture-array',
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

/** Immutable layered sample payload for array-texture techniques. */
export interface PortableTextureArrayPayload {
  readonly kind: 'texture-array';
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
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
export type PortableResource =
  | PortableBufferPayload
  | PortableTexturePayload
  | PortableTextureArrayPayload
  | PortableGeometryPayload;

type PortableResourceKind = PortableResource['kind'];

/**
 * Validate one caller-owned payload against its declared resource kind. This is
 * structural validation only; `retain` is the ownership boundary that copies it.
 */
export function assertPortableResource(kind: string, name: string, payload: unknown, declaredFormat?: string): void {
  if (kind === 'buffer') return assertPortableBuffer(name, payload);
  if (kind === 'texture' || kind === 'texture-array') return assertPortableTexture(kind, name, payload, declaredFormat);
  if (kind === 'geometry') return assertPortableGeometry(name, payload);
}

/** Validate and own a reserved payload before it enters a compiled font result. */
export function normalizePortableResource(
  kind: string,
  name: string,
  payload: unknown,
  declaredFormat?: string,
): unknown {
  if (kind === 'buffer') {
    assertPayload(payload, name, 'buffer');
    const source = payload as PortableBufferPayload;
    const bytes = source.bytes;
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`portable buffer "${name}" needs Uint8Array bytes`);
    const stride = source.stride;
    const owned = {
      kind,
      bytes: new Uint8Array(bytes),
      ...(stride === undefined ? {} : { stride }),
    };
    assertPortableResource(kind, name, owned, declaredFormat);
    return Object.freeze(owned);
  }
  if (kind === 'texture' || kind === 'texture-array') {
    assertPayload(payload, name, kind);
    const source = payload as PortableTexturePayload | PortableTextureArrayPayload;
    const bytes = source.bytes;
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`portable ${kind} "${name}" needs Uint8Array bytes`);
    const format = source.format;
    const width = source.width;
    const height = source.height;
    const layers = kind === 'texture-array' ? (source as PortableTextureArrayPayload).layers : undefined;
    const owned = {
      kind,
      format,
      width,
      height,
      ...(layers === undefined ? {} : { layers }),
      bytes: new Uint8Array(bytes),
    };
    assertPortableResource(kind, name, owned, declaredFormat);
    return Object.freeze(owned);
  }
  if (kind === 'geometry') {
    assertPayload(payload, name, 'geometry');
    const source = payload as PortableGeometryPayload;
    const bytes = source.bytes;
    const views = source.views;
    const accessors = source.accessors;
    const attributes = source.attributes;
    const indices = source.indices;
    const drawRange = source.drawRange;
    const instances = source.instances;
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`portable geometry "${name}" needs Uint8Array bytes`);
    if (!Array.isArray(views)) throw new TypeError(`portable geometry "${name}" needs at least one buffer view`);
    if (!Array.isArray(accessors)) throw new TypeError(`portable geometry "${name}" needs at least one accessor`);
    if (!Array.isArray(attributes)) throw new TypeError(`portable geometry "${name}" needs at least one attribute`);
    const ownedViews = copyGeometryViews(views, name);
    const ownedAccessors = copyGeometryAccessors(accessors, name);
    const ownedAttributes = copyGeometryAttributes(attributes, name);
    const ownedIndices = indices === undefined ? undefined : copyGeometryIndices(indices, name);
    const ownedDrawRange = drawRange === undefined ? undefined : copyGeometryDrawRange(drawRange, name);
    const ownedInstances = instances === undefined ? undefined : copyGeometryInstances(instances, name);
    const owned = {
      kind,
      topology: source.topology,
      bytes: new Uint8Array(bytes),
      views: ownedViews,
      accessors: ownedAccessors,
      attributes: ownedAttributes,
      ...(ownedIndices === undefined ? {} : { indices: ownedIndices }),
      ...(ownedDrawRange === undefined ? {} : { drawRange: ownedDrawRange }),
      ...(ownedInstances === undefined ? {} : { instances: ownedInstances }),
    };
    assertPortableResource(kind, name, owned, declaredFormat);
    return Object.freeze(owned);
  }
  return payload;
}

function copyGeometryViews(views: readonly PortableBufferView[], name: string): readonly PortableBufferView[] {
  return Object.freeze(
    views.map((view, index) => {
      if (!isNonArrayObject(view))
        throw new TypeError(`portable geometry "${name}" buffer view ${index} needs an object`);
      return Object.freeze({ offset: view.offset, length: view.length });
    }),
  );
}

function copyGeometryAccessors(accessors: readonly PortableAccessor[], name: string): readonly PortableAccessor[] {
  return Object.freeze(
    accessors.map((accessor, index) => {
      if (!isNonArrayObject(accessor))
        throw new TypeError(`portable geometry "${name}" accessor ${index} needs an object`);
      return Object.freeze({
        componentType: accessor.componentType,
        components: accessor.components,
        view: accessor.view,
        count: accessor.count,
        ...(accessor.offset === undefined ? {} : { offset: accessor.offset }),
      });
    }),
  );
}

function copyGeometryAttributes(
  attributes: readonly PortableVertexAttribute[],
  name: string,
): readonly PortableVertexAttribute[] {
  return Object.freeze(
    attributes.map((attribute, index) => {
      if (!isNonArrayObject(attribute))
        throw new TypeError(`portable geometry "${name}" attribute ${index} needs an object`);
      return Object.freeze({
        semantic: attribute.semantic,
        accessor: attribute.accessor,
        ...(attribute.rate === undefined ? {} : { rate: attribute.rate }),
      });
    }),
  );
}

function copyGeometryIndices(indices: PortableGeometryIndices, name: string): PortableGeometryIndices {
  if (!isNonArrayObject(indices)) throw new TypeError(`portable geometry "${name}" indices need an object`);
  return Object.freeze({ accessor: indices.accessor });
}

function copyGeometryDrawRange(range: PortableDrawRange, name: string): PortableDrawRange {
  if (!isNonArrayObject(range)) throw new TypeError(`portable geometry "${name}" draw range needs an object`);
  return Object.freeze({ start: range.start, count: range.count });
}

function copyGeometryInstances(instances: PortableInstances, name: string): PortableInstances {
  if (!isNonArrayObject(instances)) throw new TypeError(`portable geometry "${name}" instances need an object`);
  if (instances.source === 'records') return Object.freeze({ source: 'records' });
  if (instances.source === 'fixed') return Object.freeze({ source: 'fixed', count: instances.count });
  throw new TypeError(`portable geometry "${name}" instances need a records or fixed source`);
}

function assertPortableBuffer(name: string, payload: unknown): void {
  assertPayload(payload, name, 'buffer');
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

function assertPortableTexture(
  kind: 'texture' | 'texture-array',
  name: string,
  payload: unknown,
  declaredFormat: string | undefined,
): void {
  assertPayload(payload, name, kind);
  if (typeof payload.format !== 'string' || payload.format.length === 0) {
    throw new TypeError(`portable texture "${name}" needs a nonempty sample format`);
  }
  if (declaredFormat !== undefined && payload.format !== declaredFormat) {
    throw new TypeError(
      `portable texture "${name}" format "${payload.format}" does not match declared format "${declaredFormat}"`,
    );
  }
  for (const dimension of ['width', 'height'] as const) {
    if (!Number.isSafeInteger(payload[dimension]) || payload[dimension] < 1) {
      throw new RangeError(`portable texture "${name}" needs a positive integer ${dimension}`);
    }
  }
  const layers = (payload as Partial<PortableTextureArrayPayload>).layers;
  if (kind === 'texture-array' && (typeof layers !== 'number' || !Number.isSafeInteger(layers) || layers < 1)) {
    throw new RangeError(`portable texture-array "${name}" needs a positive integer layer count`);
  }
  if (!(payload.bytes instanceof Uint8Array)) throw new TypeError(`portable texture "${name}" needs Uint8Array bytes`);
  if (kind === 'texture-array' && (payload.bytes.byteLength === 0 || payload.bytes.byteLength % layers! !== 0)) {
    throw new RangeError(`portable texture-array "${name}" bytes must contain a nonempty whole number of layers`);
  }
}

function assertPortableGeometry(name: string, payload: unknown): void {
  assertPayload(payload, name, 'geometry');
  if (!isTopology(payload.topology)) {
    throw new TypeError(`portable geometry "${name}" needs a triangle-list or triangle-strip topology`);
  }
  if (!(payload.bytes instanceof Uint8Array)) throw new TypeError(`portable geometry "${name}" needs Uint8Array bytes`);
  assertGeometryViews(payload.views, payload.bytes.byteLength, name);
  const accessors = assertGeometryAccessors(payload.accessors, payload.views, name);
  const { vertexCount, instanceElementCount } = assertGeometryAttributes(payload.attributes, accessors, name);
  const indexCount =
    payload.indices === undefined
      ? undefined
      : assertGeometryIndices(payload.indices, accessors, payload.bytes, payload.views, vertexCount, name);
  assertGeometryDrawRange(
    payload.drawRange ?? { start: 0, count: indexCount ?? vertexCount },
    indexCount ?? vertexCount,
    name,
    indexCount !== undefined,
    payload.topology,
  );
  if (payload.instances !== undefined) assertGeometryInstances(payload.instances, instanceElementCount, name);
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
    if (!isNonArrayObject(accessor)) throw new TypeError(`${label} needs an accessor object`);
    if (!Object.hasOwn(componentSizes, accessor.componentType)) {
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
    const absoluteOffset = views[accessor.view]!.offset + offset;
    if (absoluteOffset % size !== 0) {
      throw new RangeError(`${label} absolute byte offset ${absoluteOffset} is not aligned to ${size} bytes`);
    }
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
): { vertexCount: number; instanceElementCount: number | undefined } {
  if (!isPortableList<PortableVertexAttribute>(attributes) || attributes.length === 0) {
    throw new TypeError(`portable geometry "${name}" needs at least one attribute`);
  }
  let positionSeen = false;
  let vertexCount: number | undefined;
  let instanceElementCount: number | undefined;
  const semantics = new Set<string>();
  attributes.forEach((attribute, index) => {
    const label = `portable geometry "${name}" attribute ${index}`;
    if (!isNonArrayObject(attribute)) throw new TypeError(`${label} needs an attribute object`);
    if (typeof attribute.semantic !== 'string' || attribute.semantic.length === 0) {
      throw new TypeError(`${label} needs a nonempty semantic name`);
    }
    if (semantics.has(attribute.semantic)) throw new TypeError(`${label} repeats semantic "${attribute.semantic}"`);
    semantics.add(attribute.semantic);
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
  return { vertexCount, instanceElementCount };
}

function assertGeometryIndices(
  indices: PortableGeometryIndices,
  accessors: readonly PortableAccessor[],
  bytes: Uint8Array,
  views: readonly PortableBufferView[],
  vertexCount: number,
  name: string,
): number {
  const label = `portable geometry "${name}" indices`;
  if (!isNonArrayObject(indices)) throw new TypeError(`${label} need an indices object`);
  if (typeof indices.accessor !== 'number' || !Number.isSafeInteger(indices.accessor)) {
    throw new TypeError(`${label} need an accessor index`);
  }
  const accessor = accessors[indices.accessor];
  if (accessor === undefined) throw new RangeError(`${label} name an accessor outside the geometry`);
  if (accessor.componentType !== 'u16' && accessor.componentType !== 'u32') {
    throw new TypeError(`${label} need a u16 or u32 integer component type`);
  }
  if (accessor.components !== 1) throw new RangeError(`${label} need scalar indices`);
  if (accessor.count < 1) throw new RangeError(`${label} need at least one index`);
  const view = views[accessor.view]!;
  const offset = view.offset + (accessor.offset ?? 0);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stride = accessor.componentType === 'u16' ? 2 : 4;
  for (let index = 0; index < accessor.count; index += 1) {
    const value =
      accessor.componentType === 'u16'
        ? data.getUint16(offset + index * stride, true)
        : data.getUint32(offset + index * stride, true);
    if (value >= vertexCount) {
      throw new RangeError(
        `${label} value ${value} at index ${index} names vertex ${value} outside ${vertexCount} vertices`,
      );
    }
  }
  return accessor.count;
}

function assertGeometryDrawRange(
  range: PortableDrawRange,
  limit: number,
  name: string,
  indexed: boolean,
  topology: PortableTopology,
): void {
  const label = `portable geometry "${name}" ${indexed ? 'index' : 'vertex'} draw range`;
  if (!isNonArrayObject(range)) throw new TypeError(`${label} needs a range object`);
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
  if (range.count < 3 || (topology === 'triangle-list' && range.count % 3 !== 0)) {
    throw new RangeError(`${label} count ${range.count} does not contain complete ${topology} primitives`);
  }
}

function assertGeometryInstances(
  instances: PortableInstances,
  instanceElementCount: number | undefined,
  name: string,
): void {
  if (!isNonArrayObject(instances)) throw new TypeError(`portable geometry \"${name}\" instances need an object`);
  if (instances.source === 'records') return;
  if (instances.source === 'fixed') {
    if (!Number.isSafeInteger(instances.count) || instances.count < 1) {
      throw new RangeError(`portable geometry "${name}" needs a positive fixed instance count`);
    }
    if (instanceElementCount !== undefined && instances.count > instanceElementCount) {
      throw new RangeError(
        `portable geometry "${name}" fixed instance count ${instances.count} exceeds ${instanceElementCount} instance elements`,
      );
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

function assertPayload<K extends PortableResourceKind>(
  value: unknown,
  name: string,
  kind: K,
): asserts value is Extract<PortableResource, { kind: K }> {
  if (!isNonArrayObject(value)) {
    throw new TypeError(`portable ${kind} resource "${name}" needs a payload object`);
  }
  if ((value as { kind?: unknown }).kind !== kind) {
    throw new TypeError(`portable ${kind} resource "${name}" declares the wrong payload kind`);
  }
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
