export type MtsdfGeneratorWasmSource = BufferSource | WebAssembly.Module

export type MtsdfOutlineCommand =
  | Readonly<{ kind: 'move'; x: number; y: number }>
  | Readonly<{ kind: 'line'; x: number; y: number }>
  | Readonly<{ kind: 'quadratic'; controlX: number; controlY: number; x: number; y: number }>
  | Readonly<{
      kind: 'cubic'
      control0X: number
      control0Y: number
      control1X: number
      control1Y: number
      x: number
      y: number
    }>
  | Readonly<{ kind: 'close' }>

export interface MtsdfGlyphRequest {
  readonly unitsPerEm: number
  readonly bounds: Readonly<{
    minX: number
    minY: number
    maxX: number
    maxY: number
  }>
  readonly region: Readonly<{
    innerWidth: number
    innerHeight: number
    paddingX: number
    paddingY: number
  }>
  readonly commands: readonly MtsdfOutlineCommand[]
}

export interface MtsdfGlyph {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

export interface MtsdfGenerator {
  generate(request: MtsdfGlyphRequest): MtsdfGlyph
}

export interface MtsdfGeneratorAbiV1 {
  readonly name: 'pmndrs-text-mtsdf-baker'
  readonly version: 1
  readonly endianness: 'little'
  readonly pointerWidth: 32
  readonly memory: 'memory'
  readonly functions: {
    readonly allocate: 'pmndrs_text_mtsdf_alloc'
    readonly deallocate: 'pmndrs_text_mtsdf_dealloc'
    readonly generate: 'pmndrs_text_mtsdf_generate'
    readonly resultPointer: 'pmndrs_text_mtsdf_result_ptr'
    readonly resultLength: 'pmndrs_text_mtsdf_result_len'
    readonly abiPointer: 'pmndrs_text_mtsdf_abi_ptr'
    readonly abiLength: 'pmndrs_text_mtsdf_abi_len'
  }
  readonly layouts: {
    readonly request: {
      readonly size: 48
      readonly byteLength: 0
      readonly commandsOffset: 4
      readonly commandCount: 8
      readonly unitsPerEm: 12
      readonly minX: 16
      readonly minY: 20
      readonly maxX: 24
      readonly maxY: 28
      readonly innerWidth: 32
      readonly innerHeight: 36
      readonly paddingX: 40
      readonly paddingY: 44
    }
    readonly command: {
      readonly size: 28
      readonly opcode: 0
      readonly x0: 4
      readonly y0: 8
      readonly x1: 12
      readonly y1: 16
      readonly x2: 20
      readonly y2: 24
    }
  }
  readonly commands: {
    readonly move: 0
    readonly line: 1
    readonly quadratic: 2
    readonly cubic: 3
    readonly close: 4
  }
  readonly output: {
    readonly format: 'rgba8'
    readonly order: 'row-major-top-down'
    readonly ownership: 'borrowed-until-next-generate'
  }
  readonly status: {
    readonly ok: 0
    readonly invalidRequest: 1
    readonly invalidOutline: 2
    readonly generationFailed: 3
  }
  readonly artifactBaker?: unknown
}

export type MtsdfGenerationErrorCode = 'INVALID_REQUEST' | 'INVALID_OUTLINE' | 'GENERATION_FAILED'

export class MtsdfGenerationError extends Error {
  readonly code: MtsdfGenerationErrorCode

  constructor(code: MtsdfGenerationErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'MTSDF generator rejected its wire request'
        : code === 'INVALID_OUTLINE'
          ? 'MTSDF generator rejected the glyph outline'
          : 'MTSDF generation failed',
    )
    this.name = 'MtsdfGenerationError'
    this.code = code
  }
}

interface MtsdfGeneratorExports {
  readonly memory: WebAssembly.Memory
  readonly allocate: (length: number) => number
  readonly deallocate: (pointer: number, length: number) => void
  readonly generate: (pointer: number, length: number) => number
  readonly resultPointer: () => number
  readonly resultLength: () => number
}

