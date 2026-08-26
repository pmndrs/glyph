/**
 * The constrained portable resource vocabulary a compiled font may retain.
 *
 * A payload is immutable data — bytes plus the typed layout a renderer needs to
 * realize it — never a GPU object, shader-language node, or renderer callback.
 * The union is deliberately small: it describes only what the shipped techniques
 * actually retain, not a universal GPU object model. A mismatched texture size,
 * index, accessor, or draw range is rejected before any device is touched.
 */

export type PortableComponentType = 'f32' | 'u32' | 'i16' | 'u16' | 'u8';

export type PortableTopology = 'triangle-list' | 'triangle-strip';

export type PortableTextureFormat = 'r8unorm' | 'rgba8unorm' | 'rgba16float' | 'rgba32uint' | 'r32uint';

export const portableTextureFormats: readonly PortableTextureFormat[] = Object.freeze([
  'r8unorm',
  'rgba8unorm',
  'rgba16float',
  'rgba32uint',
  'r32uint',
]);

declare const portableVertexSemanticBrand: unique symbol;

export type PortableCustomVertexSemantic = string & { readonly [portableVertexSemanticBrand]: true };

export type PortableVertexSemantic = 'position' | 'uv' | 'normal' | 'tangent' | 'color' | PortableCustomVertexSemantic;

/** Closed portable resource kinds accepted by the core compiler. */
export const portableResourceKinds: readonly ['buffer', 'texture', 'texture-array', 'geometry', 'group'] =
  Object.freeze(['buffer', 'texture', 'texture-array', 'geometry', 'group'] as const);

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

const textureBytesPerTexel: Readonly<Record<PortableTextureFormat, number>> = Object.freeze({
  r8unorm: 1,
  rgba8unorm: 4,
  rgba16float: 8,
  rgba32uint: 16,
  r32uint: 4,
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
  readonly components: 1 | 2 | 3 | 4;
  readonly view: number;
  readonly count: number;
  readonly offset?: number;
}

/** One named vertex input bound to an accessor. */
export interface PortableVertexAttribute {
  readonly semantic: PortableVertexSemantic;
  readonly accessor: number;
  /** Per-record inputs are policy buffers, never finite geometry streams. */
  readonly rate?: never;
}

/** One semantic shape a supplied-geometry technique requires from retained payloads. */
export interface PortableVertexInput {
  readonly semantic: PortableVertexSemantic;
  readonly componentType: PortableComponentType;
  readonly components: 1 | 2 | 3 | 4;
}

export interface PortableGeometryIndices {
  readonly accessor: number;
}

/** Subrange of the indexed or vertex stream one draw covers. */
export interface PortableDrawRange {
  readonly start: number;
  readonly count: number;
}

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
  readonly format: PortableTextureFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/** Immutable layered sample payload for array-texture techniques. */
export interface PortableTextureArrayPayload {
  readonly kind: 'texture-array';
  readonly format: PortableTextureFormat;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly bytes: Uint8Array;
}

/**
 * GLB-like geometry: immutable bytes plus typed accessors and semantic
 * attributes over internal buffer views, optional indices, topology, draw
 * range — never a renderer geometry object. The plan's record span is the
 * sole instance-count authority; per-record data belongs in policy buffers.
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
  /** The plan primitive's record span is the sole instance-count authority. */
  readonly instances?: never;
}

export type PortableLeafResource =
  | PortableBufferPayload
  | PortableTexturePayload
  | PortableTextureArrayPayload
  | PortableGeometryPayload;

/** One fixed set of named payloads selected together by a draw resource. */
export interface PortableResourceGroupPayload {
  readonly kind: 'group';
  readonly members: Readonly<Record<string, PortableLeafResource>>;
}

/** The constrained payloads a technique may retain under a reserved resource kind. */
export type PortableResource = PortableLeafResource | PortableResourceGroupPayload;

export type PortableResourceKind = PortableResource['kind'];

