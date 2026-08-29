/// <reference lib="webworker" />

import { createFontBaker, type FontBakeCore, type SerializedBakeError } from './font-baker/index.js';
import { fontBakerWasmUrl } from './font-baker/wasm-url.js';

import {
  BITMAP_GENERATOR_VERSION,
  canonicalizeBitmapDescriptor,
  type BitmapDescriptor,
} from './internal/bitmap-contract.js';
import { copyToOwnedArrayBuffer } from './internal/owned-array-buffer.js';
import { bakeFontPipeline } from './internal/font-bake-pipeline.js';
import { MSDF_GENERATOR_VERSION, msdfDescriptor, type MsdfDescriptor } from './internal/msdf-contract.js';
import { createResolvedRasterBakePlan, type ResolvedRasterBakePlan } from './internal/raster-bake-plan.js';
import { canonicalJson, deriveRasterKey } from './internal/raster-identity.js';
import { fingerprint128, fingerprintDomain } from './internal/fingerprint.js';
import { createRuntimeFontCache, type CachedFontArtifact } from './internal/runtime-font-cache.js';
import {
  isRuntimeBakeRequest,
  type RuntimeBakeRaster,
  type RuntimeBakeRequest,
  type RuntimeBakeFailure,
  type RuntimeBakeSuccess,
} from './internal/runtime-bake-protocol.js';
import { cacheSuccessfulPromise } from './internal/successful-promise-cache.js';
import { bakeProgressMessage } from './internal/bake-progress-protocol.js';
import { SLUG_GENERATOR_VERSION, slugDescriptor, type SlugDescriptor } from './internal/slug-contract.js';
import { normalizeRasterCoverage } from './raster-coverage.js';
import type { JsonValue } from './raster.js';

type RuntimeBakeWorkerScope = Pick<DedicatedWorkerGlobalScope, 'addEventListener' | 'postMessage'>;

const scope: RuntimeBakeWorkerScope = globalThis;
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
  if (!isRuntimeBakeRequest(value)) return;
  pending = pending.then(() => handleMessage(value));
});

async function handleMessage(value: RuntimeBakeRequest): Promise<void> {
  try {
    const source = new Uint8Array(value.source);
    const cache =
      value.cache === undefined || value.cache.expiresAt <= Date.now() ? undefined : createRuntimeFontCache();
    const cacheKey =
      cache === undefined ? undefined : cache.key(fingerprint128(source, fingerprintDomain.source), value);
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
    const response: RuntimeBakeFailure = {
      type: 'bake-font-result-v0',
      id: value.id,
      ok: false,
      error: serializeError(error),
    };
    scope.postMessage(response);
  }
}

