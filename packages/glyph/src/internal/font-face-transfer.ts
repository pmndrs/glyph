import type { SerializedFontFace } from '../font-face-transfer.js';

/** Recognize the versioned cross-realm discriminator. */
export function isSerializedFontFace(value: unknown): value is SerializedFontFace {
  return isRecord(value) && value.kind === 'glyph-font-face' && value.version === 1;
}

/** Synchronously claim package-produced buffers without copying or revalidating their contents. */
export function claimSerializedFontFace(value: SerializedFontFace): SerializedFontFace {
  const claimed = structuredClone(value, { transfer: serializedFontFaceBuffers(value) });
  return freezeSerializedFontFace(claimed);
}

/** List every unique buffer in wire order for `postMessage` or an equivalent structured clone. */
export function serializedFontFaceBuffers(value: SerializedFontFace): ArrayBuffer[] {
  const buffers = [
    value.data,
    ...value.rasters.flatMap((raster) => (raster.data === undefined ? [] : [raster.data])),
    ...value.resources.map((resource) => resource.data),
  ];
  return [...new Set(buffers)];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
