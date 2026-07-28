import type { RegisteredFont } from './font.js'
import { textShaperAbi } from './generated/text-shaper-abi.js'
import type { FontHandle } from './identity.js'
import { getRegisteredFontData } from './internal/registered-font.js'
import { FontRegistry } from './loader.js'
import type { ResolvedFontFeature } from './text.js'

export type TextShaperWasmSource = BufferSource | WebAssembly.Module

export interface RuntimeShaperOptions {
  readonly registry?: FontRegistry
  readonly wasm?: TextShaperWasmSource
}

export interface RuntimeShaperMemoryReport {
  readonly fontCount: number
  readonly retainedFontBytes: number
  readonly planCount: number
  readonly wasmMemoryBytes: number
}

export interface ShapeRunRequest {
  readonly font: FontHandle
  readonly textStart: number
  readonly textEnd: number
  readonly direction: 'ltr' | 'rtl'
  readonly script: string
  readonly language?: string
  readonly clusterLevel: 0 | 1 | 2 | 3
  readonly flags: number
  readonly featureStart: number
  readonly featureCount: number
}

export interface ShapeBatchRequest {
  readonly textUtf16: Uint16Array
  readonly runs: readonly ShapeRunRequest[]
  readonly features: readonly ResolvedFontFeature[]
}

export interface ReshapeRange {
  readonly run: number
  readonly itemStart: number
  readonly itemEnd: number
  readonly contextStart: number
  readonly contextEnd: number
  readonly flags: number
}

export interface ReshapeBatchRequest extends ShapeBatchRequest {
  readonly ranges: readonly ReshapeRange[]
}

export interface ShapedBatchViews {
  readonly fontHandles: Uint32Array
  readonly runFontSlots: Uint16Array
  readonly runGlyphStarts: Uint32Array
  readonly runGlyphCounts: Uint32Array
  readonly glyphIds: Uint16Array
  readonly clusters: Uint32Array
  readonly xAdvances: Int32Array
  readonly yAdvances: Int32Array
  readonly xOffsets: Int32Array
  readonly yOffsets: Int32Array
  readonly glyphFlags: Uint16Array
}

export type BidiDirection = 'auto' | 'ltr' | 'rtl'

/** Borrowed direct-memory UAX #9 output, indexed by UTF-16 code unit. */
export interface BidiAnalysisViews {
  readonly levels: Uint8Array
  readonly classes: Uint8Array
  readonly paragraphStarts: Uint32Array
  readonly paragraphEnds: Uint32Array
  readonly paragraphLevels: Uint8Array
}

export interface RuntimeShaper {
  readonly registry: FontRegistry
  registerFont(font: RegisteredFont): void
  disposeFont(font: RegisteredFont): void
  analyzeBidi(textUtf16: Uint16Array, direction?: BidiDirection): BidiAnalysisViews
  shapeBatch(request: ShapeBatchRequest): ShapedBatchViews
  reshapeRanges(request: ReshapeBatchRequest): ShapedBatchViews
  memoryReport(): RuntimeShaperMemoryReport
  dispose(): void
}

interface LayoutBase {
  readonly size: number
  readonly alignment: number
  readonly [field: string]: number
}

interface ShapeRequestLayout extends LayoutBase {
  readonly textOffset: number
  readonly textLength: number
  readonly runsOffset: number
  readonly runCount: number
  readonly featuresOffset: number
  readonly featureCount: number
  readonly languagesOffset: number
  readonly languagesLength: number
}

interface ReshapeRequestLayout extends LayoutBase {
  readonly rangesOffset: number
  readonly rangeCount: number
}

interface BidiRequestLayout extends LayoutBase {
  readonly textOffset: number
  readonly textLength: number
  readonly direction: number
}

interface FeatureLayout extends LayoutBase {
  readonly tag: number
  readonly value: number
  readonly start: number
  readonly end: number
}

interface RunLayout extends LayoutBase {
  readonly fontHandle: number
  readonly textStart: number
  readonly textEnd: number
  readonly script: number
  readonly languageOffset: number
  readonly featureStart: number
  readonly featureCount: number
  readonly direction: number
  readonly clusterLevel: number
  readonly flags: number
}