/** Brand one safe custom attribute name before it can reach a renderer object. */
export function definePortableVertexSemantic<const Semantic extends string>(
  semantic: Semantic extends 'position' | 'uv' | 'normal' | 'tangent' | 'color' ? never : Semantic,
): PortableCustomVertexSemantic & Semantic {
  assertPortableVertexSemantic(semantic, 'portable vertex semantic');
  return semantic as unknown as PortableCustomVertexSemantic & Semantic;
}

/**
 * Validate one caller-owned payload against its declared resource kind. This is
 * structural validation only; `retain` is the boundary that validates and copies reserved payloads.
 */
export function assertPortableResource(
  kind: PortableResourceKind,
  name: string,
  payload: unknown,
  declaredFormat?: PortableTextureFormat,
  declaredVertexInputs?: readonly PortableVertexInput[],
  declaredMembers?: Readonly<
    Record<
      string,
      {
        readonly kind: 'buffer' | 'texture' | 'texture-array';
        readonly format?: PortableTextureFormat;
      }
    >
  >,
): void {
  if (kind === 'buffer') return assertPortableBuffer(name, payload);
  if (kind === 'texture' || kind === 'texture-array') return assertPortableTexture(kind, name, payload, declaredFormat);
  if (kind === 'geometry') {
    assertPortableGeometry(name, payload);
    if (declaredVertexInputs !== undefined) assertGeometryVertexInputs(name, payload, declaredVertexInputs);
    return;
  }
  if (kind === 'group') return assertPortableResourceGroup(name, payload, declaredMembers);
  throw new TypeError(`portable resource kind "${kind}" is not reserved by the core contract`);
}

/** Validate a reserved payload and copy its portable bytes before compilation retains it. */
export function normalizePortableResource(
  kind: PortableResourceKind,
  name: string,
  payload: unknown,
  declaredFormat?: PortableTextureFormat,
  declaredVertexInputs?: readonly PortableVertexInput[],
  declaredMembers?: Readonly<
    Record<
      string,
      {
        readonly kind: 'buffer' | 'texture' | 'texture-array';
        readonly format?: PortableTextureFormat;
      }
    >
  >,
): PortableResource {
  if (kind === 'buffer') {
    assertPayload(payload, name, 'buffer');
    const source = payload as PortableBufferPayload;
    const bytes = source.bytes;
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`portable buffer "${name}" needs Uint8Array bytes`);
    const stride = source.stride;
    const candidate = {
      kind,
      bytes,
      ...(stride === undefined ? {} : { stride }),
    };
    assertPortableResource(kind, name, candidate, declaredFormat, declaredVertexInputs);
    return Object.freeze({ ...candidate, bytes: new Uint8Array(bytes) });
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
    const candidate = {
      kind,
      format,
      width,
      height,
      ...(layers === undefined ? {} : { layers }),
      bytes,
    };
    assertPortableResource(kind, name, candidate, declaredFormat, declaredVertexInputs);
    return Object.freeze({ ...candidate, bytes: new Uint8Array(bytes) }) as
      | PortableTexturePayload
      | PortableTextureArrayPayload;
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
    const topology = source.topology;
    if (Object.hasOwn(source, 'instances')) {
      throw new TypeError(`portable geometry "${name}" instance count comes from plan records`);
    }
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`portable geometry "${name}" needs Uint8Array bytes`);
    if (!Array.isArray(views)) throw new TypeError(`portable geometry "${name}" needs at least one buffer view`);
    if (!Array.isArray(accessors)) throw new TypeError(`portable geometry "${name}" needs at least one accessor`);
    if (!Array.isArray(attributes)) throw new TypeError(`portable geometry "${name}" needs at least one attribute`);
    const ownedViews = copyGeometryViews(views, name);
    const ownedAccessors = copyGeometryAccessors(accessors, name);
    const ownedAttributes = copyGeometryAttributes(attributes, name);
    const ownedIndices = indices === undefined ? undefined : copyGeometryIndices(indices, name);
    const ownedDrawRange = drawRange === undefined ? undefined : copyGeometryDrawRange(drawRange, name);
    const candidate = {
      kind,
      topology,
      bytes,
      views: ownedViews,
      accessors: ownedAccessors,
      attributes: ownedAttributes,
      ...(ownedIndices === undefined ? {} : { indices: ownedIndices }),
      ...(ownedDrawRange === undefined ? {} : { drawRange: ownedDrawRange }),
    };
    assertPortableResource(kind, name, candidate, declaredFormat, declaredVertexInputs);
    return Object.freeze({ ...candidate, bytes: new Uint8Array(bytes) });
  }
  if (kind === 'group') {
    assertPortableResourceGroup(name, payload, declaredMembers);
    const source = payload as PortableResourceGroupPayload;
    const members: Record<string, PortableLeafResource> = Object.create(null);
    for (const [memberName, member] of Object.entries(source.members)) {
      const declaration = declaredMembers?.[memberName];
      members[memberName] = normalizePortableResource(
        declaration?.kind ?? member.kind,
        `${name}.${memberName}`,
        member,
        declaration?.format,
      ) as PortableLeafResource;
    }
    return Object.freeze({ kind, members: Object.freeze(members) });
  }
  throw new TypeError(`portable resource kind "${kind}" is not reserved by the core contract`);
}

