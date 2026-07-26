import type {
  BakeArtifactV0,
  RasterBakeArtifact,
  RasterBakeRequest,
  RasterBakerModule,
  RasterPagePayloadReport,
  RasterPayloadReport,
  SerializedBakeError,
} from '../bake.js'
import type { RasterKey, Sha256Hex } from '../identity.js'
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js'
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
  BITMAP_KIND,
  bitmapDescriptor,
  type BitmapDescriptorV0,
} from '../raster/bitmap.js'

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

interface AbiFunction {
  readonly export: string
  readonly parameters: readonly string[]
  readonly result?: string
}

interface BitmapArtifactMetadata {
  readonly role: 'raster' | 'raster-page'
  readonly id: string
  readonly sha256: Sha256Hex
  readonly byteOffset: number
  readonly byteLength: number
}

interface BitmapResultMetadata {
  readonly rasterKey: string
  readonly kind: 'bitmap'
  readonly extension: 'PMNDRS_font_bitmap'
  readonly version: 0
  readonly artifacts: readonly BitmapArtifactMetadata[]
  readonly report: RasterPayloadReport
}

interface BitmapBakerExports {
  readonly memory: WebAssembly.Memory
  readonly allocate: (length: number) => number
  readonly deallocate: (pointer: number, length: number) => void
  readonly bake: (
    sourcePointer: number,
    sourceLength: number,
    requestPointer: number,
    requestLength: number,
  ) => number
  readonly responseLength: () => number
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
  const instance = await WebAssembly.instantiate(module, {})
  return createBitmapBakerFromInstance(instance)
}

export function createBitmapBakerFromInstance(instance: WebAssembly.Instance): BitmapBakerCore {
  const abi = readBitmapBakerAbi(instance)
  const exports = readExports(instance.exports, abi)
  return {
    bake({ source, request }) {
      const requestBytes = textEncoder.encode(JSON.stringify(request))
      let sourcePointer = 0
      let requestPointer = 0
      let responsePointer = 0
      let responseLength = 0
      try {
        sourcePointer = copyIntoWasm(exports, source)
        requestPointer = copyIntoWasm(exports, requestBytes)
        responsePointer = exports.bake(
          sourcePointer,
          source.byteLength,
          requestPointer,
          requestBytes.byteLength,
        )
        responseLength = exports.responseLength()
        const response = new Uint8Array(
          exports.memory.buffer,
          responsePointer,
          responseLength,
        ).slice()
        return decodeResponse(response, abi)
      } finally {
        if (sourcePointer !== 0) exports.deallocate(sourcePointer, source.byteLength)
        if (requestPointer !== 0) exports.deallocate(requestPointer, requestBytes.byteLength)
        if (responsePointer !== 0 && responseLength !== 0) {
          exports.deallocate(responsePointer, responseLength)
        }
      }
    },
  }
}

export function readBitmapBakerAbi(instance: WebAssembly.Instance): BitmapBakerAbiV0 {
  const pointer = readBootstrap(instance.exports, 'pmndrs_bitmap_baker_abi_ptr')()
  const length = readBootstrap(instance.exports, 'pmndrs_bitmap_baker_abi_len')()
  const memory = instance.exports.memory
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new TypeError('bitmap baker ABI bootstrap is missing linear memory')
  }
  const value: unknown = JSON.parse(
    textDecoder.decode(new Uint8Array(memory.buffer, pointer, length)),
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

function readExports(wasmExports: WebAssembly.Exports, abi: BitmapBakerAbiV0): BitmapBakerExports {
  const memory = wasmExports[abi.memory]
  const allocate = wasmExports[abi.functions.allocate.export]
  const deallocate = wasmExports[abi.functions.deallocate.export]
  const bake = wasmExports[abi.functions.bake.export]
  const responseLength = wasmExports[abi.functions.responseByteLength.export]
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof allocate !== 'function' ||
    typeof deallocate !== 'function' ||
    typeof bake !== 'function' ||
    typeof responseLength !== 'function'
  ) {
    throw new TypeError('invalid bitmap baker Wasm exports')
  }
  return {
    memory,
    allocate: allocate as BitmapBakerExports['allocate'],
    deallocate: deallocate as BitmapBakerExports['deallocate'],
    bake: bake as BitmapBakerExports['bake'],
    responseLength: responseLength as BitmapBakerExports['responseLength'],
  }
}

function readBootstrap(wasmExports: WebAssembly.Exports, name: string): () => number {
  const value = wasmExports[name]
  if (typeof value !== 'function') throw new TypeError(`bitmap baker ABI is missing ${name}`)
  return value as () => number
}

function copyIntoWasm(exports: BitmapBakerExports, bytes: Uint8Array): number {
  const pointer = exports.allocate(bytes.byteLength)
  if (pointer === 0 && bytes.byteLength !== 0) {
    throw new RangeError('bitmap baker Wasm allocation failed')
  }
  try {
    new Uint8Array(exports.memory.buffer, pointer, bytes.byteLength).set(bytes)
    return pointer
  } catch (error) {
    if (pointer !== 0) exports.deallocate(pointer, bytes.byteLength)
    throw error
  }
}

