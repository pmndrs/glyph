import type {
  FontBakeDescriptorV0,
  FontBakeResultV0,
  SerializedBakeError,
} from "@pmndrs/text-font-baker";

export interface RuntimeBakeRequestV0 {
  readonly type: "bake-font-v0";
  readonly id: number;
  readonly source: ArrayBuffer;
  readonly font: FontBakeDescriptorV0;
}

export interface RuntimeBakeSuccessV0 {
  readonly type: "bake-font-result-v0";
  readonly id: number;
  readonly ok: true;
  readonly artifacts: readonly RuntimeBakeArtifactV0[];
  readonly report: FontBakeResultV0["report"];
  readonly warnings: FontBakeResultV0["warnings"];
}

export interface RuntimeBakeArtifactV0 {
  readonly role: "font";
  readonly id: string;
  readonly bytes: ArrayBuffer;
  readonly sha256: string;
}

export interface RuntimeBakeFailureV0 {
  readonly type: "bake-font-result-v0";
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedBakeError;
}

export type RuntimeBakeResultV0 = RuntimeBakeSuccessV0 | RuntimeBakeFailureV0;

export function isRuntimeBakeResultV0(value: unknown): value is RuntimeBakeResultV0 {
  if (!isRecord(value) || value.type !== "bake-font-result-v0" || !isRequestId(value.id)) {
    return false;
  }
  if (value.ok === false) {
    return (
      isRecord(value.error) &&
      typeof value.error.code === "string" &&
      typeof value.error.message === "string" &&
      (value.error.path === undefined || typeof value.error.path === "string")
    );
  }
  return (
    value.ok === true &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isRuntimeBakeArtifactV0) &&
    isRecord(value.report) &&
    Array.isArray(value.warnings)
  );
}

export function isRuntimeBakeRequestV0(value: unknown): value is RuntimeBakeRequestV0 {
  return (
    isRecord(value) &&
    value.type === "bake-font-v0" &&
    isRequestId(value.id) &&
    value.source instanceof ArrayBuffer &&
    isRecord(value.font) &&
    value.font.formatVersion === 0 &&
    Number.isSafeInteger(value.font.fontFaceIndex) &&
    (value.font.fontFaceIndex as number) >= 0
  );
}

function isRuntimeBakeArtifactV0(value: unknown): value is RuntimeBakeArtifactV0 {
  return (
    isRecord(value) &&
    value.role === "font" &&
    typeof value.id === "string" &&
    value.bytes instanceof ArrayBuffer &&
    typeof value.sha256 === "string"
  );
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
