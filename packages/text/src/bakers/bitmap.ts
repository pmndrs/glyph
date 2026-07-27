import type {
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
} from '../internal/raster-baker-wasm.js'
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js'
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
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
}

export interface BitmapBakerCore {
  bake(request: BitmapBakerCoreRequestV0): RasterBakeArtifact<'bitmap'>
}

export type BitmapBakerWasmSource = BufferSource | WebAssembly.Module

export interface BitmapBakerAbiV0 {
  readonly name: 'pmndrs-text-bitmap-baker'
  readonly version: 0
  readonly endianness: 'little'
  readonly pointerWidth: 32
  readonly memory: 'memory'
  readonly versions: {
    readonly generator: '0.0.0'
    readonly bitmapFormat: 0
    readonly skrifa: '0.45.1'
    readonly readFonts: '0.42.1'
    readonly zeno: '0.3.3'
    readonly ktx2: '0.5.0'
  }
  readonly functions: {
    readonly allocate: AbiFunction
    readonly deallocate: AbiFunction
    readonly bake: AbiFunction
    readonly responseByteLength: AbiFunction
  }
  readonly response: {
    readonly headerByteLength: 16
    readonly magic: 'PMBM'
    readonly statusOffset: 4
    readonly metadataByteLengthOffset: 8
    readonly artifactByteLengthOffset: 12
    readonly payloadOffset: 16
    readonly successStatus: 0
  }
}

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
  return createBitmapBakerFromInstance(await instantiateWasm(source))
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
  const value = readEmbeddedJsonAbi(
    instance,
    'pmndrs_bitmap_baker_abi_ptr',
    'pmndrs_bitmap_baker_abi_len',
    'bitmap baker',
  )
  assertBitmapBakerAbi(value)
  return value
}

function assertBitmapBakerAbi(value: unknown): asserts value is BitmapBakerAbiV0 {
  if (!isNonArrayObject(value)) throw new TypeError('unsupported bitmap baker ABI')
  const { versions, functions, response } = value
  if (
    value.name !== 'pmndrs-text-bitmap-baker' ||
    value.version !== 0 ||
    value.endianness !== 'little' ||
    value.pointerWidth !== 32 ||
    value.memory !== 'memory' ||
    !isNonArrayObject(versions) ||
    versions.generator !== BITMAP_GENERATOR_VERSION ||
    versions.bitmapFormat !== BITMAP_FORMAT_VERSION ||
    versions.skrifa !== '0.45.1' ||
    versions.readFonts !== '0.42.1' ||
    versions.zeno !== '0.3.3' ||
    versions.ktx2 !== '0.5.0' ||
    !isNonArrayObject(functions) ||
    !matchesAbiFunction(functions.allocate, ['byteLength'], 'pointer') ||
    !matchesAbiFunction(functions.deallocate, ['pointer', 'byteLength']) ||
    !matchesAbiFunction(
      functions.bake,
      ['sourcePointer', 'sourceByteLength', 'requestPointer', 'requestByteLength'],
      'responsePointer',
    ) ||
    !matchesAbiFunction(functions.responseByteLength, [], 'byteLength') ||
    !isNonArrayObject(response) ||
    response.headerByteLength !== 16 ||
    response.magic !== 'PMBM' ||
    response.statusOffset !== 4 ||
    response.metadataByteLengthOffset !== 8 ||
    response.artifactByteLengthOffset !== 12 ||
    response.payloadOffset !== 16 ||
    response.successStatus !== 0
  ) {
    throw new TypeError('unsupported bitmap baker ABI')
  }
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
