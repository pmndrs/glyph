import type { AnyRasterFormat, RasterFormatRequest } from '../config/raster-format.js';

const instances = new WeakSet<object>();
const requests = new WeakSet<object>();
const formats = new Set<AnyRasterFormat>();

export function registerRasterFormat(format: AnyRasterFormat): void {
  instances.add(format);
  formats.add(format);
}

export function isRasterFormat(value: unknown): value is AnyRasterFormat {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && instances.has(value);
}

export function registerRasterFormatRequest(request: object): void {
  requests.add(request);
}

export function isRasterFormatRequest(value: unknown): value is RasterFormatRequest<AnyRasterFormat> {
  return typeof value === 'object' && value !== null && requests.has(value);
}

export function rasterFormatForKey(key: string): AnyRasterFormat | undefined {
  let match: AnyRasterFormat | undefined;
  for (const raster of formats) {
    if (raster.kind !== key && raster.id !== key) continue;
    if (match !== undefined && match !== raster) {
      throw new TypeError(`font format key ${JSON.stringify(key)} matches more than one imported raster format`);
    }
    match = raster;
  }
  return match;
}

export function rasterFormatForReference(reference: {
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
}): AnyRasterFormat | undefined {
  let match: AnyRasterFormat | undefined;
  for (const raster of formats) {
    if (
      raster.kind !== reference.kind ||
      raster.extension !== reference.extension ||
      raster.version !== reference.version
    ) {
      continue;
    }
    if (match !== undefined && match !== raster) {
      throw new TypeError(
        `raster directory entry ${JSON.stringify(reference.kind)} matches more than one imported raster format`,
      );
    }
    match = raster;
  }
  return match;
}