const MAX_REQUEST_BYTES = 64 * 1024 * 1024
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export async function createMtsdfGenerator(
  source: MtsdfGeneratorWasmSource,
): Promise<MtsdfGenerator> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
  return createMtsdfGeneratorFromInstance(await WebAssembly.instantiate(module, {}))
}

export function createMtsdfGeneratorFromInstance(instance: WebAssembly.Instance): MtsdfGenerator {
  const abi = readMtsdfGeneratorAbi(instance)
  const exports = readExports(instance.exports, abi)
  return {
    generate(request) {
      const encoded = encodeRequest(request, abi)
      const pointer = exports.allocate(encoded.byteLength)
      if (pointer === 0) throw new RangeError('MTSDF generator Wasm allocation failed')
      try {
        copyToMemory(exports.memory, pointer, encoded)
        const status = exports.generate(pointer, encoded.byteLength)
        if (status !== abi.status.ok) throw new MtsdfGenerationError(statusCode(status, abi))

        const width = checkedDimension(request.region.innerWidth, request.region.paddingX, 'width')
        const height = checkedDimension(
          request.region.innerHeight,
          request.region.paddingY,
          'height',
        )
        const expectedLength = checkedProduct(width, height, 4)
        const resultPointer = exports.resultPointer()
        const resultLength = exports.resultLength()
        if (resultLength !== expectedLength) {
          throw new TypeError('MTSDF generator returned an unexpected RGBA8 byte length')
        }
        return {
          width,
          height,
          rgba: copyFromMemory(exports.memory, resultPointer, resultLength),
        }
      } finally {
        exports.deallocate(pointer, encoded.byteLength)
      }
    },
  }
}

export function readMtsdfGeneratorAbi(instance: WebAssembly.Instance): MtsdfGeneratorAbiV1 {
  const pointer = readBootstrap(instance.exports, 'pmndrs_text_mtsdf_abi_ptr')()
  const length = readBootstrap(instance.exports, 'pmndrs_text_mtsdf_abi_len')()
  const memory = instance.exports.memory
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new TypeError('MTSDF generator ABI bootstrap is missing linear memory')
  }
  const value: unknown = JSON.parse(textDecoder.decode(memoryRange(memory, pointer, length)))
  assertMtsdfGeneratorAbi(value)
  return value
}

function encodeRequest(request: MtsdfGlyphRequest, abi: MtsdfGeneratorAbiV1): Uint8Array {
  validateRequest(request)
  const requestLayout = abi.layouts.request
  const commandLayout = abi.layouts.command
  const byteLength = checkedSum(
    requestLayout.size,
    checkedProduct(request.commands.length, commandLayout.size),
  )
  if (byteLength > MAX_REQUEST_BYTES) throw new RangeError('MTSDF request exceeds 64 MiB')

  const bytes = new Uint8Array(byteLength)
  const view = new DataView(bytes.buffer)
  const setU32 = (offset: number, value: number) => view.setUint32(offset, value, true)
  const setF32 = (offset: number, value: number) => view.setFloat32(offset, value, true)
  setU32(requestLayout.byteLength, byteLength)
  setU32(requestLayout.commandsOffset, requestLayout.size)
  setU32(requestLayout.commandCount, request.commands.length)
  setF32(requestLayout.unitsPerEm, request.unitsPerEm)
  setF32(requestLayout.minX, request.bounds.minX)
  setF32(requestLayout.minY, request.bounds.minY)
  setF32(requestLayout.maxX, request.bounds.maxX)
  setF32(requestLayout.maxY, request.bounds.maxY)
  setU32(requestLayout.innerWidth, request.region.innerWidth)
  setU32(requestLayout.innerHeight, request.region.innerHeight)
  setU32(requestLayout.paddingX, request.region.paddingX)
  setU32(requestLayout.paddingY, request.region.paddingY)

  for (const [index, command] of request.commands.entries()) {
    const offset = requestLayout.size + index * commandLayout.size
    switch (command.kind) {
      case 'move':
      case 'line':
        setU32(offset + commandLayout.opcode, abi.commands[command.kind])
        setF32(offset + commandLayout.x0, command.x)
        setF32(offset + commandLayout.y0, command.y)
        break
      case 'quadratic':
        setU32(offset + commandLayout.opcode, abi.commands.quadratic)
        setF32(offset + commandLayout.x0, command.controlX)
        setF32(offset + commandLayout.y0, command.controlY)
        setF32(offset + commandLayout.x1, command.x)
        setF32(offset + commandLayout.y1, command.y)
        break
      case 'cubic':
        setU32(offset + commandLayout.opcode, abi.commands.cubic)
        setF32(offset + commandLayout.x0, command.control0X)
        setF32(offset + commandLayout.y0, command.control0Y)
        setF32(offset + commandLayout.x1, command.control1X)
        setF32(offset + commandLayout.y1, command.control1Y)
        setF32(offset + commandLayout.x2, command.x)
        setF32(offset + commandLayout.y2, command.y)
        break
      case 'close':
        setU32(offset + commandLayout.opcode, abi.commands.close)
        break
    }
  }
  return bytes
}