function postSuccess(id: number, artifact: CachedFontArtifact, report: unknown, warnings: readonly unknown[]): void {
  const artifacts: RuntimeBakeSuccess['artifacts'] = [
    {
      role: 'font',
      id: artifact.id,
      bytes: copyToOwnedArrayBuffer(artifact.bytes),
      fingerprint: artifact.fingerprint,
    },
  ];
  const response: RuntimeBakeSuccess = {
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

async function resolveRasters(rasters: readonly RuntimeBakeRaster[]): Promise<readonly ResolvedRasterBakePlan[]> {
  return Promise.all(rasters.map(resolveRaster));
}

async function resolveRaster(raster: RuntimeBakeRaster): Promise<ResolvedRasterBakePlan> {
  const packaging = { artifact: 'embedded', pages: 'embedded' } as const;
  const rasterKey = deriveRasterKey({
    descriptor: raster.descriptor,
    extension: raster.extension,
    kind: raster.kind,
    version: raster.version,
  });
  if (rasterKey !== raster.rasterKey) {
    throw new Error(`runtime ${raster.kind} descriptor does not match its raster key`);
  }
  switch (raster.kind) {
    case 'bitmap': {
      const baker = (await import('./bakers/bitmap.js')).default;
      assertRuntimeBakerIdentity(baker, raster);
      return createResolvedRasterBakePlan(baker, packaging, runtimeBitmapDescriptor(raster.descriptor), rasterKey);
    }
    case 'msdf': {
      const baker = (await import('./bakers/msdf.js')).default;
      assertRuntimeBakerIdentity(baker, raster);
      return createResolvedRasterBakePlan(baker, packaging, runtimeMsdfDescriptor(raster.descriptor), rasterKey);
    }
    case 'slug': {
      const baker = (await import('./bakers/slug.js')).default;
      assertRuntimeBakerIdentity(baker, raster);
      return createResolvedRasterBakePlan(baker, packaging, runtimeSlugDescriptor(raster.descriptor), rasterKey);
    }
    default:
      throw new Error(`runtime font baker does not support raster kind ${raster.kind}`);
  }
}

function assertRuntimeBakerIdentity(
  baker: { readonly extension: string; readonly version: number },
  raster: RuntimeBakeRaster,
): void {
  if (baker.extension !== raster.extension || baker.version !== raster.version) {
    throw new Error(`runtime ${raster.kind} baker identity does not match the requested technique`);
  }
}

function runtimeBitmapDescriptor(value: JsonValue): BitmapDescriptor {
  const record = jsonRecord(value, 'bitmap');
  if (record.generatorVersion !== BITMAP_GENERATOR_VERSION) throw new TypeError('invalid runtime bitmap descriptor');
  const strikes = numberTuple(record.strikes, 'bitmap strikes');
  const descriptor = canonicalizeBitmapDescriptor(strikes, record.coverage);
  assertCanonicalDescriptor(value, descriptor, 'bitmap');
  return descriptor;
}

function runtimeMsdfDescriptor(value: JsonValue): MsdfDescriptor {
  const record = jsonRecord(value, 'MTSDF');
  if (record.generatorVersion !== MSDF_GENERATOR_VERSION) throw new TypeError('invalid runtime MTSDF descriptor');
  const emSize = optionalNumber(record.emSize, 'MTSDF emSize');
  const pixelRange = optionalNumber(record.pixelRange, 'MTSDF pixel range');
  const coverage = record.coverage === undefined ? undefined : normalizeRasterCoverage(record.coverage);
  const descriptor = msdfDescriptor(
    emSize === undefined && pixelRange === undefined && coverage === undefined
      ? undefined
      : {
          ...(emSize === undefined ? {} : { emSize }),
          ...(pixelRange === undefined ? {} : { pixelRange }),
          ...(coverage === undefined ? {} : { coverage }),
        },
  );
  assertCanonicalDescriptor(value, descriptor, 'MTSDF');
  return descriptor;
}

function runtimeSlugDescriptor(value: JsonValue): SlugDescriptor {
  const record = jsonRecord(value, 'Slug');
  if (record.generatorVersion !== SLUG_GENERATOR_VERSION) throw new TypeError('invalid runtime Slug descriptor');
  const descriptor = slugDescriptor();
  assertCanonicalDescriptor(value, descriptor, 'Slug');
  return descriptor;
}

function jsonRecord(value: JsonValue, label: string): { readonly [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`invalid runtime ${label} descriptor`);
  }
  const record: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function numberTuple(value: JsonValue | undefined, label: string): readonly [number, ...number[]] {
  if (!Array.isArray(value)) throw new TypeError(`invalid runtime ${label}`);
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number') throw new TypeError(`invalid runtime ${label}`);
    numbers.push(entry);
  }
  const [first, ...rest] = numbers;
  if (first === undefined) throw new TypeError(`invalid runtime ${label}`);
  return [first, ...rest];
}

function optionalNumber(value: JsonValue | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw new TypeError(`invalid runtime ${label}`);
  return value;
}

function assertCanonicalDescriptor(value: JsonValue, descriptor: JsonValue, label: string): void {
  if (canonicalJson(value) !== canonicalJson(descriptor)) {
    throw new TypeError(`invalid runtime ${label} descriptor`);
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
