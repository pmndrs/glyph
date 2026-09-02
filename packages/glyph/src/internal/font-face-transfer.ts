import type { SerializedFontFace } from '../font-face-transfer.js';

/** Recognize the public discriminator without accepting the remaining payload on trust. */
export function isSerializedFontFace(value: unknown): value is SerializedFontFace {
  return isRecord(value) && value.kind === 'glyph-font-face';
}

/** Validate and synchronously claim every application-owned buffer without copying its bytes. */
export function claimSerializedFontFace(value: unknown): SerializedFontFace {
  const normalized = normalizeSerializedFontFace(value);
  const transfer = serializedFontFaceBuffers(normalized);
  const claimed = structuredClone(normalized, { transfer });
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

function normalizeSerializedFontFace(value: unknown): SerializedFontFace {
  if (!isRecord(value) || value.kind !== 'glyph-font-face' || value.version !== 1) {
    throw new TypeError('SerializedFontFace must use glyph-font-face version 1');
  }
  const data = requiredBuffer(value.data, 'SerializedFontFace.data');
  if (!Array.isArray(value.rasters)) throw new TypeError('SerializedFontFace.rasters must be an array');
  if (!Array.isArray(value.resources)) throw new TypeError('SerializedFontFace.resources must be an array');
  const rasters = value.rasters.map((raster, index) => {
    const path = `SerializedFontFace.rasters[${index}]`;
    if (!isRecord(raster)) throw new TypeError(`${path} must be an object`);
    if (!Array.isArray(raster.resources)) throw new TypeError(`${path}.resources must be an array`);
    const rasterData = raster.data === undefined ? undefined : requiredBuffer(raster.data, `${path}.data`);
    return {
      rasterKey: requiredString(raster.rasterKey, `${path}.rasterKey`),
      kind: requiredString(raster.kind, `${path}.kind`),
      extension: requiredString(raster.extension, `${path}.extension`),
      version: requiredInteger(raster.version, `${path}.version`, 0),
      ...(rasterData === undefined ? {} : { data: rasterData }),
      ...(raster.artifactHash === undefined
        ? {}
        : { artifactHash: requiredString(raster.artifactHash, `${path}.artifactHash`) }),
      resources: raster.resources.map((resource, resourceIndex) => {
        const resourcePath = `${path}.resources[${resourceIndex}]`;
        if (!isRecord(resource)) throw new TypeError(`${resourcePath} must be an object`);
        return {
          artifactHash: requiredString(resource.artifactHash, `${resourcePath}.artifactHash`),
          byteLength: requiredInteger(resource.byteLength, `${resourcePath}.byteLength`, 1),
        };
      }),
    };
  });
  const resources = value.resources.map((resource, index) => {
    const path = `SerializedFontFace.resources[${index}]`;
    if (!isRecord(resource)) throw new TypeError(`${path} must be an object`);
    return {
      artifactHash: requiredString(resource.artifactHash, `${path}.artifactHash`),
      byteLength: requiredInteger(resource.byteLength, `${path}.byteLength`, 1),
      data: requiredBuffer(resource.data, `${path}.data`),
    };
  });
  return {
    kind: 'glyph-font-face',
    version: 1,
    data,
    artifactHash: requiredString(value.artifactHash, 'SerializedFontFace.artifactHash'),
    rasters,
    resources,
  };
}

function requiredBuffer(value: unknown, path: string): ArrayBuffer {
  if (!(value instanceof ArrayBuffer) || value.byteLength === 0) {
    throw new TypeError(`${path} must be a nonempty, attached ArrayBuffer`);
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${path} must be a nonempty string`);
  return value;
}

function requiredInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`${path} must be a safe integer greater than or equal to ${minimum}`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
