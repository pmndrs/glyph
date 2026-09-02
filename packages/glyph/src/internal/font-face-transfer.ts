import type {
  SerializedFontFace,
  SerializedFontFaceRaster,
  SerializedFontFaceResource,
} from '../font-face-transfer.js';

/** Recognize the public discriminator without accepting the remaining payload on trust. */
export function isSerializedFontFace(value: unknown): value is SerializedFontFace {
  return isRecord(value) && value.kind === 'glyph-font-face';
}

/** Validate and synchronously claim every application-owned buffer without copying its bytes. */
export function claimSerializedFontFace(value: unknown): SerializedFontFace {
  assertSerializedFontFace(value);
  const transfer = serializedFontFaceBuffers(value);
  const claimed = structuredClone(value, { transfer }) as SerializedFontFace;
  return freezeSerializedFontFace(claimed);
}

/** List every unique buffer in wire order for `postMessage` or an equivalent structured clone. */
export function serializedFontFaceBuffers(value: SerializedFontFace): ArrayBuffer[] {
  const buffers = [
    value.data,
    ...value.rasters.flatMap((raster) => (raster.data === undefined ? [] : [raster.data])),
    ...value.resources.map((resource) => resource.data),
  ];
  if (new Set(buffers).size !== buffers.length) {
    throw new TypeError('SerializedFontFace must not alias one ArrayBuffer from multiple dependency nodes');
  }
  return buffers;
}

export function freezeSerializedFontFace(value: SerializedFontFace): SerializedFontFace {
  for (const raster of value.rasters) {
    for (const resource of raster.resources) Object.freeze(resource);
    Object.freeze(raster.resources);
    Object.freeze(raster);
  }
  for (const resource of value.resources) Object.freeze(resource);
  Object.freeze(value.rasters);
  Object.freeze(value.resources);
  return Object.freeze(value);
}

function assertSerializedFontFace(value: unknown): asserts value is SerializedFontFace {
  if (!isRecord(value) || value.kind !== 'glyph-font-face' || value.version !== 1) {
    throw new TypeError('SerializedFontFace must use glyph-font-face version 1');
  }
  exactKeys(value, ['kind', 'version', 'data', 'artifactHash', 'rasters', 'resources'], 'SerializedFontFace');
  assertBuffer(value.data, 'SerializedFontFace.data');
  assertHash(value.artifactHash, 'SerializedFontFace.artifactHash');
  if (!Array.isArray(value.rasters)) throw new TypeError('SerializedFontFace.rasters must be an array');
  const rasterKeys = new Set<string>();
  const referencedResources = new Set<string>();
  value.rasters.forEach((raster, index) => {
    assertRaster(raster, `SerializedFontFace.rasters[${index}]`, referencedResources);
    if (rasterKeys.has(raster.rasterKey)) throw new TypeError('SerializedFontFace raster keys must be unique');
    rasterKeys.add(raster.rasterKey);
  });
  if (!Array.isArray(value.resources)) throw new TypeError('SerializedFontFace.resources must be an array');
  const resourceIdentities = new Set<string>();
  value.resources.forEach((resource, index) => {
    const path = `SerializedFontFace.resources[${index}]`;
    assertResource(resource, path);
    const identity = `${resource.artifactHash}:${resource.byteLength}`;
    if (resourceIdentities.has(identity)) {
      throw new TypeError('SerializedFontFace.resources must contain unique content identities');
    }
    resourceIdentities.add(identity);
  });
  for (const identity of referencedResources) {
    if (!resourceIdentities.has(identity)) {
      throw new TypeError('SerializedFontFace raster references a missing external resource');
    }
  }
  for (const identity of resourceIdentities) {
    if (!referencedResources.has(identity)) {
      throw new TypeError('SerializedFontFace carries an external resource no raster references');
    }
  }
  serializedFontFaceBuffers(value as unknown as SerializedFontFace);
}

function assertRaster(
  value: unknown,
  path: string,
  referencedResources: Set<string>,
): asserts value is SerializedFontFaceRaster {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  exactKeys(value, ['rasterKey', 'kind', 'extension', 'version', 'data', 'artifactHash', 'resources'], path);
  nonemptyString(value.rasterKey, `${path}.rasterKey`);
  nonemptyString(value.kind, `${path}.kind`);
  nonemptyString(value.extension, `${path}.extension`);
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0) {
    throw new TypeError(`${path}.version must be a nonnegative safe integer`);
  }
  if ((value.data === undefined) !== (value.artifactHash === undefined)) {
    throw new TypeError(`${path}.data and artifactHash must either both be present or both be omitted`);
  }
  if (value.data !== undefined) assertBuffer(value.data, `${path}.data`);
  if (value.artifactHash !== undefined) assertHash(value.artifactHash, `${path}.artifactHash`);
  if (!Array.isArray(value.resources)) throw new TypeError(`${path}.resources must be an array`);
  const localResources = new Set<string>();
  value.resources.forEach((resource, index) => {
    const resourcePath = `${path}.resources[${index}]`;
    if (!isRecord(resource)) throw new TypeError(`${resourcePath} must be an object`);
    exactKeys(resource, ['artifactHash', 'byteLength'], resourcePath);
    const identity = assertResourceIdentity(resource, resourcePath);
    if (localResources.has(identity)) throw new TypeError(`${path}.resources must contain unique content identities`);
    localResources.add(identity);
    referencedResources.add(identity);
  });
}

function assertResource(value: unknown, path: string): asserts value is SerializedFontFaceResource {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  exactKeys(value, ['artifactHash', 'byteLength', 'data'], path);
  assertResourceIdentity(value, path);
  assertBuffer(value.data, `${path}.data`);
  if (value.data.byteLength !== value.byteLength) {
    throw new TypeError(`${path}.data must match its declared byteLength`);
  }
}

function assertResourceIdentity(value: unknown, path: string): string {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  assertHash(value.artifactHash, `${path}.artifactHash`);
  if (!Number.isSafeInteger(value.byteLength) || Number(value.byteLength) <= 0) {
    throw new TypeError(`${path}.byteLength must be a positive safe integer`);
  }
  return `${value.artifactHash}:${value.byteLength}`;
}

function assertBuffer(value: unknown, path: string): asserts value is ArrayBuffer {
  if (!(value instanceof ArrayBuffer) || value.byteLength === 0) {
    throw new TypeError(`${path} must be a nonempty, attached ArrayBuffer`);
  }
}

function assertHash(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 identity`);
  }
}

function nonemptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${path} must be a nonempty string`);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new TypeError(`${path} does not accept ${JSON.stringify(unknown)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
