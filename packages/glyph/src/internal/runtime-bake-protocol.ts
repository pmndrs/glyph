import type { FontBakeDescriptor, SerializedBakeError } from '../font-baker/index.js';
import type { Fingerprint, RasterKey } from '../identity.js';
import type { JsonValue } from '../raster.js';
import { isFingerprint } from './fingerprint.js';

export type RuntimeBakeUnicodeRange = {
  readonly start: number;
  readonly end: number;
};

/**
 * The raster kinds the runtime bake Worker embeds bakers for. This set is the
 * single routing authority: the host puts only these kinds into a Worker font
 * bake, and every other technique bakes host-side through the baker its own
 * declaration names (`technique.runtimeBaker`). The Worker's kind switch is
 * the realization of this set; its rejection of anything else guards protocol
 * violations, not routing.
 */
export const workerRasterKinds: readonly string[] = Object.freeze(['bitmap', 'msdf', 'slug']);

export type RuntimeBakeRaster = {
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly rasterKey: RasterKey;
  readonly descriptor: JsonValue;
};

export interface RuntimeBakeRequest {
  readonly type: 'bake-font-v0';
  readonly id: number;
  readonly source: ArrayBuffer;
  readonly font: FontBakeDescriptor;
  readonly cache?: { readonly expiresAt: number };
  readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
  readonly rasters?: readonly RuntimeBakeRaster[];
}

export interface RuntimeBakeSuccess {
  readonly type: 'bake-font-result-v0';
  readonly id: number;
  readonly ok: true;
  readonly artifacts: readonly [RuntimeBakeArtifact];
  readonly report: unknown;
  readonly warnings: readonly unknown[];
}

export interface RuntimeBakeArtifact {
  readonly role: 'font';
  readonly id: string;
  readonly bytes: ArrayBuffer;
  readonly fingerprint: Fingerprint;
}

export interface RuntimeBakeFailure {
  readonly type: 'bake-font-result-v0';
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedBakeError;
}

export type RuntimeBakeResult = RuntimeBakeSuccess | RuntimeBakeFailure;

export function isRuntimeBakeResult(value: unknown): value is RuntimeBakeResult {
  if (!isNonArrayObject(value) || value.type !== 'bake-font-result-v0' || !isRequestId(value.id)) {
    return false;
  }
  if (value.ok === false) {
    return (
      isNonArrayObject(value.error) &&
      typeof value.error.code === 'string' &&
      typeof value.error.message === 'string' &&
      (value.error.path === undefined || typeof value.error.path === 'string')
    );
  }
  return (
    value.ok === true &&
    Array.isArray(value.artifacts) &&
    value.artifacts.length === 1 &&
    value.artifacts.every(isRuntimeBakeArtifact) &&
    isNonArrayObject(value.report) &&
    Array.isArray(value.warnings)
  );
}

export function isRuntimeBakeRequest(value: unknown): value is RuntimeBakeRequest {
  return (
    isNonArrayObject(value) &&
    value.type === 'bake-font-v0' &&
    isRequestId(value.id) &&
    value.source instanceof ArrayBuffer &&
    isNonArrayObject(value.font) &&
    value.font.formatVersion === 0 &&
    typeof value.font.fontFaceIndex === 'number' &&
    Number.isSafeInteger(value.font.fontFaceIndex) &&
    value.font.fontFaceIndex >= 0 &&
    (value.cache === undefined ||
      (isNonArrayObject(value.cache) &&
        Number.isSafeInteger(value.cache.expiresAt) &&
        (value.cache.expiresAt as number) > 0)) &&
    (value.unicodeRanges === undefined || isUnicodeRanges(value.unicodeRanges)) &&
    (value.rasters === undefined || isRasters(value.rasters))
  );
}

function isUnicodeRanges(value: unknown): value is readonly RuntimeBakeUnicodeRange[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value.every(
      (range) =>
        isNonArrayObject(range) &&
        Number.isSafeInteger(range.start) &&
        Number.isSafeInteger(range.end) &&
        (range.start as number) >= 0 &&
        (range.start as number) <= (range.end as number) &&
        (range.end as number) <= 0x10ffff,
    )
  );
}

function isRasters(value: unknown): value is readonly RuntimeBakeRaster[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(
      (raster) =>
        isNonArrayObject(raster) &&
        typeof raster.kind === 'string' &&
        raster.kind.length > 0 &&
        typeof raster.extension === 'string' &&
        raster.extension.length > 0 &&
        Number.isSafeInteger(raster.version) &&
        (raster.version as number) >= 0 &&
        typeof raster.rasterKey === 'string' &&
        isFingerprint(raster.rasterKey) &&
        isJsonValue(raster.descriptor),
    )
  );
}

function isJsonValue(value: unknown, seen = new Set<object>(), depth = 0): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth >= 32 || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.length <= 4_096 && value.every((child) => isJsonValue(child, seen, depth + 1))
    : Object.keys(value).length <= 256 && Object.values(value).every((child) => isJsonValue(child, seen, depth + 1));
  seen.delete(value);
  return valid;
}

function isRuntimeBakeArtifact(value: unknown): value is RuntimeBakeArtifact {
  return (
    isNonArrayObject(value) &&
    value.role === 'font' &&
    typeof value.id === 'string' &&
    value.bytes instanceof ArrayBuffer &&
    isFingerprint(value.fingerprint)
  );
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
