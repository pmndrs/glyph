/// <reference lib="webworker" />

import {
  createFontBaker,
  type FontBakeCore,
  type SerializedBakeError,
} from "@pmndrs/text-font-baker";

import {
  isRuntimeBakeRequestV0,
  type RuntimeBakeFailureV0,
  type RuntimeBakeSuccessV0,
} from "./internal/runtime-bake-protocol.js";

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
let corePromise: Promise<FontBakeCore> | undefined;

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void handleMessage(event.data);
});

async function handleMessage(value: unknown): Promise<void> {
  if (!isRuntimeBakeRequestV0(value)) return;
  try {
    const core = await loadCore();
    const result = core.bake({
      source: new Uint8Array(value.source),
      descriptor: value.font,
    });
    const artifacts = result.artifacts.map((artifact) => ({
      role: artifact.role,
      id: artifact.id,
      bytes: copyToArrayBuffer(artifact.bytes),
      sha256: artifact.sha256,
    }));
    const response: RuntimeBakeSuccessV0 = {
      type: "bake-font-result-v0",
      id: value.id,
      ok: true,
      artifacts,
      report: result.report,
      warnings: result.warnings,
    };
    scope.postMessage(
      response,
      artifacts.map(({ bytes }) => bytes),
    );
  } catch (error) {
    const response: RuntimeBakeFailureV0 = {
      type: "bake-font-result-v0",
      id: value.id,
      ok: false,
      error: serializeError(error),
    };
    scope.postMessage(response);
  }
}

function loadCore(): Promise<FontBakeCore> {
  corePromise ??= fetch(new URL("./font_baker.wasm", import.meta.url))
    .then((response) => {
      if (!response.ok)
        throw new Error(`font baker Wasm request failed with HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(createFontBaker)
    .catch((error: unknown) => {
      corePromise = undefined;
      throw error;
    });
  return corePromise;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function serializeError(error: unknown): SerializedBakeError {
  if (error instanceof Error) {
    const value = error as Error & { readonly code?: unknown; readonly path?: unknown };
    return {
      code: typeof value.code === "string" ? value.code : "RUNTIME_BAKE_FAILED",
      message: value.message,
      ...(typeof value.path === "string" ? { path: value.path } : {}),
    };
  }
  return { code: "RUNTIME_BAKE_FAILED", message: String(error) };
}
