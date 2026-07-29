import type {
  BakeArtifactV0,
  RasterBakeArtifact,
  RasterPagePayloadReport,
  RasterPayloadReport,
  SerializedBakeError,
} from '../bake.js'
import type { RasterKey, Sha256Hex } from '../identity.js'

export interface AbiFunction {
  readonly export: string
  readonly parameters: readonly string[]
  readonly result?: string
}

export interface DirectRasterBakerAbi {
  readonly memory: string
  readonly functions: {
    readonly allocate: AbiFunction
    readonly deallocate: AbiFunction
    readonly bake: AbiFunction
    readonly responseByteLength: AbiFunction
  }
  readonly response: {
    readonly headerByteLength: number
    readonly headerAlignment: number
    readonly magic: string
    readonly magicOffset: number
    readonly statusOffset: number
    readonly metadataByteLengthOffset: number
    readonly artifactByteLengthOffset: number
    readonly payloadOffset: number
    readonly successStatus: number
  }
  readonly segmented?: {
    readonly chunkByteLength: number
    readonly unavailableStatus: number
    readonly functions: {
      readonly status: AbiFunction
      readonly metadataPointer: AbiFunction
      readonly metadataByteLength: AbiFunction
      readonly artifactCount: AbiFunction
      readonly artifactByteLength: AbiFunction
      readonly chunkPointer: AbiFunction
      readonly chunkByteLength: AbiFunction
      readonly release: AbiFunction
    }
  }
}

interface DirectRasterBakerExports {
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
  readonly segmented?: {
    readonly status: () => number
    readonly metadataPointer: () => number
    readonly metadataByteLength: () => number
    readonly artifactCount: () => number
    readonly artifactByteLength: (index: number) => number
    readonly chunkPointer: (index: number, offset: number) => number
    readonly chunkByteLength: (index: number, offset: number) => number
    readonly release: () => void
  }
}

interface ArtifactMetadata {
  readonly role: 'raster' | 'raster-page'
  readonly id: string
  readonly sha256: Sha256Hex
  readonly byteOffset: number
  readonly byteLength: number
}

interface ResultMetadata<Kind extends string> {
  readonly rasterKey: string
  readonly kind: Kind
  readonly extension: string
  readonly version: number
  readonly artifacts: readonly ArtifactMetadata[]
  readonly report: RasterPayloadReport
}

export interface DirectRasterBakerSpec<Kind extends string> {
  readonly label: string
  readonly kind: Kind
  readonly extension: string
  readonly version: number
  readonly pageFormat: string
  createError(error: SerializedBakeError): Error
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export async function instantiateWasm(
  source: BufferSource | WebAssembly.Module,
  imports: WebAssembly.Imports = {},
): Promise<WebAssembly.Instance> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
  return WebAssembly.instantiate(module, imports)
}

export function createDirectRasterBakerFromInstance<Request, Kind extends string>(
  instance: WebAssembly.Instance,
  abi: DirectRasterBakerAbi,
  spec: DirectRasterBakerSpec<Kind>,
): {
  bake(input: { readonly source: Uint8Array; readonly request: Request }): RasterBakeArtifact<Kind>
} {
  const exports = readExports(instance.exports, abi, spec.label)
  return {
    bake({ source, request }) {
      const requestBytes = textEncoder.encode(JSON.stringify(request))
      let sourcePointer = 0
      let requestPointer = 0
      let responsePointer = 0
      let responseLength = 0
      let segmentedResponse = false
      try {
        sourcePointer = copyIntoWasm(exports, source, spec.label)
        requestPointer = copyIntoWasm(exports, requestBytes, spec.label)
        responsePointer = u32(
          exports.bake(sourcePointer, source.byteLength, requestPointer, requestBytes.byteLength),
        )
        responseLength = u32(exports.responseLength())
        if (responsePointer === 0 && responseLength === 0 && exports.segmented !== undefined) {
          segmentedResponse = true
          return decodeSegmentedResponse(exports, abi, spec)
        }
        const response = memoryRange(exports.memory, responsePointer, responseLength, spec.label)
        return decodeResponse(response, abi, spec)
      } finally {
        if (sourcePointer !== 0) exports.deallocate(sourcePointer, source.byteLength)
        if (requestPointer !== 0) exports.deallocate(requestPointer, requestBytes.byteLength)
        if (responsePointer !== 0 && responseLength !== 0) {
          exports.deallocate(responsePointer, responseLength)
        }
        if (segmentedResponse) exports.segmented?.release()
      }
    },
  }
}

