import type { RasterPayloadReport, SerializedBakeError } from '../bake.js';
import type { RasterKey, Sha256Hex } from '../identity.js';

export interface RasterBakeWorkerRequestV0 {
  readonly type: 'bake-raster-v0';
  readonly id: number;
  readonly source: ArrayBuffer;
  readonly fontFaceIndex: number;
  readonly glyphCount: number;
  readonly shapingHash: Sha256Hex;
  readonly rasterKey: RasterKey;
  readonly options: unknown;
}

export interface RasterBakeWorkerArtifactV0 {
  readonly role: 'raster' | 'raster-page';
  readonly id: string;
  readonly bytes: ArrayBuffer;
  readonly sha256: Sha256Hex;
}

export interface RasterBakeWorkerSuccessV0 {
  readonly type: 'bake-raster-result-v0';
  readonly id: number;
  readonly ok: true;
  readonly rasterKey: RasterKey;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly artifacts: readonly RasterBakeWorkerArtifactV0[];
  readonly report: RasterPayloadReport;
}

export interface RasterBakeWorkerFailureV0 {
  readonly type: 'bake-raster-result-v0';
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedBakeError;
}

export type RasterBakeWorkerResultV0 = RasterBakeWorkerSuccessV0 | RasterBakeWorkerFailureV0;

export function isRasterBakeWorkerRequestV0(value: unknown): value is RasterBakeWorkerRequestV0 {
  return (
    isObject(value) &&
    value.type === 'bake-raster-v0' &&
    isPositiveSafeInteger(value.id) &&
    value.source instanceof ArrayBuffer &&
    isNonnegativeSafeInteger(value.fontFaceIndex) &&
    isPositiveSafeInteger(value.glyphCount) &&
    isHash(value.shapingHash) &&
    isHash(value.rasterKey) &&
    Object.hasOwn(value, 'options')
  );
}

export function isRasterBakeWorkerResultV0(value: unknown): value is RasterBakeWorkerResultV0 {
  if (
    !isObject(value) ||
    value.type !== 'bake-raster-result-v0' ||
    !isPositiveSafeInteger(value.id) ||
    typeof value.ok !== 'boolean'
  ) {
    return false;
  }
  if (!value.ok) return isSerializedError(value.error);
  return (
    isHash(value.rasterKey) &&
    typeof value.kind === 'string' &&
    typeof value.extension === 'string' &&
    isNonnegativeSafeInteger(value.version) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact) &&
    isPayloadReport(value.report)
  );
}

function isArtifact(value: unknown): value is RasterBakeWorkerArtifactV0 {
  return (
    isObject(value) &&
    (value.role === 'raster' || value.role === 'raster-page') &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.bytes instanceof ArrayBuffer &&
    isHash(value.sha256)
  );
}

function isPayloadReport(value: unknown): value is RasterPayloadReport {
  return (
    isObject(value) &&
    isNonnegativeSafeInteger(value.metadataBytes) &&
    isNonnegativeSafeInteger(value.serializedBytes) &&
    isNonnegativeSafeInteger(value.gpuBytes) &&
    Array.isArray(value.pages) &&
    value.pages.every(
      (page) =>
        isObject(page) &&
        isPositiveSafeInteger(page.width) &&
        isPositiveSafeInteger(page.height) &&
        typeof page.format === 'string' &&
        isPositiveSafeInteger(page.gpuBytes) &&
        (page.source === 'embedded' || page.source === 'external') &&
        isPositiveSafeInteger(page.encodedBytes),
    )
  );
}

function isSerializedError(value: unknown): value is SerializedBakeError {
  return (
    isObject(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (value.path === undefined || typeof value.path === 'string')
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHash(value: unknown): value is Sha256Hex {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
