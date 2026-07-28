import type {
  BakeProgressListener,
  RasterBakeArtifact,
  RasterBakeRequest,
  RasterBakerModule,
  SerializedBakeError,
} from '../bake.js'
import { slugBakerAbi, type SlugBakerAbi } from '../generated/slug-baker-abi.js'
import {
  createDirectRasterBakerFromInstance,
  instantiateWasm,
  type DirectRasterBakerAbi,
} from '../internal/raster-baker-wasm.js'
import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_KIND,
  slugDescriptor,
  type SlugDescriptorV0,
} from '../internal/slug-contract.js'
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js'

export type SlugBakerOptions = undefined

export interface SlugBakerRequestV0 {
  readonly fontFaceIndex: number
  readonly glyphCount: number
  readonly shapingHash: string
  readonly rasterKey: string
  readonly packaging: {
    readonly artifact: 'embedded' | 'external'
    readonly pages: 'embedded' | 'external'
  }
  readonly descriptor: SlugDescriptorV0
}

export interface SlugBakerCoreRequestV0 {
  readonly source: Uint8Array
  readonly request: SlugBakerRequestV0
  readonly onProgress?: BakeProgressListener
}

export interface SlugBakerCore {
  bake(request: SlugBakerCoreRequestV0): RasterBakeArtifact<typeof SLUG_KIND>
}

export type SlugBakerWasmSource = BufferSource | WebAssembly.Module
export type SlugBakerAbiV0 = SlugBakerAbi

export class SlugBakeError extends Error {
  readonly code: string
  readonly path: string | undefined

  constructor(error: SerializedBakeError) {
    super(error.message)
    this.name = 'SlugBakeError'
    this.code = error.code
    this.path = error.path
  }
}

export async function createSlugBaker(source: SlugBakerWasmSource): Promise<SlugBakerCore> {
  let listener: BakeProgressListener | undefined
  const instance = await instantiateWasm(source, {
    env: {
      pmndrs_text_bake_progress(completed: number, total: number) {
        listener?.({ stage: 'raster', phase: 'rasterizing', completed, total })
      },
    },
  })
  const core = createSlugBakerFromInstance(instance)
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

export function createSlugBakerFromInstance(instance: WebAssembly.Instance): SlugBakerCore {
  return createDirectRasterBakerFromInstance<SlugBakerRequestV0, typeof SLUG_KIND>(
    instance,
    readSlugBakerAbi(instance) satisfies DirectRasterBakerAbi,
    {
      label: 'Slug baker',
      kind: SLUG_KIND,
      extension: SLUG_EXTENSION,
      version: SLUG_FORMAT_VERSION,
      pageFormat: 'rgba16float',
      createError: (error) => new SlugBakeError(error),
    },
  )
}

export function readSlugBakerAbi(instance: WebAssembly.Instance): SlugBakerAbiV0 {
  void instance
  return slugBakerAbi
}

export function slugBakerFromCore(
  core: SlugBakerCore,
): RasterBakerModule<typeof SLUG_KIND, SlugBakerOptions, SlugDescriptorV0> {
  return {
    kind: SLUG_KIND,
    extension: SLUG_EXTENSION,
    version: SLUG_FORMAT_VERSION,
    descriptor: slugDescriptor,
    async bake(request: RasterBakeRequest<SlugDescriptorV0>) {
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

async function loadDefaultSlugBaker(): Promise<ReturnType<typeof slugBakerFromCore>> {
  const wasmUrl = new URL('../slug_baker.wasm', import.meta.url)
  let bytes: BufferSource
  if (wasmUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises')
    bytes = await readFile(wasmUrl)
  } else {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`Unable to load Slug baker Wasm (${response.status})`)
    bytes = await response.arrayBuffer()
  }
  return slugBakerFromCore(await createSlugBaker(bytes))
}

const defaultSlugBaker = cacheSuccessfulPromise(loadDefaultSlugBaker)

export const slugBaker: RasterBakerModule<typeof SLUG_KIND, SlugBakerOptions, SlugDescriptorV0> = {
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  descriptor: slugDescriptor,
  async bake(request) {
    return (await defaultSlugBaker()).bake(request)
  },
}

export default slugBaker
