/// <reference lib="webworker" />

import { createFontBaker, type FontBakeCore, type SerializedBakeError } from './font-baker/index.js';
import { fontBakerWasmUrl } from './font-baker/wasm-url.js';

import type { AnyRasterBakerModule } from './bake.js';
import { copyToOwnedArrayBuffer } from './internal/owned-array-buffer.js';
import { bakeFontPipeline } from './internal/font-bake-pipeline.js';
import type { ResolvedRasterBakePlan } from './internal/raster-bake-plan.js';
import { deriveRasterKey } from './internal/raster-identity.js';
import { createRuntimeFontCache, type CachedFontArtifact } from './internal/runtime-font-cache.js';
import {
  isRuntimeBakeRequestV0,
  type RuntimeBakeRasterV0,
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
    const source = new Uint8Array(value.source);
    const cache =
      value.cache === undefined || value.cache.expiresAt <= Date.now() ? undefined : createRuntimeFontCache();
    const cacheKey = await cache?.key(source, value);
    const cached = cacheKey === undefined ? undefined : await cache?.match(cacheKey);
    if (cached !== undefined) {
      scope.postMessage(bakeProgressMessage(value.id, 'font', 'complete', 1, 1));
      postSuccess(value.id, cached, { cache: 'hit' }, []);
      return;
    }
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'loading', 0, 1));
    const [core, rasters] = await Promise.all([loadCore(), resolveRasters(value.rasters ?? [])]);
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'baking', 0, 1));
    const result = await bakeFontPipeline({
      fontBaker: core,
      source,
      fontFaceIndex: value.font.fontFaceIndex,
      ...(value.unicodeRanges === undefined ? {} : { unicodeRanges: value.unicodeRanges }),
      rasters,
      onProgress(progress) {
        scope.postMessage(
          bakeProgressMessage(value.id, progress.stage, progress.phase, progress.completed, progress.total),
        );
      },
    });
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'packaging', 0, 1));
    if (result.composed.artifacts.length !== 1 || result.composed.artifacts[0]?.role !== 'font') {
      throw new Error('runtime bake must produce exactly one embedded font artifact');
    }
    const artifact = result.composed.artifacts[0];
    if (cacheKey !== undefined) await cache?.put(cacheKey, artifact, value.cache!.expiresAt);
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'transferring', 0, 1));
    scope.postMessage(bakeProgressMessage(value.id, 'font', 'complete', 1, 1));
    postSuccess(value.id, artifact, result.composed.report, result.composed.warnings);
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

function postSuccess(id: number, artifact: CachedFontArtifact, report: unknown, warnings: readonly unknown[]): void {
  const artifacts: RuntimeBakeSuccessV0['artifacts'] = [
    {
      role: 'font',
      id: artifact.id,
      bytes: copyToOwnedArrayBuffer(artifact.bytes),
      sha256: artifact.sha256,
    },
  ];
  const response: RuntimeBakeSuccessV0 = {
    type: 'bake-font-result-v0',
    id,
    ok: true,
    artifacts,
    report,
    warnings,
  };
  scope.postMessage(
    response,
    artifacts.map(({ bytes }) => bytes),
  );
}

async function resolveRasters(rasters: readonly RuntimeBakeRasterV0[]): Promise<readonly ResolvedRasterBakePlan[]> {
  return Promise.all(rasters.map(resolveRaster));
}

async function resolveRaster(raster: RuntimeBakeRasterV0): Promise<ResolvedRasterBakePlan> {
  let baker: AnyRasterBakerModule;
  switch (raster.kind) {
    case 'bitmap':
      baker = (await import('./bakers/bitmap.js')).default;
      break;
    case 'msdf':
      baker = (await import('./bakers/msdf.js')).default;
      break;
    case 'slug':
      baker = (await import('./bakers/slug.js')).default;
      break;
    default:
      throw new Error(`runtime font baker does not support raster kind ${raster.kind}`);
  }
  if (baker.extension !== raster.extension || baker.version !== raster.version) {
    throw new Error(`runtime ${raster.kind} baker identity does not match the requested technique`);
  }
  const rasterKey = await deriveRasterKey({
    descriptor: raster.descriptor,
    extension: raster.extension,
    kind: raster.kind,
    version: raster.version,
  });
  if (rasterKey !== raster.rasterKey) {
    throw new Error(`runtime ${raster.kind} descriptor does not match its raster key`);
  }
  return {
    baker,
    packaging: { artifact: 'embedded', pages: 'embedded' },
    options: undefined,
    descriptor: raster.descriptor,
    rasterKey,
  };
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