function readExports(
  wasmExports: WebAssembly.Exports,
  abi: DirectRasterBakerAbi,
  label: string,
): DirectRasterBakerExports {
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
    throw new TypeError(`invalid ${label} Wasm exports`)
  }
  const segmented = readSegmentedExports(wasmExports, abi, label)
  return {
    memory,
    allocate: allocate as DirectRasterBakerExports['allocate'],
    deallocate: deallocate as DirectRasterBakerExports['deallocate'],
    bake: bake as DirectRasterBakerExports['bake'],
    responseLength: responseLength as DirectRasterBakerExports['responseLength'],
    ...(segmented === undefined ? {} : { segmented }),
  }
}

function readSegmentedExports(
  wasmExports: WebAssembly.Exports,
  abi: DirectRasterBakerAbi,
  label: string,
): DirectRasterBakerExports['segmented'] {
  if (abi.segmented === undefined) return undefined
  const functions = abi.segmented.functions
  const values = {
    status: wasmExports[functions.status.export],
    metadataPointer: wasmExports[functions.metadataPointer.export],
    metadataByteLength: wasmExports[functions.metadataByteLength.export],
    artifactCount: wasmExports[functions.artifactCount.export],
    artifactByteLength: wasmExports[functions.artifactByteLength.export],
    chunkPointer: wasmExports[functions.chunkPointer.export],
    chunkByteLength: wasmExports[functions.chunkByteLength.export],
    release: wasmExports[functions.release.export],
  }
  if (Object.values(values).some((value) => typeof value !== 'function')) {
    throw new TypeError(`invalid ${label} segmented Wasm exports`)
  }
  return values as DirectRasterBakerExports['segmented']
}

function copyIntoWasm(exports: DirectRasterBakerExports, bytes: Uint8Array, label: string): number {
  const pointer = u32(exports.allocate(bytes.byteLength))
  if (pointer === 0 && bytes.byteLength !== 0) {
    throw new RangeError(`${label} Wasm allocation failed`)
  }
  try {
    memoryRange(exports.memory, pointer, bytes.byteLength, label).set(bytes)
    return pointer
  } catch (error) {
    if (pointer !== 0) exports.deallocate(pointer, bytes.byteLength)
    throw error
  }
}