interface ReshapeRangeLayout extends LayoutBase {
  readonly run: number
  readonly itemStart: number
  readonly itemEnd: number
  readonly contextStart: number
  readonly contextEnd: number
  readonly flags: number
}

interface ResultLayout extends LayoutBase {
  readonly byteLength: number
  readonly fontHandlesOffset: number
  readonly fontHandleCount: number
  readonly runFontSlotsOffset: number
  readonly runGlyphStartsOffset: number
  readonly runGlyphCountsOffset: number
  readonly runCount: number
  readonly glyphIdsOffset: number
  readonly clustersOffset: number
  readonly xAdvancesOffset: number
  readonly yAdvancesOffset: number
  readonly xOffsetsOffset: number
  readonly yOffsetsOffset: number
  readonly glyphFlagsOffset: number
  readonly glyphCount: number
}

interface BidiResultLayout extends LayoutBase {
  readonly byteLength: number
  readonly levelsOffset: number
  readonly classesOffset: number
  readonly textLength: number
  readonly paragraphStartsOffset: number
  readonly paragraphEndsOffset: number
  readonly paragraphLevelsOffset: number
  readonly paragraphCount: number
}

interface ShaperAbiLayouts {
  readonly shapeRequest: ShapeRequestLayout
  readonly reshapeRequest: ReshapeRequestLayout
  readonly bidiRequest: BidiRequestLayout
  readonly feature: FeatureLayout
  readonly run: RunLayout
  readonly reshapeRange: ReshapeRangeLayout
  readonly result: ResultLayout
  readonly bidiResult: BidiResultLayout
}

interface ShaperExports {
  readonly memory: WebAssembly.Memory
  readonly allocate: (length: number) => number
  readonly deallocate: (pointer: number, length: number) => void
  readonly registerFont: (
    handle: number,
    sfntPointer: number,
    sfntLength: number,
    extentsPointer: number,
    extentsLength: number,
    availabilityPointer: number,
    availabilityLength: number,
  ) => number
  readonly disposeFont: (handle: number) => number
  readonly fontCount: () => number
  readonly retainedFontBytes: () => number
  readonly planCount: () => number
  readonly shapeBatch: (pointer: number, length: number) => number
  readonly reshapeRanges: (pointer: number, length: number) => number
  readonly analyzeBidi: (pointer: number, length: number) => number
  readonly resultPointer: () => number
  readonly resultLength: () => number
}

interface ShaperModule {
  readonly exports: ShaperExports
  readonly layouts: ShaperAbiLayouts
}

const encoder = new TextEncoder()
const noLanguage = 0xffff_ffff
const bufferFlagsMask = 0xff

export async function createRuntimeShaper(
  options: RuntimeShaperOptions = {},
): Promise<RuntimeShaper> {
  const source = options.wasm ?? (await fetchDefaultWasm())
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
  const instance = await WebAssembly.instantiate(module, {})
  const resolved = readModule(instance)
  return new RuntimeShaperImpl(options.registry ?? new FontRegistry(), resolved)
}

class RuntimeShaperImpl implements RuntimeShaper {
  readonly registry: FontRegistry
  readonly #exports: ShaperExports
  readonly #layouts: ShaperAbiLayouts
  readonly #registered = new Map<FontHandle, RegisteredFont>()
  readonly #unsubscribe: () => void
  #disposed = false

  constructor(registry: FontRegistry, module: ShaperModule) {
    this.registry = registry
    this.#exports = module.exports
    this.#layouts = module.layouts
    this.#unsubscribe = registry._onFontDispose((font) => this.#disposeHandle(font.handle))
  }

