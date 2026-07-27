/// <reference lib="webworker" />

import type { RasterBakerModule } from '../bake.js'
import type { JsonValue } from '../raster.js'
import { transferableArrayBuffer } from './owned-array-buffer.js'
import {
  isRasterBakeWorkerRequestV0,
  type RasterBakeWorkerFailureV0,
  type RasterBakeWorkerRequestV0,
  type RasterBakeWorkerSuccessV0,
} from './raster-bake-worker-protocol.js'

type OptionsNormalizer<Options> = (value: unknown) => Options

export function startRasterBakeWorker<Kind extends string, Options, Descriptor extends JsonValue>(
  baker: RasterBakerModule<Kind, Options, Descriptor>,
  normalizeOptions: OptionsNormalizer<Options>,
): void {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope
  let pending = Promise.resolve()
  scope.addEventListener('message', (event: MessageEvent<unknown>) => {
    const value = event.data
    if (!isRasterBakeWorkerRequestV0(value)) return
    pending = pending.then(() => handleMessage(scope, baker, normalizeOptions, value))
  })
}

async function handleMessage<Kind extends string, Options, Descriptor extends JsonValue>(
  scope: DedicatedWorkerGlobalScope,
  baker: RasterBakerModule<Kind, Options, Descriptor>,
  normalizeOptions: OptionsNormalizer<Options>,
  request: RasterBakeWorkerRequestV0,
): Promise<void> {
  try {
    const descriptor = baker.descriptor(normalizeOptions(request.options))
    const result = await baker.bake({
      font: {
        source: new Uint8Array(request.source),
        fontFaceIndex: request.fontFaceIndex,
        glyphCount: request.glyphCount,
        shapingHash: request.shapingHash,
      },
      rasterKey: request.rasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor,
    })
    const artifacts: RasterBakeWorkerSuccessV0['artifacts'] = result.artifacts.map((artifact) => {
      if (artifact.role === 'font') {
        throw new TypeError(`${result.kind} raster baker returned a core font artifact`)
      }
      return {
        role: artifact.role,
        id: artifact.id,
        bytes: transferableArrayBuffer(artifact.bytes),
        sha256: artifact.sha256,
      }
    })
    const response: RasterBakeWorkerSuccessV0 = {
      type: 'bake-raster-result-v0',
      id: request.id,
      ok: true,
      rasterKey: result.rasterKey,
      kind: result.kind,
      extension: result.extension,
      version: result.version,
      artifacts,
      report: result.report,
    }
    scope.postMessage(
      response,
      artifacts.map(({ bytes }) => bytes),
    )
  } catch (error) {
    const response: RasterBakeWorkerFailureV0 = {
      type: 'bake-raster-result-v0',
      id: request.id,
      ok: false,
      error: serializeError(error),
    }
    scope.postMessage(response)
  }
}

function serializeError(error: unknown): RasterBakeWorkerFailureV0['error'] {
  if (error instanceof Error) {
    const value = error as Error & { readonly code?: unknown; readonly path?: unknown }
    return {
      code: typeof value.code === 'string' ? value.code : 'RUNTIME_RASTER_BAKE_FAILED',
      message: value.message,
      ...(typeof value.path === 'string' ? { path: value.path } : {}),
    }
  }
  return { code: 'RUNTIME_RASTER_BAKE_FAILED', message: String(error) }
}
