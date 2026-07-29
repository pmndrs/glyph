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
  type DirectRasterBakerAbi,
} from '../internal/raster-baker-wasm.js'
import { mtsdfBakerAbi, type MtsdfBakerAbi } from '../generated/mtsdf-baker-abi.js'
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js'
import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_KIND,
  msdfDescriptor,
  type MsdfOptions,
  type MsdfDescriptorV0,
} from '../internal/msdf-contract.js'

export type MsdfBakerOptions = MsdfOptions | undefined

export interface MtsdfBakerRequestV0 {
  readonly fontFaceIndex: number
  readonly glyphCount: number
  readonly shapingHash: string
  readonly rasterKey: string
  readonly packaging: {
    readonly artifact: 'embedded' | 'external'
    readonly pages: 'embedded' | 'external'
  }
  readonly descriptor: MsdfDescriptorV0
}

export interface MtsdfBakerCoreRequestV0 {
  readonly source: Uint8Array
  readonly request: MtsdfBakerRequestV0
  readonly onProgress?: BakeProgressListener
}

export interface MtsdfBakerCore {
  bake(request: MtsdfBakerCoreRequestV0): RasterBakeArtifact<'msdf'>
}

export type MtsdfBakerWasmSource = BufferSource | WebAssembly.Module

export type MtsdfBakerAbiV1 = MtsdfBakerAbi

export class MtsdfBakeError extends Error {
  readonly code: string
  readonly path: string | undefined

  constructor(error: SerializedBakeError) {
    super(error.message)
    this.name = 'MtsdfBakeError'
    this.code = error.code
    this.path = error.path
  }
}

export async function createMtsdfBaker(source: MtsdfBakerWasmSource): Promise<MtsdfBakerCore> {
  let listener: BakeProgressListener | undefined
  const instance = await instantiateWasm(source, {
    env: {
      pmndrs_text_bake_progress(completed: number, total: number) {
        listener?.({ stage: 'raster', phase: 'rasterizing', completed, total })
      },
    },
  })
  const core = createMtsdfBakerFromInstance(instance)
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

export function createMtsdfBakerFromInstance(instance: WebAssembly.Instance): MtsdfBakerCore {
  const abi = readMtsdfBakerAbi(instance)
  const directAbi: DirectRasterBakerAbi = {
    memory: abi.memory,
    functions: {
      allocate: {
        export: abi.functions.allocate,
        parameters: ['byteLength'],
        result: 'pointer',
      },
      deallocate: {
        export: abi.functions.deallocate,
        parameters: ['pointer', 'byteLength'],
      },
      bake: abi.artifactBaker.functions.bake,
      responseByteLength: abi.artifactBaker.functions.responseByteLength,
    },
    response: abi.artifactBaker.response,
    segmented: {
      chunkByteLength: abi.artifactBaker.response.segmented.chunkByteLength,
      unavailableStatus: abi.artifactBaker.response.segmented.unavailableStatus,
      functions: {
        status: abi.artifactBaker.functions.segmentedStatus,
        metadataPointer: abi.artifactBaker.functions.segmentedMetadataPointer,
        metadataByteLength: abi.artifactBaker.functions.segmentedMetadataByteLength,
        artifactCount: abi.artifactBaker.functions.segmentedArtifactCount,
        artifactByteLength: abi.artifactBaker.functions.segmentedArtifactByteLength,
        chunkPointer: abi.artifactBaker.functions.segmentedChunkPointer,
        chunkByteLength: abi.artifactBaker.functions.segmentedChunkByteLength,
        release: abi.artifactBaker.functions.releaseSegmentedResponse,
      },
    },
  }
  return createDirectRasterBakerFromInstance<MtsdfBakerRequestV0, 'msdf'>(instance, directAbi, {
    label: 'MTSDF baker',
    kind: MSDF_KIND,
    extension: MSDF_EXTENSION,
    version: MSDF_FORMAT_VERSION,
    pageFormat: 'rgba8unorm',
    createError: (error) => new MtsdfBakeError(error),
  })
}

export function readMtsdfBakerAbi(instance: WebAssembly.Instance): MtsdfBakerAbiV1 {
  void instance
  return mtsdfBakerAbi
}

export function msdfBakerFromCore(
  core: MtsdfBakerCore,
): RasterBakerModule<'msdf', MsdfBakerOptions, MsdfDescriptorV0> {
  return {
    kind: MSDF_KIND,
    extension: MSDF_EXTENSION,
    version: MSDF_FORMAT_VERSION,
    descriptor: msdfDescriptor,
    async bake(request: RasterBakeRequest<MsdfDescriptorV0>) {
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

async function loadDefaultMtsdfBaker(): Promise<ReturnType<typeof msdfBakerFromCore>> {
  const wasmUrl = new URL('../mtsdf_baker.wasm', import.meta.url)
  let bytes: BufferSource
  if (wasmUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises')
    bytes = await readFile(wasmUrl)
  } else {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`Unable to load MTSDF baker Wasm (${response.status})`)
    bytes = await response.arrayBuffer()
  }
  return msdfBakerFromCore(await createMtsdfBaker(bytes))
}

const defaultMtsdfBaker = cacheSuccessfulPromise(loadDefaultMtsdfBaker)

export const msdfBaker: RasterBakerModule<'msdf', MsdfBakerOptions, MsdfDescriptorV0> = {
  kind: MSDF_KIND,
  extension: MSDF_EXTENSION,
  version: MSDF_FORMAT_VERSION,
  descriptor: msdfDescriptor,
  async bake(request) {
    return (await defaultMtsdfBaker()).bake(request)
  },
}

export default msdfBaker
