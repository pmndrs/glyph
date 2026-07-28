import type {
  BakeProgressListener,
  RasterBakeArtifact,
  RasterBakeRequest,
  RasterBakerModule,
  SerializedBakeError,
} from '../bake.js'
import {
  createDirectRasterBakerFromInstance,
  instantiateWasm,
} from '../internal/raster-baker-wasm.js'
import { bitmapBakerAbi, type BitmapBakerAbi } from '../generated/bitmap-baker-abi.js'
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js'
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_KIND,
  bitmapDescriptor,
  type BitmapDescriptorV0,
} from '../internal/bitmap-contract.js'

export interface BitmapBakerOptions {
  readonly strikes: readonly [number, ...number[]]
}

export interface BitmapBakerRequestV0 {
  readonly fontFaceIndex: number
  readonly glyphCount: number
  readonly shapingHash: string
  readonly rasterKey: string
  readonly packaging: {
    readonly artifact: 'embedded' | 'external'
    readonly pages: 'embedded' | 'external'
  }
  readonly descriptor: BitmapDescriptorV0
}

export interface BitmapBakerCoreRequestV0 {
  readonly source: Uint8Array
  readonly request: BitmapBakerRequestV0
  readonly onProgress?: BakeProgressListener
}

export interface BitmapBakerCore {
  bake(request: BitmapBakerCoreRequestV0): RasterBakeArtifact<'bitmap'>
}

export type BitmapBakerWasmSource = BufferSource | WebAssembly.Module

export type BitmapBakerAbiV0 = BitmapBakerAbi

export class BitmapBakeError extends Error {
  readonly code: string
  readonly path: string | undefined

  constructor(error: SerializedBakeError) {
    super(error.message)
    this.name = 'BitmapBakeError'
    this.code = error.code
    this.path = error.path
  }
}

export async function createBitmapBaker(source: BitmapBakerWasmSource): Promise<BitmapBakerCore> {
  let listener: BakeProgressListener | undefined
  const instance = await instantiateWasm(source, {
    env: {
      pmndrs_text_bake_progress(completed: number, total: number) {
        listener?.({ stage: 'raster', phase: 'rasterizing', completed, total })
      },
    },
  })
  const core = createBitmapBakerFromInstance(instance)
  return {
    bake(request) {
      listener = request.onProgress
      try {
        return core.bake(request)
      } finally {
        listener = undefined
      }
    },
  }
}

export function createBitmapBakerFromInstance(instance: WebAssembly.Instance): BitmapBakerCore {
  const abi = readBitmapBakerAbi(instance)
  return createDirectRasterBakerFromInstance<BitmapBakerRequestV0, 'bitmap'>(instance, abi, {
    label: 'bitmap baker',
    kind: BITMAP_KIND,
    extension: BITMAP_EXTENSION,
    version: BITMAP_FORMAT_VERSION,
    pageFormat: 'r8unorm',
    createError: (error) => new BitmapBakeError(error),
  })
}

export function readBitmapBakerAbi(instance: WebAssembly.Instance): BitmapBakerAbiV0 {
  void instance
  return bitmapBakerAbi
}

export function bitmapBakerFromCore(
  core: BitmapBakerCore,
): RasterBakerModule<'bitmap', BitmapBakerOptions, BitmapDescriptorV0> {
  return {
    kind: BITMAP_KIND,
    extension: BITMAP_EXTENSION,
    version: BITMAP_FORMAT_VERSION,
    descriptor: bitmapDescriptor,
    async bake(request: RasterBakeRequest<BitmapDescriptorV0>) {
      request.signal?.throwIfAborted()
      const result = core.bake({
        source: request.font.source,
        ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
        request: {
          fontFaceIndex: request.font.fontFaceIndex,
          glyphCount: request.font.glyphCount,
          shapingHash: request.font.shapingHash,
          rasterKey: request.rasterKey,
          packaging: request.packaging,
          descriptor: request.descriptor,
        },
      })
      request.signal?.throwIfAborted()
      return result
    },
  }
}

async function loadDefaultBitmapBaker(): Promise<ReturnType<typeof bitmapBakerFromCore>> {
  const wasmUrl = new URL('../bitmap_baker.wasm', import.meta.url)
  let bytes: BufferSource
  if (wasmUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises')
    bytes = await readFile(wasmUrl)
  } else {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`Unable to load bitmap baker Wasm (${response.status})`)
    bytes = await response.arrayBuffer()
  }
  return bitmapBakerFromCore(await createBitmapBaker(bytes))
}

const defaultBitmapBaker = cacheSuccessfulPromise(loadDefaultBitmapBaker)

export const bitmapBaker: RasterBakerModule<'bitmap', BitmapBakerOptions, BitmapDescriptorV0> = {
  kind: BITMAP_KIND,
  extension: BITMAP_EXTENSION,
  version: BITMAP_FORMAT_VERSION,
  descriptor: bitmapDescriptor,
  async bake(request) {
    return (await defaultBitmapBaker()).bake(request)
  },
}

export default bitmapBaker