function validateRequest(request: MtsdfGlyphRequest): void {
  if (!Number.isFinite(request.unitsPerEm) || request.unitsPerEm <= 0) {
    throw new RangeError('MTSDF unitsPerEm must be finite and positive')
  }
  const { minX, minY, maxX, maxY } = request.bounds
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
    throw new RangeError('MTSDF bounds must be finite and non-empty')
  }
  checkedDimension(request.region.innerWidth, request.region.paddingX, 'width')
  checkedDimension(request.region.innerHeight, request.region.paddingY, 'height')
  if (request.commands.length === 0) throw new RangeError('MTSDF outline must not be empty')
  for (const command of request.commands) {
    const coordinates =
      command.kind === 'close'
        ? []
        : command.kind === 'move' || command.kind === 'line'
          ? [command.x, command.y]
          : command.kind === 'quadratic'
            ? [command.controlX, command.controlY, command.x, command.y]
            : [
                command.control0X,
                command.control0Y,
                command.control1X,
                command.control1Y,
                command.x,
                command.y,
              ]
    if (!coordinates.every(Number.isFinite)) {
      throw new RangeError('MTSDF outline coordinates must be finite')
    }
  }
}

function checkedDimension(inner: number, padding: number, label: string): number {
  if (!Number.isSafeInteger(inner) || inner <= 0) {
    throw new RangeError(`MTSDF inner ${label} must be a positive safe integer`)
  }
  if (!Number.isSafeInteger(padding) || padding < 0) {
    throw new RangeError(`MTSDF ${label} padding must be a nonnegative safe integer`)
  }
  return checkedSum(inner, checkedProduct(padding, 2))
}

function readExports(
  wasmExports: WebAssembly.Exports,
  abi: MtsdfGeneratorAbiV1,
): MtsdfGeneratorExports {
  const memory = wasmExports[abi.memory]
  const allocate = wasmExports[abi.functions.allocate]
  const deallocate = wasmExports[abi.functions.deallocate]
  const generate = wasmExports[abi.functions.generate]
  const resultPointer = wasmExports[abi.functions.resultPointer]
  const resultLength = wasmExports[abi.functions.resultLength]
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof allocate !== 'function' ||
    typeof deallocate !== 'function' ||
    typeof generate !== 'function' ||
    typeof resultPointer !== 'function' ||
    typeof resultLength !== 'function'
  ) {
    throw new TypeError('invalid MTSDF generator Wasm exports')
  }
  return {
    memory,
    allocate: allocate as MtsdfGeneratorExports['allocate'],
    deallocate: deallocate as MtsdfGeneratorExports['deallocate'],
    generate: generate as MtsdfGeneratorExports['generate'],
    resultPointer: resultPointer as MtsdfGeneratorExports['resultPointer'],
    resultLength: resultLength as MtsdfGeneratorExports['resultLength'],
  }
}

