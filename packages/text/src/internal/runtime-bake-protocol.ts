import type { FontBakeDescriptorV0, SerializedBakeError } from '@pmndrs/text-font-baker';

export interface RuntimeBakeRequestV0 {
  readonly type: 'bake-font-v0';
  readonly id: number;
  readonly source: ArrayBuffer;
  readonly font: FontBakeDescriptorV0;
}

export interface RuntimeBakeSuccessV0 {
  readonly type: 'bake-font-result-v0';
  readonly id: number;
  readonly ok: true;
  readonly artifacts: readonly [RuntimeBakeArtifactV0];
  readonly report: unknown;
  readonly warnings: readonly unknown[];
}

export interface RuntimeBakeArtifactV0 {
  readonly role: 'font';
  readonly id: string;
  readonly bytes: ArrayBuffer;
  readonly sha256: string;
}

export interface RuntimeBakeFailureV0 {
  readonly type: 'bake-font-result-v0';
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedBakeError;
}

export type RuntimeBakeResultV0 = RuntimeBakeSuccessV0 | RuntimeBakeFailureV0;

export function isRuntimeBakeResultV0(value: unknown): value is RuntimeBakeResultV0 {
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
    value.artifacts.every(isRuntimeBakeArtifactV0) &&
    isNonArrayObject(value.report) &&
    Array.isArray(value.warnings)
  );
}

export function isRuntimeBakeRequestV0(value: unknown): value is RuntimeBakeRequestV0 {
  return (
    isNonArrayObject(value) &&
    value.type === 'bake-font-v0' &&
    isRequestId(value.id) &&
    value.source instanceof ArrayBuffer &&
    isNonArrayObject(value.font) &&
    value.font.formatVersion === 0 &&
    typeof value.font.fontFaceIndex === 'number' &&
    Number.isSafeInteger(value.font.fontFaceIndex) &&
    value.font.fontFaceIndex >= 0
  );
}

function isRuntimeBakeArtifactV0(value: unknown): value is RuntimeBakeArtifactV0 {
  return (
    isNonArrayObject(value) &&
    value.role === 'font' &&
    typeof value.id === 'string' &&
    value.bytes instanceof ArrayBuffer &&
    typeof value.sha256 === 'string'
  );
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