function decodeSegmentedResponse<Kind extends string>(
  exports: DirectRasterBakerExports,
  abi: DirectRasterBakerAbi,
  spec: DirectRasterBakerSpec<Kind>,
): RasterBakeArtifact<Kind> {
  const contract = abi.segmented
  const segmented = exports.segmented
  if (contract === undefined || segmented === undefined) {
    throw new TypeError(`${spec.label} did not expose its declared segmented response`)
  }
  const status = u32(segmented.status())
  if (status === contract.unavailableStatus) {
    throw new TypeError(`${spec.label} returned neither a direct nor segmented response`)
  }
  const metadataLength = u32(segmented.metadataByteLength())
  const metadataPointer = u32(segmented.metadataPointer())
  if (metadataLength === 0 || metadataPointer === 0) {
    throw new TypeError(`${spec.label} returned empty segmented metadata`)
  }
  const metadata: unknown = JSON.parse(
    textDecoder.decode(memoryRange(exports.memory, metadataPointer, metadataLength, spec.label)),
  )
  if (status !== abi.response.successStatus)
    throw spec.createError(parseError(metadata, spec.label))

  const artifactCount = u32(segmented.artifactCount())
  if (
    !isNonArrayObject(metadata) ||
    !Array.isArray(metadata.artifacts) ||
    artifactCount !== metadata.artifacts.length
  ) {
    throw new TypeError(`${spec.label} segmented artifact count does not match its metadata`)
  }
  const artifactLengths = new Array<number>(artifactCount)
  let artifactLength = 0
  for (let index = 0; index < artifactCount; index += 1) {
    const length = u32(segmented.artifactByteLength(index))
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new TypeError(`${spec.label} returned an invalid segmented artifact length`)
    }
    artifactLengths[index] = length
    artifactLength = checkedEnd(artifactLength, length, Number.MAX_SAFE_INTEGER, spec.label)
  }
  assertResultMetadata(metadata, artifactLength, spec)
  const result = metadata
  const artifacts = result.artifacts.map<BakeArtifactV0>((artifact, index) => {
    const byteLength = artifactLengths[index]
    if (byteLength === undefined || byteLength !== artifact.byteLength) {
      throw new TypeError(`${spec.label} segmented artifact length does not match its directory`)
    }
    const bytes = new Uint8Array(byteLength)
    let offset = 0
    while (offset < byteLength) {
      const chunkLength = u32(segmented.chunkByteLength(index, offset))
      const chunkPointer = u32(segmented.chunkPointer(index, offset))
      const remaining = byteLength - offset
      if (
        chunkPointer === 0 ||
        !Number.isSafeInteger(chunkLength) ||
        chunkLength <= 0 ||
        chunkLength > contract.chunkByteLength ||
        chunkLength > remaining
      ) {
        throw new TypeError(`${spec.label} returned an invalid segmented artifact chunk`)
      }
      bytes.set(memoryRange(exports.memory, chunkPointer, chunkLength, spec.label), offset)
      offset += chunkLength
    }
    return {
      role: artifact.role,
      id: artifact.id,
      bytes,
      sha256: artifact.sha256,
    }
  })
  return {
    rasterKey: result.rasterKey as RasterKey,
    kind: result.kind,
    extension: result.extension,
    version: result.version,
    artifacts,
    report: result.report,
  }
}

