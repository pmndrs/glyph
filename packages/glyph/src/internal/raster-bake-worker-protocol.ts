import type { RasterPayloadReport, SerializedBakeError } from '../bake.js';
import type { RasterKey, Fingerprint } from '../identity.js';
import { isFingerprint as isFingerprintValue } from './fingerprint.js';

export interface RasterBakeWorkerRequest {
  readonly type: 'bake-raster-v0';
  readonly id: number;
  readonly source: ArrayBuffer;
  readonly sourceFingerprint: Fingerprint;
  readonly fontFaceIndex: number;
  readonly glyphCount: number;
  readonly shapingFingerprint: Fingerprint;
  readonly rasterKey: RasterKey;
  readonly options: unknown;
}

export interface RasterBakeWorkerArtifact {
  readonly role: 'raster';
  readonly id: string;
  readonly bytes: ArrayBuffer;
  readonly fingerprint: Fingerprint;
}

export interface RasterBakeWorkerSuccess {
  readonly type: 'bake-raster-result-v0';
  readonly id: number;
  readonly ok: true;
  readonly rasterKey: RasterKey;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly artifacts: readonly RasterBakeWorkerArtifact[];
  readonly report: RasterPayloadReport;
}

export interface RasterBakeWorkerFailure {
  readonly type: 'bake-raster-result-v0';
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedBakeError;
}

export type RasterBakeWorkerResult = RasterBakeWorkerSuccess | RasterBakeWorkerFailure;

export function isRasterBakeWorkerRequest(value: unknown): value is RasterBakeWorkerRequest {
  return (
    isObject(value) &&
    value.type === 'bake-raster-v0' &&
    isPositiveSafeInteger(value.id) &&
    value.source instanceof ArrayBuffer &&
    isFingerprint(value.sourceFingerprint) &&
    isNonnegativeSafeInteger(value.fontFaceIndex) &&
    isPositiveSafeInteger(value.glyphCount) &&
    isFingerprint(value.shapingFingerprint) &&
    isFingerprint(value.rasterKey) &&
    Object.hasOwn(value, 'options')
  );
}

export function isRasterBakeWorkerResult(value: unknown): value is RasterBakeWorkerResult {
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
    isFingerprint(value.rasterKey) &&
    typeof value.kind === 'string' &&
    typeof value.extension === 'string' &&
    isNonnegativeSafeInteger(value.version) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact) &&
    isPayloadReport(value.report)
  );
}

function isArtifact(value: unknown): value is RasterBakeWorkerArtifact {
  return (
    isObject(value) &&
    value.role === 'raster' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.bytes instanceof ArrayBuffer &&
    isFingerprint(value.fingerprint)
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

function isFingerprint(value: unknown): value is Fingerprint {
  return isFingerprintValue(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