function assertPortableResourceGroup(
  name: string,
  payload: unknown,
  declaredMembers?: Readonly<
    Record<
      string,
      {
        readonly kind: 'buffer' | 'texture' | 'texture-array';
        readonly format?: PortableTextureFormat;
      }
    >
  >,
): asserts payload is PortableResourceGroupPayload {
  assertPayload(payload, name, 'group');
  const members = payload.members;
  if (!isNonArrayObject(members) || Object.keys(members).length === 0) {
    throw new TypeError(`portable resource group "${name}" needs named members`);
  }
  if (declaredMembers !== undefined) {
    const declaredNames = Object.keys(declaredMembers);
    const actualNames = Object.keys(members);
    if (
      declaredNames.length !== actualNames.length ||
      actualNames.some((memberName) => !Object.hasOwn(declaredMembers, memberName))
    ) {
      throw new TypeError(`portable resource group "${name}" members do not match its declaration`);
    }
  }
  for (const [memberName, member] of Object.entries(members)) {
    if (memberName.length === 0) throw new TypeError(`portable resource group "${name}" has an empty member name`);
    if (!isNonArrayObject(member)) {
      throw new TypeError(`portable resource group "${name}" member "${memberName}" needs a leaf resource`);
    }
    const memberKind: unknown = member.kind;
    if (memberKind === 'group') {
      throw new TypeError(`portable resource group "${name}" member "${memberName}" needs a leaf resource`);
    }
    const declaration = declaredMembers?.[memberName];
    if (declaration !== undefined && memberKind !== declaration.kind) {
      throw new TypeError(`portable resource group "${name}" member "${memberName}" has the wrong payload kind`);
    }
    assertPortableResource(memberKind as PortableResourceKind, `${name}.${memberName}`, member, declaration?.format);
  }
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
      if (Object.hasOwn(attribute, 'rate')) {
        throw new TypeError(`portable geometry "${name}" attribute ${index} must be vertex-rate`);
      }
      return Object.freeze({
        semantic: attribute.semantic,
        accessor: attribute.accessor,
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
  declaredFormat: PortableTextureFormat | undefined,
): void {
  assertPayload(payload, name, kind);
  if (!Object.hasOwn(textureBytesPerTexel, payload.format)) {
    throw new TypeError(`portable texture "${name}" needs a supported sample format`);
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
  const expected = checkedTextureByteLength(
    payload.width,
    payload.height,
    kind === 'texture-array' ? layers! : 1,
    textureBytesPerTexel[payload.format],
    name,
  );
  if (payload.bytes.byteLength !== expected) {
    throw new RangeError(`portable ${kind} "${name}" needs exactly ${expected} bytes; got ${payload.bytes.byteLength}`);
  }
}

function assertPortableGeometry(name: string, payload: unknown): asserts payload is PortableGeometryPayload {
  assertPayload(payload, name, 'geometry');
  if (Object.hasOwn(payload, 'instances')) {
    throw new TypeError(`portable geometry "${name}" instance count comes from plan records`);
  }
  if (!isTopology(payload.topology)) {
    throw new TypeError(`portable geometry "${name}" needs a triangle-list or triangle-strip topology`);
  }
  if (!(payload.bytes instanceof Uint8Array)) throw new TypeError(`portable geometry "${name}" needs Uint8Array bytes`);
  assertGeometryViews(payload.views, payload.bytes.byteLength, name);
  const accessors = assertGeometryAccessors(payload.accessors, payload.views, name);
  const vertexCount = assertGeometryAttributes(payload.attributes, accessors, name);
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
}

function assertGeometryVertexInputs(
  name: string,
  payload: PortableGeometryPayload,
  required: readonly PortableVertexInput[],
): void {
  const attributes = new Map(payload.attributes.map((attribute) => [attribute.semantic, attribute]));
  for (const input of required) {
    const attribute = attributes.get(input.semantic);
    if (attribute === undefined) {
      throw new TypeError(`portable geometry "${name}" omits required vertex input "${input.semantic}"`);
    }
    const accessor = payload.accessors[attribute.accessor]!;
    if (accessor.componentType !== input.componentType || accessor.components !== input.components) {
      throw new TypeError(
        `portable geometry "${name}" vertex input "${input.semantic}" needs ${input.componentType}x${input.components}`,
      );
    }
  }
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
): number {
  if (!isPortableList<PortableVertexAttribute>(attributes) || attributes.length === 0) {
    throw new TypeError(`portable geometry "${name}" needs at least one attribute`);
  }
  let positionSeen = false;
  let vertexCount: number | undefined;
  const semantics = new Set<string>();
  attributes.forEach((attribute, index) => {
    const label = `portable geometry "${name}" attribute ${index}`;
    if (!isNonArrayObject(attribute)) throw new TypeError(`${label} needs an attribute object`);
    if (Object.hasOwn(attribute, 'rate')) throw new TypeError(`${label} must be vertex-rate`);
    assertPortableVertexSemantic(attribute.semantic, label);
    if (semantics.has(attribute.semantic)) throw new TypeError(`${label} repeats semantic "${attribute.semantic}"`);
    semantics.add(attribute.semantic);
    if (!Number.isSafeInteger(attribute.accessor) || attribute.accessor < 0 || attribute.accessor >= accessors.length) {
      throw new RangeError(`${label} names an accessor outside the geometry`);
    }
    if (attribute.semantic === 'position') {
      positionSeen = true;
    }
    const count = accessors[attribute.accessor]!.count;
    if (vertexCount === undefined) vertexCount = count;
    else if (vertexCount !== count) {
      throw new RangeError(`${label} disagrees with the other vertex accessor counts (${vertexCount})`);
    }
  });
  if (!positionSeen) throw new TypeError(`portable geometry "${name}" needs a position attribute`);
  if (vertexCount === undefined || vertexCount < 1) {
    throw new RangeError(`portable geometry "${name}" needs at least one vertex`);
  }
  return vertexCount;
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

function checkedSpan(count: number, components: number, size: number, label: string): number {
  const span = count * components * size;
  if (!Number.isSafeInteger(span)) throw new RangeError(`${label} exceeds a safe byte span`);
  return span;
}

/** Reject names that cannot safely become renderer vertex-attribute keys. */
export function assertPortableVertexSemantic(value: unknown, label: string): asserts value is PortableVertexSemantic {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ||
    value === '__proto__' ||
    value === 'constructor' ||
    value === 'prototype'
  ) {
    throw new TypeError(`${label} needs a safe shader attribute name`);
  }
}

function checkedTextureByteLength(
  width: number,
  height: number,
  layers: number,
  bytesPerTexel: number,
  name: string,
): number {
  const length = width * height * layers * bytesPerTexel;
  if (!Number.isSafeInteger(length)) throw new RangeError(`portable texture "${name}" byte length exceeds a safe size`);
  return length;
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