function decodeResponse<Kind extends string>(
  response: Uint8Array,
  abi: DirectRasterBakerAbi,
  spec: DirectRasterBakerSpec<Kind>,
): RasterBakeArtifact<Kind> {
  const contract = abi.response
  if (response.byteLength < contract.headerByteLength) {
    throw new TypeError(`${spec.label} response is shorter than its ABI header`)
  }
  if (
    textDecoder.decode(
      response.subarray(contract.magicOffset, contract.magicOffset + contract.magic.length),
    ) !== contract.magic
  ) {
    throw new TypeError(`${spec.label} response magic does not match its ABI`)
  }
  const view = new DataView(response.buffer, response.byteOffset, response.byteLength)
  const status = view.getUint32(contract.statusOffset, true)
  const metadataLength = view.getUint32(contract.metadataByteLengthOffset, true)
  const artifactLength = view.getUint32(contract.artifactByteLengthOffset, true)
  const metadataStart = contract.payloadOffset
  const metadataEnd = checkedEnd(metadataStart, metadataLength, response.byteLength, spec.label)
  const artifactEnd = checkedEnd(metadataEnd, artifactLength, response.byteLength, spec.label)
  if (artifactEnd !== response.byteLength) {
    throw new TypeError(`${spec.label} response carries undeclared trailing bytes`)
  }
  const metadata: unknown = JSON.parse(
    textDecoder.decode(response.subarray(metadataStart, metadataEnd)),
  )
  if (status !== contract.successStatus) throw spec.createError(parseError(metadata, spec.label))
  assertResultMetadata(metadata, artifactLength, spec)
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

function assertResultMetadata<Kind extends string>(
  result: unknown,
  artifactLength: number,
  spec: DirectRasterBakerSpec<Kind>,
): asserts result is ResultMetadata<Kind> {
  if (
    !isNonArrayObject(result) ||
    result.kind !== spec.kind ||
    result.extension !== spec.extension ||
    result.version !== spec.version ||
    !isHash(result.rasterKey) ||
    !Array.isArray(result.artifacts) ||
    !isRasterPayloadReport(result.report, spec.pageFormat)
  ) {
    throw new TypeError(`${spec.label} returned invalid result metadata`)
  }
  let expectedOffset = 0
  for (const artifact of result.artifacts) {
    if (
      !isArtifactMetadata(artifact) ||
      artifact.id.length === 0 ||
      artifact.byteOffset !== expectedOffset ||
      artifact.byteLength <= 0
    ) {
      throw new TypeError(`${spec.label} returned an invalid artifact directory`)
    }
    expectedOffset = checkedEnd(
      artifact.byteOffset,
      artifact.byteLength,
      artifactLength,
      spec.label,
    )
  }
  if (expectedOffset !== artifactLength) {
    throw new TypeError(`${spec.label} artifact directory does not cover its payload`)
  }
}

function isArtifactMetadata(value: unknown): value is ArtifactMetadata {
  return (
    isNonArrayObject(value) &&
    (value.role === 'raster' || value.role === 'raster-page') &&
    typeof value.id === 'string' &&
    isHash(value.sha256) &&
    Number.isSafeInteger(value.byteOffset) &&
    Number.isSafeInteger(value.byteLength)
  )
}

function isRasterPayloadReport(value: unknown, pageFormat: string): value is RasterPayloadReport {
  return (
    isNonArrayObject(value) &&
    isNonnegativeSafeInteger(value.metadataBytes) &&
    isNonnegativeSafeInteger(value.serializedBytes) &&
    isNonnegativeSafeInteger(value.gpuBytes) &&
    Array.isArray(value.pages) &&
    value.pages.every((page) => isRasterPagePayloadReport(page, pageFormat))
  )
}

function isRasterPagePayloadReport(
  value: unknown,
  pageFormat: string,
): value is RasterPagePayloadReport {
  return (
    isNonArrayObject(value) &&
    isPositiveSafeInteger(value.width) &&
    isPositiveSafeInteger(value.height) &&
    value.format === pageFormat &&
    isPositiveSafeInteger(value.gpuBytes) &&
    (value.source === 'embedded' || value.source === 'external') &&
    isPositiveSafeInteger(value.encodedBytes)
  )
}

function parseError(value: unknown, label: string): SerializedBakeError {
  if (
    !isNonArrayObject(value) ||
    typeof value.code !== 'string' ||
    typeof value.message !== 'string' ||
    (value.path !== undefined && typeof value.path !== 'string')
  ) {
    throw new TypeError(`${label} returned invalid error metadata`)
  }
  return {
    code: value.code,
    message: value.message,
    ...(value.path === undefined ? {} : { path: value.path }),
  }
}

function u32(value: number): number {
  return value >>> 0
}

function memoryRange(
  memory: WebAssembly.Memory,
  pointer: number,
  length: number,
  label: string,
): Uint8Array {
  const end = pointer + length
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    pointer < 0 ||
    length < 0 ||
    !Number.isSafeInteger(end) ||
    end > memory.buffer.byteLength
  ) {
    throw new TypeError(`${label} memory range is outside linear memory`)
  }
  return new Uint8Array(memory.buffer, pointer, length)
}

function checkedEnd(start: number, length: number, limit: number, label: string): number {
  const end = start + length
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !Number.isSafeInteger(end) ||
    end > limit
  ) {
    throw new TypeError(`${label} response range is outside its payload`)
  }
  return end
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

export function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
