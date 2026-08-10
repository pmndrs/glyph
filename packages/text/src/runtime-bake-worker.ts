/// <reference lib="webworker" />

import { createFontBaker, type FontBakeCore, type SerializedBakeError } from './font-baker/index.js';
import { fontBakerWasmUrl } from './font-baker/wasm-url.js';

import { soleCoreFontArtifact } from './internal/core-bake-policy.js';
import { copyToOwnedArrayBuffer } from './internal/owned-array-buffer.js';
import {
  isRuntimeBakeRequestV0,
  type RuntimeBakeRequestV0,
  type RuntimeBakeFailureV0,
  type RuntimeBakeSuccessV0,
} from './internal/runtime-bake-protocol.js';
import { cacheSuccessfulPromise } from './internal/successful-promise-cache.js';
import { bakeProgressMessage } from './internal/bake-progress-protocol.js';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const loadCore = cacheSuccessfulPromise<FontBakeCore>(async () => {
  const response = await fetch(fontBakerWasmUrl);
  if (!response.ok) {
    throw new Error(`font baker Wasm request failed with HTTP ${response.status}`);
  }
  return createFontBaker(await response.arrayBuffer());
});
let pending = Promise.resolve();

scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!isRuntimeBakeRequestV0(value)) return;
  pending = pending.then(() => handleMessage(value));
});

async function handleMessage(value: RuntimeBakeRequestV0): Promise<void> {
  try {
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'loading', 0, 1));
    const core = await loadCore();
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'baking', 0, 1));
    const result = core.bake({
      source: new Uint8Array(value.source),
      descriptor: value.font,
    });
    const artifact = soleCoreFontArtifact(result);
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'packaging', 0, 1));
    const artifacts: RuntimeBakeSuccessV0['artifacts'] = [
      {
        role: artifact.role,
        id: artifact.id,
        bytes: copyToOwnedArrayBuffer(artifact.bytes),
        sha256: artifact.sha256,
      },
    ];
    const response: RuntimeBakeSuccessV0 = {
      type: 'bake-font-result-v0',
      id: value.id,
      ok: true,
      artifacts,
      report: result.report,
      warnings: result.warnings,
    };
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'transferring', 0, 1));
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'complete', 1, 1));
    scope.postMessage(
      response,
      artifacts.map(({ bytes }) => bytes),
    );
  } catch (error) {
    const response: RuntimeBakeFailureV0 = {
      type: 'bake-font-result-v0',
      id: value.id,
      ok: false,
      error: serializeError(error),
    };
    scope.postMessage(response);
  }
}

function serializeError(error: unknown): SerializedBakeError {
  if (error instanceof Error) {
    const value = error as Error & { readonly code?: unknown; readonly path?: unknown };
    return {
      code: typeof value.code === 'string' ? value.code : 'RUNTIME_BAKE_FAILED',
      message: value.message,
      ...(typeof value.path === 'string' ? { path: value.path } : {}),
    };
  }
  return { code: 'RUNTIME_BAKE_FAILED', message: String(error) };
}
