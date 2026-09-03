import type { JsonValue } from '../raster.js';
import type {
  RasterFormat,
  RasterFormatId,
  RasterFormatMetadata,
  RasterFormatRequest,
  RasterFormatRequestMetadata,
} from '../config/raster-format.js';

const instances = new WeakSet<object>();
const requests = new WeakSet<object>();
const descriptors = new WeakMap<object, () => JsonValue>();
const operations = new WeakMap<object, RasterFormatOperation>();
const formats = new Set<RasterFormatMetadata>();

/** A visitor that re-enters the concrete types captured when a raster format was defined. */
export interface RasterFormatOperationVisitor<Result> {
  visit<Id extends RasterFormatId, Kind extends string, Options, Descriptor extends JsonValue, Data>(
    format: RasterFormat<Id, Kind, Options, Descriptor, Data>,
    request: RasterFormatRequest<RasterFormat<Id, Kind, Options, Descriptor, Data>>,
  ): Result;
}

/** Package-private operation closed over one authentic format selection. */
export interface RasterFormatOperation {
  readonly format: RasterFormatMetadata;
  visit<Result>(visitor: RasterFormatOperationVisitor<Result>): Result;
}

export function registerRasterFormat(
  format: RasterFormatMetadata,
  descriptor: () => JsonValue,
  operation: RasterFormatOperation,
): void {
  instances.add(format);
  descriptors.set(format, descriptor);
  operations.set(format, operation);
  formats.add(format);
}

export function isRasterFormat(value: unknown): value is RasterFormatMetadata {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && instances.has(value);
}

export function registerRasterFormatRequest(
  request: object,
  descriptor: () => JsonValue,
  operation: RasterFormatOperation,
): void {
  requests.add(request);
  descriptors.set(request, descriptor);
  operations.set(request, operation);
}

export function isRasterFormatRequest(value: unknown): value is RasterFormatRequestMetadata {
  return typeof value === 'object' && value !== null && requests.has(value);
}

/** Invoke the descriptor operation captured while a format's exact option type was known. */
export function rasterFormatDescriptor(format: RasterFormatMetadata | RasterFormatRequestMetadata): JsonValue {
  const descriptor = descriptors.get(format);
  if (descriptor === undefined) throw new TypeError('raster descriptor needs a package-defined format or request');
  return descriptor();
}

/** Return the concrete operation installed by the package-owned format/request producer. */
export function rasterFormatOperation(
  format: RasterFormatMetadata | RasterFormatRequestMetadata,
): RasterFormatOperation {
  const operation = operations.get(format);
  if (operation === undefined) throw new TypeError('raster operation needs a package-defined format or request');
  return operation;
}

export function rasterFormatForKey(key: string): RasterFormatMetadata | undefined {
  let match: RasterFormatMetadata | undefined;
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
}): RasterFormatMetadata | undefined {
  let match: RasterFormatMetadata | undefined;
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