  registerFont(font: RegisteredFont): void {
    this.#assertActive()
    if (this.registry.getByHandle(font.handle) !== font) {
      throw new TypeError("font is not active in this shaper's registry")
    }
    if (this.#registered.get(font.handle) === font) return
    const data = getRegisteredFontData(font)
    let sfnt: { readonly pointer: number; readonly length: number } | undefined
    let extents: { readonly pointer: number; readonly length: number } | undefined
    let availability: { readonly pointer: number; readonly length: number } | undefined
    try {
      sfnt = copyIntoWasm(this.#exports, data.shapingSfnt)
      extents = copyIntoWasm(this.#exports, data.glyphExtents)
      availability = copyIntoWasm(this.#exports, data.glyphExtentsAvailability)
      const status = this.#exports.registerFont(
        font.handle,
        sfnt.pointer,
        sfnt.length,
        extents.pointer,
        extents.length,
        availability.pointer,
        availability.length,
      )
      if (status !== 0) throw shaperStatusError(status, 'register font')
      this.#registered.set(font.handle, font)
    } finally {
      if (availability !== undefined) {
        this.#exports.deallocate(availability.pointer, availability.length)
      }
      if (extents !== undefined) this.#exports.deallocate(extents.pointer, extents.length)
      if (sfnt !== undefined) this.#exports.deallocate(sfnt.pointer, sfnt.length)
    }
  }

  disposeFont(font: RegisteredFont): void {
    this.#assertActive()
    if (this.#registered.get(font.handle) === font) this.#disposeHandle(font.handle)
  }

  analyzeBidi(textUtf16: Uint16Array, direction: BidiDirection = 'auto'): BidiAnalysisViews {
    this.#assertActive()
    const bytes = packBidiRequest(this.#layouts.bidiRequest, textUtf16, direction)
    const allocation = copyIntoWasm(this.#exports, bytes)
    try {
      const status = this.#exports.analyzeBidi(allocation.pointer, allocation.length)
      if (status !== 0) throw shaperStatusError(status, 'analyze bidi text')
      return readBidiResultViews(this.#exports, this.#layouts.bidiResult)
    } finally {
      this.#exports.deallocate(allocation.pointer, allocation.length)
    }
  }

  shapeBatch(request: ShapeBatchRequest): ShapedBatchViews {
    this.#assertActive()
    this.#assertFontsRegistered(request.runs)
    return this.#call(request, undefined)
  }

  reshapeRanges(request: ReshapeBatchRequest): ShapedBatchViews {
    this.#assertActive()
    this.#assertFontsRegistered(request.runs)
    return this.#call(request, request.ranges)
  }

  memoryReport(): RuntimeShaperMemoryReport {
    this.#assertActive()
    return {
      fontCount: this.#exports.fontCount(),
      retainedFontBytes: this.#exports.retainedFontBytes(),
      planCount: this.#exports.planCount(),
      wasmMemoryBytes: this.#exports.memory.buffer.byteLength,
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#unsubscribe()
    for (const handle of [...this.#registered.keys()]) this.#disposeHandle(handle)
    this.#disposed = true
  }

  #call(request: ShapeBatchRequest, ranges: readonly ReshapeRange[] | undefined): ShapedBatchViews {
    const bytes = packRequest(this.#layouts, request, ranges)
    const allocation = copyIntoWasm(this.#exports, bytes)
    try {
      const status =
        ranges === undefined
          ? this.#exports.shapeBatch(allocation.pointer, allocation.length)
          : this.#exports.reshapeRanges(allocation.pointer, allocation.length)
      if (status !== 0) {
        throw shaperStatusError(status, ranges === undefined ? 'shape batch' : 'reshape ranges')
      }
      return readResultViews(this.#exports, this.#layouts.result)
    } finally {
      this.#exports.deallocate(allocation.pointer, allocation.length)
    }
  }

  #assertFontsRegistered(runs: readonly ShapeRunRequest[]): void {
    for (const run of runs) {
      if (!this.#registered.has(run.font)) {
        throw new TypeError(`font handle ${run.font} is not registered with this shaper`)
      }
    }
  }

  #disposeHandle(handle: FontHandle): void {
    if (!this.#registered.delete(handle)) return
    const status = this.#exports.disposeFont(handle)
    if (status !== 0 && status !== 5) throw shaperStatusError(status, 'dispose font')
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('runtime shaper is disposed')
  }
}

async function fetchDefaultWasm(): Promise<ArrayBuffer> {
  const response = await fetch(new URL('./text_shaper.wasm', import.meta.url))
  if (!response.ok) {
    throw new Error(`text shaper Wasm request failed with HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

function readModule(instance: WebAssembly.Instance): ShaperModule {
  const memory = instance.exports.memory
  if (!(memory instanceof WebAssembly.Memory)) throw new TypeError('text shaper is missing memory')
  const functions = textShaperAbi.functions
  return {
    exports: {
      memory,
      allocate: exportedFunction(instance, functions.allocate),
      deallocate: exportedFunction(instance, functions.deallocate),
      registerFont: exportedFunction(instance, functions.registerFont),
      disposeFont: exportedFunction(instance, functions.disposeFont),
      fontCount: exportedFunction(instance, functions.fontCount),
      retainedFontBytes: exportedFunction(instance, functions.retainedFontBytes),
      planCount: exportedFunction(instance, functions.planCount),
      shapeBatch: exportedFunction(instance, functions.shapeBatch),
      reshapeRanges: exportedFunction(instance, functions.reshapeRanges),
      analyzeBidi: exportedFunction(instance, functions.analyzeBidi),
      resultPointer: exportedFunction(instance, functions.resultPointer),
      resultLength: exportedFunction(instance, functions.resultLength),
    },
    layouts: textShaperAbi.layouts,
  }
}

function packBidiRequest(
  layout: BidiRequestLayout,
  textUtf16: Uint16Array,
  direction: BidiDirection,
): Uint8Array {
  if (!(textUtf16 instanceof Uint16Array)) {
    throw new TypeError('bidi textUtf16 must be a Uint16Array')
  }
  const directions: Readonly<Record<BidiDirection, number>> = { auto: 0, ltr: 1, rtl: 2 }
  const directionCode = directions[direction]
  if (directionCode === undefined) throw new RangeError('bidi direction must be auto, ltr, or rtl')
  uint32(textUtf16.length, 'bidi text UTF-16 length')
  const textOffset = align(layout.size, 2)
  const bytes = new Uint8Array(
    checkedAdd(textOffset, checkedMultiply(textUtf16.length, 2, 'bidi text bytes')),
  )
  const view = new DataView(bytes.buffer)
  writeUint32(view, layout.textOffset, textOffset)
  writeUint32(view, layout.textLength, textUtf16.length)
  view.setUint8(layout.direction, directionCode)
  for (let index = 0; index < textUtf16.length; index += 1) {
    view.setUint16(textOffset + index * 2, textUtf16[index]!, true)
  }
  return bytes
}

function packRequest(
  layouts: ShaperAbiLayouts,
  request: ShapeBatchRequest,
  ranges: readonly ReshapeRange[] | undefined,
): Uint8Array {
  if (!(request.textUtf16 instanceof Uint16Array)) {
    throw new TypeError('shape textUtf16 must be a Uint16Array')
  }
  if (request.runs.length === 0) throw new RangeError('shape batch must contain a run')
  if (ranges !== undefined && ranges.length === 0) {
    throw new RangeError('reshape batch must contain a range')
  }
  uint32(request.textUtf16.length, 'text UTF-16 length')
  uint32(request.runs.length, 'run count')
  uint32(request.features.length, 'feature count')
  if (ranges !== undefined) uint32(ranges.length, 'reshape range count')

  const languages = new Map<string, number>()
  const languageBytes: number[] = []
  for (const run of request.runs) {
    if (run.language === undefined || languages.has(run.language)) continue
    const bytes = encoder.encode(run.language)
    if (bytes.length === 0 || bytes.length > 0xffff) {
      throw new RangeError('shape language must encode to 1..65535 UTF-8 bytes')
    }
    const offset = languageBytes.length
    uint32(offset, 'language offset')
    languages.set(run.language, offset)
    languageBytes.push(bytes.length & 0xff, bytes.length >>> 8, ...bytes)
  }

  const header = ranges === undefined ? layouts.shapeRequest : layouts.reshapeRequest
  let length = header.size
  const textOffset = align(length, 2)
  length = checkedAdd(textOffset, checkedMultiply(request.textUtf16.length, 2, 'text bytes'))
  const runsOffset = align(length, 4)
  length = checkedAdd(
    runsOffset,
    checkedMultiply(request.runs.length, layouts.run.size, 'run bytes'),
  )
  const featuresOffset = align(length, 4)
  length = checkedAdd(
    featuresOffset,
    checkedMultiply(request.features.length, layouts.feature.size, 'feature bytes'),
  )
  const languagesOffset = length
  length = checkedAdd(length, languageBytes.length)
  const rangesOffset = ranges === undefined ? 0 : align(length, 4)
  if (ranges !== undefined) {
    length = checkedAdd(
      rangesOffset,
      checkedMultiply(ranges.length, layouts.reshapeRange.size, 'reshape range bytes'),
    )
  }
  const bytes = new Uint8Array(length)
  const view = new DataView(bytes.buffer)
  writeUint32(view, layouts.shapeRequest.textOffset, textOffset)
  writeUint32(view, layouts.shapeRequest.textLength, request.textUtf16.length)
  writeUint32(view, layouts.shapeRequest.runsOffset, runsOffset)
  writeUint32(view, layouts.shapeRequest.runCount, request.runs.length)
  writeUint32(view, layouts.shapeRequest.featuresOffset, featuresOffset)
  writeUint32(view, layouts.shapeRequest.featureCount, request.features.length)
  writeUint32(view, layouts.shapeRequest.languagesOffset, languagesOffset)
  writeUint32(view, layouts.shapeRequest.languagesLength, languageBytes.length)
  if (ranges !== undefined) {
    writeUint32(view, layouts.reshapeRequest.rangesOffset, rangesOffset)
    writeUint32(view, layouts.reshapeRequest.rangeCount, ranges.length)
  }
  for (let index = 0; index < request.textUtf16.length; index++) {
    view.setUint16(textOffset + index * 2, request.textUtf16[index]!, true)
  }
  request.features.forEach((feature, index) => {
    const offset = featuresOffset + index * layouts.feature.size
    writeUint32(view, offset + layouts.feature.tag, tag(feature.tag, 'feature'))
    writeUint32(view, offset + layouts.feature.value, uint32(feature.value, 'feature value'))
    writeUint32(view, offset + layouts.feature.start, uint32(feature.start, 'feature start'))
    writeUint32(view, offset + layouts.feature.end, uint32(feature.end, 'feature end'))
    if (feature.start > feature.end || feature.end > request.textUtf16.length) {
      throw new RangeError('feature range is outside textUtf16')
    }
  })
  request.runs.forEach((run, index) => {
    const offset = runsOffset + index * layouts.run.size
    const featureStart = uint32(run.featureStart, 'run feature start')
    const featureCount = uint16(run.featureCount, 'run feature count')
    if (featureStart + featureCount > request.features.length) {
      throw new RangeError('run feature range is outside features')
    }
    writeUint32(view, offset + layouts.run.fontHandle, uint32(run.font, 'font handle'))
    writeUint32(view, offset + layouts.run.textStart, uint32(run.textStart, 'run text start'))
    writeUint32(view, offset + layouts.run.textEnd, uint32(run.textEnd, 'run text end'))
    if (run.textStart > run.textEnd || run.textEnd > request.textUtf16.length) {
      throw new RangeError('run range is outside textUtf16')
    }
    if (run.direction !== 'ltr' && run.direction !== 'rtl') {
      throw new RangeError('run direction must be ltr or rtl')
    }
    if (!Number.isInteger(run.clusterLevel) || run.clusterLevel < 0 || run.clusterLevel > 3) {
      throw new RangeError('run cluster level must be an integer from 0 through 3')
    }
    writeUint32(view, offset + layouts.run.script, tag(run.script, 'script'))
    writeUint32(
      view,
      offset + layouts.run.languageOffset,
      run.language === undefined ? noLanguage : languages.get(run.language)!,
    )
    writeUint32(view, offset + layouts.run.featureStart, featureStart)
    view.setUint16(offset + layouts.run.featureCount, featureCount, true)
    view.setUint8(offset + layouts.run.direction, run.direction === 'ltr' ? 0 : 1)
    view.setUint8(offset + layouts.run.clusterLevel, run.clusterLevel)
    writeUint32(view, offset + layouts.run.flags, flags(run.flags, 'run flags'))
  })
  bytes.set(languageBytes, languagesOffset)
  ranges?.forEach((range, index) => {
    const offset = rangesOffset + index * layouts.reshapeRange.size
    writeUint32(view, offset + layouts.reshapeRange.run, uint32(range.run, 'range run'))
    writeUint32(
      view,
      offset + layouts.reshapeRange.itemStart,
      uint32(range.itemStart, 'range item start'),
    )
    writeUint32(
      view,
      offset + layouts.reshapeRange.itemEnd,
      uint32(range.itemEnd, 'range item end'),
    )
    writeUint32(
      view,
      offset + layouts.reshapeRange.contextStart,
      uint32(range.contextStart, 'range context start'),
    )
    writeUint32(
      view,
      offset + layouts.reshapeRange.contextEnd,
      uint32(range.contextEnd, 'range context end'),
    )
    writeUint32(view, offset + layouts.reshapeRange.flags, flags(range.flags, 'range flags'))
    const run = request.runs[range.run]
    if (
      run === undefined ||
      range.contextStart > range.itemStart ||
      range.itemStart > range.itemEnd ||
      range.itemEnd > range.contextEnd ||
      range.contextStart < run.textStart ||
      range.contextEnd > run.textEnd
    ) {
      throw new RangeError('reshape range is outside its run context')
    }
  })
  return bytes
}

function readResultViews(exports: ShaperExports, layout: ResultLayout): ShapedBatchViews {
  const pointer = exports.resultPointer()
  const length = exports.resultLength()
  if (length < layout.size) throw new TypeError('text shaper returned a truncated result header')
  const bytes = checkedMemoryView(exports.memory, pointer, length)
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readUint32(header, layout.byteLength) !== length) {
    throw new TypeError('text shaper result length does not match its header')
  }
  const fontHandleCount = readUint32(header, layout.fontHandleCount)
  const runCount = readUint32(header, layout.runCount)
  const glyphCount = readUint32(header, layout.glyphCount)
  return {
    fontHandles: resultArray(
      Uint32Array,
      bytes,
      readUint32(header, layout.fontHandlesOffset),
      fontHandleCount,
    ),
    runFontSlots: resultArray(
      Uint16Array,
      bytes,
      readUint32(header, layout.runFontSlotsOffset),
      runCount,
    ),
    runGlyphStarts: resultArray(
      Uint32Array,
      bytes,
      readUint32(header, layout.runGlyphStartsOffset),
      runCount,
    ),
    runGlyphCounts: resultArray(
      Uint32Array,
      bytes,
      readUint32(header, layout.runGlyphCountsOffset),
      runCount,
    ),
    glyphIds: resultArray(
      Uint16Array,
      bytes,
      readUint32(header, layout.glyphIdsOffset),
      glyphCount,
    ),
    clusters: resultArray(
      Uint32Array,
      bytes,
      readUint32(header, layout.clustersOffset),
      glyphCount,
    ),
    xAdvances: resultArray(
      Int32Array,
      bytes,
      readUint32(header, layout.xAdvancesOffset),
      glyphCount,
    ),
    yAdvances: resultArray(
      Int32Array,
      bytes,
      readUint32(header, layout.yAdvancesOffset),
      glyphCount,
    ),
    xOffsets: resultArray(Int32Array, bytes, readUint32(header, layout.xOffsetsOffset), glyphCount),
    yOffsets: resultArray(Int32Array, bytes, readUint32(header, layout.yOffsetsOffset), glyphCount),
    glyphFlags: resultArray(
      Uint16Array,
      bytes,
      readUint32(header, layout.glyphFlagsOffset),
      glyphCount,
    ),
  }
}

function readBidiResultViews(exports: ShaperExports, layout: BidiResultLayout): BidiAnalysisViews {
  const pointer = exports.resultPointer()
  const length = exports.resultLength()
  if (length < layout.size) throw new TypeError('text shaper returned a truncated bidi header')
  const bytes = checkedMemoryView(exports.memory, pointer, length)
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readUint32(header, layout.byteLength) !== length) {
    throw new TypeError('text shaper bidi result length does not match its header')
  }
  const textLength = readUint32(header, layout.textLength)
  const paragraphCount = readUint32(header, layout.paragraphCount)
  return {
    levels: resultArray(Uint8Array, bytes, readUint32(header, layout.levelsOffset), textLength),
    classes: resultArray(Uint8Array, bytes, readUint32(header, layout.classesOffset), textLength),
    paragraphStarts: resultArray(
      Uint32Array,
      bytes,
      readUint32(header, layout.paragraphStartsOffset),
      paragraphCount,
    ),
    paragraphEnds: resultArray(
      Uint32Array,
      bytes,
      readUint32(header, layout.paragraphEndsOffset),
      paragraphCount,
    ),
    paragraphLevels: resultArray(
      Uint8Array,
      bytes,
      readUint32(header, layout.paragraphLevelsOffset),
      paragraphCount,
    ),
  }
}

type ResultArrayConstructor<ArrayType extends Uint8Array | Uint16Array | Uint32Array | Int32Array> =
  {
    readonly BYTES_PER_ELEMENT: number
    new (buffer: ArrayBuffer, byteOffset: number, length: number): ArrayType
  }

function resultArray<ArrayType extends Uint8Array | Uint16Array | Uint32Array | Int32Array>(
  Constructor: ResultArrayConstructor<ArrayType>,
  result: Uint8Array<ArrayBuffer>,
  offset: number,
  count: number,
): ArrayType {
  const length = checkedMultiply(count, Constructor.BYTES_PER_ELEMENT, 'result array bytes')
  if (offset % Constructor.BYTES_PER_ELEMENT !== 0 || offset + length > result.byteLength) {
    throw new TypeError('text shaper returned an invalid result-array range')
  }
  return new Constructor(result.buffer, result.byteOffset + offset, count)
}

function exportedFunction(
  instance: WebAssembly.Instance,
  name: string,
): (...args: number[]) => number {
  const value = instance.exports[name]
  if (typeof value !== 'function') throw new TypeError(`text shaper is missing export ${name}`)
  return value as (...args: number[]) => number
}

function copyIntoWasm(
  exports: ShaperExports,
  bytes: Uint8Array,
): { readonly pointer: number; readonly length: number } {
  const length = bytes.byteLength
  const pointer = exports.allocate(length)
  if (pointer === 0 && length !== 0) throw new RangeError('text shaper allocation failed')
  checkedMemoryView(exports.memory, pointer, length).set(bytes)
  return { pointer, length }
}

function checkedMemoryView(
  memory: WebAssembly.Memory,
  pointer: number,
  length: number,
): Uint8Array<ArrayBuffer> {
  uint32(pointer, 'Wasm pointer')
  uint32(length, 'Wasm length')
  if (pointer + length > memory.buffer.byteLength) {
    throw new RangeError('text shaper memory range is out of bounds')
  }
  return new Uint8Array(memory.buffer as ArrayBuffer, pointer, length)
}

function tag(value: string, label: string): number {
  if (value.length !== 4) throw new RangeError(`${label} tag must contain exactly four bytes`)
  let packed = 0
  for (let index = 0; index < 4; index++) {
    const byte = value.charCodeAt(index)
    if (byte < 0x20 || byte > 0x7e) {
      throw new RangeError(`${label} tag must contain printable ASCII bytes`)
    }
    packed = (packed << 8) | byte
  }
  return packed >>> 0
}

function flags(value: number, label: string): number {
  const packed = uint32(value, label)
  if ((packed & ~bufferFlagsMask) !== 0) throw new RangeError(`${label} contains unknown bits`)
  return packed
}

function uint16(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${label} must be an unsigned 16-bit integer`)
  }
  return value
}

function uint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`)
  }
  return value
}

function align(value: number, alignment: number): number {
  return checkedAdd(value, (alignment - (value % alignment)) % alignment)
}

function checkedMultiply(left: number, right: number, label: string): number {
  const value = left * right
  if (!Number.isSafeInteger(value) || value > 0xffff_ffff) {
    throw new RangeError(`${label} exceeds the V0 address space`)
  }
  return value
}

function checkedAdd(left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value) || value > 0xffff_ffff) {
    throw new RangeError('shape request exceeds the V0 address space')
  }
  return value
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function shaperStatusError(status: number, action: string): Error {
  const labels: Record<number, string> = {
    1: 'invalid font handle',
    2: 'invalid shaping SFNT',
    3: 'invalid glyph extents',
    4: 'font handle conflict',
    5: 'font handle is not registered',
    6: 'invalid batch request',
    7: 'result exceeds the V0 address space',
  }
  return new Error(`text shaper could not ${action}: ${labels[status] ?? `status ${status}`}`)
}
