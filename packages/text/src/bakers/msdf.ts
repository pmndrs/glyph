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
  isNonArrayObject,
  matchesAbiFunction,
  readEmbeddedJsonAbi,
  type AbiFunction,
  type DirectRasterBakerAbi,
} from '../internal/raster-baker-wasm.js'
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js'
import {
  MSDF_EXTENSION,
  MSDF_FORMAT_VERSION,
  MSDF_GENERATOR_VERSION,
  MSDF_KIND,
  msdfDescriptor,
  type MsdfDescriptorV0,
} from '../internal/msdf-contract.js'

export type MsdfBakerOptions = undefined

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

export interface MtsdfBakerAbiV1 {
  readonly name: 'pmndrs-text-mtsdf-baker'
  readonly version: 1
  readonly endianness: 'little'
  readonly pointerWidth: 32
  readonly memory: 'memory'
  readonly imports: {
    readonly progress: {
      readonly module: 'env'
      readonly name: 'pmndrs_text_bake_progress'
      readonly parameters: readonly ['completed', 'total']
    }
  }
  readonly functions: {
    readonly allocate: 'pmndrs_text_mtsdf_alloc'
    readonly deallocate: 'pmndrs_text_mtsdf_dealloc'
  }
  readonly artifactBaker: {
    readonly versions: {
      readonly generator: '0.0.0'
      readonly msdfFormat: 0
      readonly skrifa: '0.45.1'
      readonly readFonts: '0.42.1'
      readonly ktx2: '0.5.0'
    }
    readonly functions: {
      readonly bake: AbiFunction
      readonly responseByteLength: AbiFunction
      readonly segmentedStatus: AbiFunction
      readonly segmentedMetadataPointer: AbiFunction
      readonly segmentedMetadataByteLength: AbiFunction
      readonly segmentedArtifactCount: AbiFunction
      readonly segmentedArtifactByteLength: AbiFunction
      readonly segmentedChunkPointer: AbiFunction
      readonly segmentedChunkByteLength: AbiFunction
      readonly releaseSegmentedResponse: AbiFunction
    }
    readonly response: DirectRasterBakerAbi['response'] & {
      readonly segmented: {
        readonly chunkByteLength: 8_388_608
        readonly unavailableStatus: 4_294_967_295
      }
    }
  }
}

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
  const value = readEmbeddedJsonAbi(
    instance,
    'pmndrs_text_mtsdf_abi_ptr',
    'pmndrs_text_mtsdf_abi_len',
    'MTSDF baker',
  )
  assertMtsdfBakerAbi(value)
  return value
}

function assertMtsdfBakerAbi(value: unknown): asserts value is MtsdfBakerAbiV1 {
  if (!isNonArrayObject(value)) throw new TypeError('unsupported MTSDF baker ABI')
  const { imports, functions, artifactBaker } = value
  if (
    value.name !== 'pmndrs-text-mtsdf-baker' ||
    value.version !== 1 ||
    value.endianness !== 'little' ||
    value.pointerWidth !== 32 ||
    value.memory !== 'memory' ||
    !matchesProgressImport(imports) ||
    !isNonArrayObject(functions) ||
    functions.allocate !== 'pmndrs_text_mtsdf_alloc' ||
    functions.deallocate !== 'pmndrs_text_mtsdf_dealloc' ||
    !isNonArrayObject(artifactBaker)
  ) {
    throw new TypeError('unsupported MTSDF baker ABI')
  }
  const { versions, functions: artifactFunctions, response } = artifactBaker
  if (
    !isNonArrayObject(versions) ||
    versions.generator !== MSDF_GENERATOR_VERSION ||
    versions.msdfFormat !== MSDF_FORMAT_VERSION ||
    versions.skrifa !== '0.45.1' ||
    versions.readFonts !== '0.42.1' ||
    versions.ktx2 !== '0.5.0' ||
    !isNonArrayObject(artifactFunctions) ||
    !matchesAbiFunction(
      artifactFunctions.bake,
      ['sourcePointer', 'sourceByteLength', 'requestPointer', 'requestByteLength'],
      'responsePointer',
    ) ||
    !matchesAbiFunction(artifactFunctions.responseByteLength, [], 'byteLength') ||
    !matchesAbiFunction(artifactFunctions.segmentedStatus, [], 'status') ||
    !matchesAbiFunction(artifactFunctions.segmentedMetadataPointer, [], 'pointer') ||
    !matchesAbiFunction(artifactFunctions.segmentedMetadataByteLength, [], 'byteLength') ||
    !matchesAbiFunction(artifactFunctions.segmentedArtifactCount, [], 'count') ||
    !matchesAbiFunction(
      artifactFunctions.segmentedArtifactByteLength,
      ['artifactIndex'],
      'byteLength',
    ) ||
    !matchesAbiFunction(
      artifactFunctions.segmentedChunkPointer,
      ['artifactIndex', 'byteOffset'],
      'pointer',
    ) ||
    !matchesAbiFunction(
      artifactFunctions.segmentedChunkByteLength,
      ['artifactIndex', 'byteOffset'],
      'byteLength',
    ) ||
    !matchesAbiFunction(artifactFunctions.releaseSegmentedResponse, []) ||
    !isNonArrayObject(response) ||
    response.headerByteLength !== 16 ||
    response.magic !== 'PMMS' ||
    response.statusOffset !== 4 ||
    response.metadataByteLengthOffset !== 8 ||
    response.artifactByteLengthOffset !== 12 ||
    response.payloadOffset !== 16 ||
    response.successStatus !== 0 ||
    !isNonArrayObject(response.segmented) ||
    response.segmented.chunkByteLength !== 8_388_608 ||
    response.segmented.unavailableStatus !== 4_294_967_295
  ) {
    throw new TypeError('unsupported MTSDF baker ABI')
  }
}

function matchesProgressImport(value: unknown): boolean {
  if (!isNonArrayObject(value) || !isNonArrayObject(value.progress)) return false
  const { module, name, parameters } = value.progress
  return (
    module === 'env' &&
    name === 'pmndrs_text_bake_progress' &&
    Array.isArray(parameters) &&
    parameters.length === 2 &&
    parameters[0] === 'completed' &&
    parameters[1] === 'total'
  )
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