function decodeResponse(response: Uint8Array, abi: BitmapBakerAbiV0): RasterBakeArtifact<'bitmap'> {
  const contract = abi.response
  if (response.byteLength < contract.headerByteLength) {
    throw new TypeError('bitmap baker response is shorter than its ABI header')
  }
  if (textDecoder.decode(response.subarray(0, contract.magic.length)) !== contract.magic) {
    throw new TypeError('bitmap baker response magic does not match its ABI')
  }
  const view = new DataView(response.buffer, response.byteOffset, response.byteLength)
  const status = view.getUint32(contract.statusOffset, true)
  const metadataLength = view.getUint32(contract.metadataByteLengthOffset, true)
  const artifactLength = view.getUint32(contract.artifactByteLengthOffset, true)
  const metadataStart = contract.payloadOffset
  const metadataEnd = checkedEnd(metadataStart, metadataLength, response.byteLength)
  const artifactEnd = checkedEnd(metadataEnd, artifactLength, response.byteLength)
  if (artifactEnd !== response.byteLength) {
    throw new TypeError('bitmap baker response carries undeclared trailing bytes')
  }
  const metadata: unknown = JSON.parse(
    textDecoder.decode(response.subarray(metadataStart, metadataEnd)),
  )
  if (status !== contract.successStatus) {
    throw new BitmapBakeError(parseSerializedBakeError(metadata))
  }
  assertBitmapResultMetadata(metadata, artifactLength)
  const result = metadata
  const artifacts = result.artifacts.map<BakeArtifactV0>((artifact) => ({
    role: artifact.role,
    id: artifact.id,
    bytes: response
      .subarray(
        metadataEnd + artifact.byteOffset,
        metadataEnd + artifact.byteOffset + artifact.byteLength,
      )
      .slice(),
    sha256: artifact.sha256,
  }))
  return {
    rasterKey: result.rasterKey as RasterKey,
    kind: result.kind,
    extension: result.extension,
    version: result.version,
    artifacts,
    report: result.report,
  }
}

function assertBitmapResultMetadata(
  result: unknown,
  artifactLength: number,
): asserts result is BitmapResultMetadata {
  if (
    !isNonArrayObject(result) ||
    result.kind !== BITMAP_KIND ||
    result.extension !== BITMAP_EXTENSION ||
    result.version !== BITMAP_FORMAT_VERSION ||
    !isHash(result.rasterKey) ||
    !Array.isArray(result.artifacts) ||
    !isRasterPayloadReport(result.report)
  ) {
    throw new TypeError('bitmap baker returned invalid result metadata')
  }
  let expectedOffset = 0
  for (const artifact of result.artifacts) {
    if (
      !isBitmapArtifactMetadata(artifact) ||
      artifact.id.length === 0 ||
      artifact.byteOffset !== expectedOffset ||
      artifact.byteLength <= 0
    ) {
      throw new TypeError('bitmap baker returned an invalid artifact directory')
    }
    expectedOffset = checkedEnd(artifact.byteOffset, artifact.byteLength, artifactLength)
  }
  if (expectedOffset !== artifactLength) {
    throw new TypeError('bitmap baker artifact directory does not cover its payload')
  }
}

function isBitmapArtifactMetadata(value: unknown): value is BitmapArtifactMetadata {
  return (
    isNonArrayObject(value) &&
    (value.role === 'raster' || value.role === 'raster-page') &&
    typeof value.id === 'string' &&
    isHash(value.sha256) &&
    Number.isSafeInteger(value.byteOffset) &&
    Number.isSafeInteger(value.byteLength)
  )
}

function isRasterPayloadReport(value: unknown): value is RasterPayloadReport {
  return (
    isNonArrayObject(value) &&
    isNonnegativeSafeInteger(value.metadataBytes) &&
    isNonnegativeSafeInteger(value.serializedBytes) &&
    isNonnegativeSafeInteger(value.gpuBytes) &&
    Array.isArray(value.pages) &&
    value.pages.every(isRasterPagePayloadReport)
  )
}

function isRasterPagePayloadReport(value: unknown): value is RasterPagePayloadReport {
  return (
    isNonArrayObject(value) &&
    isPositiveSafeInteger(value.width) &&
    isPositiveSafeInteger(value.height) &&
    value.format === 'r8unorm' &&
    isPositiveSafeInteger(value.mipBytes) &&
    (value.source === 'embedded' || value.source === 'external') &&
    isPositiveSafeInteger(value.encodedBytes)
  )
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isHash(value: unknown): value is Sha256Hex {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function parseSerializedBakeError(value: unknown): SerializedBakeError {
  if (
    !isNonArrayObject(value) ||
    typeof value.code !== 'string' ||
    typeof value.message !== 'string' ||
    (value.path !== undefined && typeof value.path !== 'string')
  ) {
    throw new TypeError('bitmap baker returned invalid error metadata')
  }
  return {
    code: value.code,
    message: value.message,
    ...(value.path === undefined ? {} : { path: value.path }),
  }
}

function matchesAbiFunction(
  value: unknown,
  parameters: readonly string[],
  result?: string,
): value is AbiFunction {
  return (
    isNonArrayObject(value) &&
    typeof value.export === 'string' &&
    Array.isArray(value.parameters) &&
    value.parameters.length === parameters.length &&
    value.parameters.every((parameter, index) => parameter === parameters[index]) &&
    value.result === result
  )
}

function checkedEnd(start: number, length: number, limit: number): number {
  const end = start + length
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 0 || end > limit) {
    throw new TypeError('bitmap baker response range is outside its payload')
  }
  return end
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