function statusCode(status: number, abi: MtsdfGeneratorAbiV1): MtsdfGenerationErrorCode {
  if (status === abi.status.invalidRequest) return 'INVALID_REQUEST'
  if (status === abi.status.invalidOutline) return 'INVALID_OUTLINE'
  return 'GENERATION_FAILED'
}

function copyToMemory(memory: WebAssembly.Memory, pointer: number, bytes: Uint8Array): void {
  memoryRange(memory, pointer, bytes.byteLength).set(bytes)
}

function copyFromMemory(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  return memoryRange(memory, pointer, length).slice()
}

function memoryRange(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    pointer < 0 ||
    length < 0 ||
    pointer + length > memory.buffer.byteLength
  ) {
    throw new TypeError('MTSDF generator memory range is outside linear memory')
  }
  return new Uint8Array(memory.buffer, pointer, length)
}

function readBootstrap(wasmExports: WebAssembly.Exports, name: string): () => number {
  const value = wasmExports[name]
  if (typeof value !== 'function') throw new TypeError(`MTSDF generator ABI is missing ${name}`)
  return value as () => number
}

function checkedProduct(...values: number[]): number {
  const product = values.reduce((result, value) => result * value, 1)
  if (!Number.isSafeInteger(product) || product < 0) {
    throw new RangeError('MTSDF byte length exceeds JavaScript safe integers')
  }
  return product
}

function checkedSum(...values: number[]): number {
  const sum = values.reduce((result, value) => result + value, 0)
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new RangeError('MTSDF byte length exceeds JavaScript safe integers')
  }
  return sum
}

function assertMtsdfGeneratorAbi(value: unknown): asserts value is MtsdfGeneratorAbiV1 {
  if (!isNonArrayObject(value)) throw new TypeError('unsupported MTSDF generator ABI')
  const { functions, layouts, commands, output, status } = value
  if (
    value.name !== 'pmndrs-text-mtsdf-baker' ||
    value.version !== 1 ||
    value.endianness !== 'little' ||
    value.pointerWidth !== 32 ||
    value.memory !== 'memory' ||
    !matchesExactObject(functions, {
      allocate: 'pmndrs_text_mtsdf_alloc',
      deallocate: 'pmndrs_text_mtsdf_dealloc',
      generate: 'pmndrs_text_mtsdf_generate',
      resultPointer: 'pmndrs_text_mtsdf_result_ptr',
      resultLength: 'pmndrs_text_mtsdf_result_len',
      abiPointer: 'pmndrs_text_mtsdf_abi_ptr',
      abiLength: 'pmndrs_text_mtsdf_abi_len',
    }) ||
    !isNonArrayObject(layouts) ||
    !matchesExactObject(layouts.request, {
      size: 48,
      byteLength: 0,
      commandsOffset: 4,
      commandCount: 8,
      unitsPerEm: 12,
      minX: 16,
      minY: 20,
      maxX: 24,
      maxY: 28,
      innerWidth: 32,
      innerHeight: 36,
      paddingX: 40,
      paddingY: 44,
    }) ||
    !matchesExactObject(layouts.command, {
      size: 28,
      opcode: 0,
      x0: 4,
      y0: 8,
      x1: 12,
      y1: 16,
      x2: 20,
      y2: 24,
    }) ||
    !matchesExactObject(commands, { move: 0, line: 1, quadratic: 2, cubic: 3, close: 4 }) ||
    !matchesExactObject(output, {
      format: 'rgba8',
      order: 'row-major-top-down',
      ownership: 'borrowed-until-next-generate',
    }) ||
    !matchesExactObject(status, {
      ok: 0,
      invalidRequest: 1,
      invalidOutline: 2,
      generationFailed: 3,
    }) ||
    (value.artifactBaker !== undefined && !isNonArrayObject(value.artifactBaker))
  ) {
    throw new TypeError('unsupported MTSDF generator ABI')
  }
}

function matchesExactObject(
  value: unknown,
  expected: Readonly<Record<string, string | number>>,
): boolean {
  if (!isNonArrayObject(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === Object.keys(expected).length &&
    keys.every((key) => Object.hasOwn(expected, key) && value[key] === expected[key])
  )
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
