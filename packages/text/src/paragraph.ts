import type { FontHandle } from './identity.js'
import type { ParagraphLayout, ParagraphMeasurement } from './layout.js'
import type { FontFeature, ResolvedFontFeature } from './text.js'
import type { RegisteredFont } from './font.js'
import type {
  BidiAnalysisViews,
  ReshapeRange,
  RuntimeShaper,
  ShapeBatchRequest,
  ShapedBatchViews,
} from './shaper.js'
import { analyzeUnicodeText, type UnicodeTextAnalysis } from './internal/unicode.js'

/**
 * A layout-system-neutral axis constraint.
 *
 * These modes describe the common constraint vocabulary used by flex, grid,
 * retained UI, and application-owned layout systems.
 */
export type ParagraphAxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exactly'; readonly size: number }

export interface ParagraphStyle {
  readonly fontSize?: number
  readonly lineHeight?: number
  readonly letterSpacing?: number
  readonly language?: string
  readonly direction?: 'auto' | 'ltr' | 'rtl'
  readonly features?: readonly FontFeature[]
}

export interface ParagraphSpan extends ParagraphStyle {
  readonly start: number
  readonly end: number
  readonly font?: FontHandle
}

export interface ParagraphInput {
  readonly text: string
  readonly font: FontHandle
  readonly spans?: readonly ParagraphSpan[]
  readonly style?: ParagraphStyle
}

export interface ParagraphConstraints {
  /** Defaults to `{ mode: 'unconstrained' }`. */
  readonly width?: ParagraphAxisConstraint
  /** Defaults to `{ mode: 'unconstrained' }`. */
  readonly height?: ParagraphAxisConstraint
  readonly maxLines?: number
  readonly wrap?: 'none' | 'word' | 'character'
  readonly align?: 'start' | 'center' | 'end' | 'justify'
  readonly overflow?: 'visible' | 'clip' | 'ellipsis'
}

/**
 * A prepared paragraph has no asynchronous methods. Font and shaper
 * dependencies must be loaded before it is exposed to a synchronous host
 * layout system.
 */
export interface Paragraph {
  /** Resolve box metrics without materializing positioned glyph arrays. */
  measure(constraints?: ParagraphConstraints): ParagraphMeasurement
  /** Resolve the final box and materialize positioned glyph output. */
  layout(constraints?: ParagraphConstraints): ParagraphLayout
  update(input: ParagraphInput): void
  dispose(): void
}

export interface ParagraphEngine {
  create(input: ParagraphInput): Paragraph
}

export interface ParagraphEngineOptions {
  readonly shaper: RuntimeShaper
}

interface ResolvedStyle {
  readonly font: FontHandle
  readonly fontSize: number
  readonly lineHeight?: number
  readonly letterSpacing: number
  readonly language?: string
  readonly direction: 'auto' | 'ltr' | 'rtl'
  readonly bidiOverride?: 'ltr' | 'rtl'
  readonly features: readonly ResolvedFontFeature[]
}

interface StyleSegment {
  readonly start: number
  readonly end: number
  readonly style: ResolvedStyle
}

interface ResolvedSpanStyle {
  readonly index: number
  readonly start: number
  readonly end: number
  readonly font?: FontHandle
  readonly fontSize?: number
  readonly lineHeight?: number
  readonly letterSpacing?: number
  readonly language?: string
  readonly direction?: 'auto' | 'ltr' | 'rtl'
  readonly features?: readonly ResolvedFontFeature[]
}

interface ActiveStyleValue<Value> {
  readonly index: number
  readonly end: number
  readonly value: Value
}

interface PreparedRun extends StyleSegment {
  readonly script: string
  readonly direction: 'ltr' | 'rtl'
  readonly bidiLevel: number
}

interface OwnedBidiAnalysis {
  readonly levels: Uint8Array
  readonly classes: Uint8Array
  readonly paragraphStarts: Uint32Array
  readonly paragraphEnds: Uint32Array
  readonly paragraphLevels: Uint8Array
}

interface OwnedShape {
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

interface MeasuredCluster {
  readonly start: number
  readonly end: number
  readonly advance: number
  readonly safeBefore: boolean
  readonly style: ResolvedStyle
  readonly requiredBreak: boolean
  readonly hardBreak: boolean
}

interface LineMetrics {
  readonly height: number
  readonly baseline: number
}

interface LinePlan extends LineMetrics {
  readonly clusterStart: number
  readonly clusterEnd: number
  readonly textStart: number
  readonly textEnd: number
  readonly advance: number
  readonly hardBreak: boolean
  readonly ellipsis?: EllipsisPlan
}

interface EllipsisPlan {
  readonly sourceRun: number
  readonly shapeRun: number
  readonly textStart: number
  readonly textEnd: number
  readonly cluster: number
  readonly advance: number
  readonly level: number
}

interface PreparedEllipsis {
  readonly sourceRun: number
  readonly shapeRun: number
  readonly textStart: number
  readonly textEnd: number
  readonly advance: number
}

interface PreparedParagraph {
  readonly input: ParagraphInput
  readonly unicode: UnicodeTextAnalysis
  readonly bidi: OwnedBidiAnalysis
  readonly styles: readonly StyleSegment[]
  readonly runs: readonly PreparedRun[]
  readonly request: ShapeBatchRequest
  readonly shape: OwnedShape
  readonly ellipses: readonly PreparedEllipsis[]
  readonly clusters: readonly MeasuredCluster[]
  readonly clusterStarts: Uint32Array
  readonly letterSpacingPrefix: Float64Array
  readonly spacePrefix: Uint32Array
}

interface NormalizedConstraints {
  readonly width: ParagraphAxisConstraint
  readonly height: ParagraphAxisConstraint
  readonly maxLines?: number
  readonly wrap: 'none' | 'word' | 'character'
  readonly align: 'start' | 'center' | 'end' | 'justify'
  readonly overflow: 'visible' | 'clip' | 'ellipsis'
}

interface MeasuredPlan {
  readonly measurement: ParagraphMeasurement
  readonly lines: readonly LinePlan[]
}

interface LineFragment {
  readonly line: number
  readonly run: number
  readonly start: number
  readonly end: number
  readonly flags: number
  readonly level: number
  readonly ellipsis?: EllipsisPlan
  readonly reshape: boolean
}

interface PositionedGeometry {
  readonly fontHandles: Uint32Array
  readonly glyphFontSlots: Uint16Array
  readonly glyphIds: Uint16Array
  readonly clusters: Uint32Array
  readonly glyphFontSizes: Float32Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly glyphFlags: Uint16Array
  readonly lineTextStarts: Uint32Array
  readonly lineTextEnds: Uint32Array
  readonly lineGlyphStarts: Uint32Array
  readonly lineGlyphCounts: Uint32Array
  readonly lineBaselines: Float32Array
  readonly lineAdvances: Float32Array
}

interface PreparedPositioning {
  readonly fragments: readonly LineFragment[]
  readonly reshaped?: OwnedShape
}

const DEFAULT_FONT_SIZE = 16
const MAX_PARAGRAPH_CACHE_ENTRIES = 32
const PRODUCE_UNSAFE_TO_CONCAT = 0x40
const BEGINNING_OF_TEXT = 0x01
const END_OF_TEXT = 0x02
const GLYPH_UNSAFE_TO_BREAK = 0x01
const GLYPH_UNSAFE_TO_CONCAT = 0x02
const BIDI_BN = 9
const BIDI_B = 10
const BIDI_S = 11
const BIDI_WS = 12
const BIDI_LRE = 14
const BIDI_LRO = 15
const BIDI_RLE = 16
const BIDI_RLO = 17
const BIDI_PDF = 18
const BIDI_LRI = 19
const BIDI_RLI = 20
const BIDI_FSI = 21
const BIDI_PDI = 22

export function createParagraphEngine(options: ParagraphEngineOptions): ParagraphEngine {
  if (options?.shaper === undefined) throw new TypeError('paragraph engine requires a shaper')
  return new ParagraphEngineImpl(options.shaper)
}

class ParagraphEngineImpl implements ParagraphEngine {
  readonly #shaper: RuntimeShaper

  constructor(shaper: RuntimeShaper) {
    this.#shaper = shaper
  }

  create(input: ParagraphInput): Paragraph {
    return new ParagraphImpl(this.#shaper, input)
  }
}

class ParagraphImpl implements Paragraph {
  readonly #shaper: RuntimeShaper
  readonly #measurements = new Map<string, MeasuredPlan>()
  readonly #linePlans = new Map<string, readonly LinePlan[]>()
  readonly #positioning = new Map<string, PreparedPositioning>()
  readonly #positionedLines = new Map<string, PositionedGeometry>()
  readonly #layouts = new Map<string, ParagraphLayout>()
  #prepared: PreparedParagraph
  #disposed = false

  constructor(shaper: RuntimeShaper, input: ParagraphInput) {
    this.#shaper = shaper
    this.#prepared = prepareParagraph(shaper, input)
  }

  measure(constraints?: ParagraphConstraints): ParagraphMeasurement {
    this.#assertActive()
    const normalized = normalizeConstraints(constraints)
    return this.#measurePlan(normalized).measurement
  }

  layout(constraints?: ParagraphConstraints): ParagraphLayout {
    this.#assertActive()
    const normalized = normalizeConstraints(constraints)
    const key = constraintKey(normalized)
    let layout = getRecent(this.#layouts, key)
    if (layout !== undefined) return layout
    const measured = this.#measurePlan(normalized)
    const positioningKey = positioningLinesKey(measured.lines)
    const lineKey = geometryLinesKey(positioningKey, normalized.align, measured.measurement.width)
    let geometry = getRecent(this.#positionedLines, lineKey)
    if (geometry === undefined) {
      let positioning = getRecent(this.#positioning, positioningKey)
      if (positioning === undefined) {
        positioning = preparePositioning(this.#shaper, this.#prepared, measured.lines)
        retainRecent(this.#positioning, positioningKey, positioning)
      }
      geometry = positionPrepared(
        this.#shaper,
        this.#prepared,
        measured.lines,
        positioning,
        normalized,
        measured.measurement.width,
      )
      retainRecent(this.#positionedLines, lineKey, geometry)
    }
    layout = Object.freeze({
      ...measurementForGeometry(normalized, measured.measurement, geometry),
      ...geometry,
    })
    retainRecent(this.#layouts, key, layout)
    return layout
  }

  update(input: ParagraphInput): void {
    this.#assertActive()
    this.#prepared = prepareParagraph(this.#shaper, input)
    this.#measurements.clear()
    this.#linePlans.clear()
    this.#positioning.clear()
    this.#positionedLines.clear()
    this.#layouts.clear()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#measurements.clear()
    this.#linePlans.clear()
    this.#positioning.clear()
    this.#positionedLines.clear()
    this.#layouts.clear()
  }

  #measurePlan(constraints: NormalizedConstraints): MeasuredPlan {
    const key = constraintKey(constraints)
    let plan = getRecent(this.#measurements, key)
    if (plan === undefined) {
      const lineKey = linePlanConstraintKey(constraints)
      let lines = getRecent(this.#linePlans, lineKey)
      if (lines === undefined) {
        lines = planLines(this.#shaper, this.#prepared, constraints)
        retainRecent(this.#linePlans, lineKey, lines)
      }
      plan = measurePrepared(this.#prepared, constraints, lines)
      retainRecent(this.#measurements, key, plan)
    }
    return plan
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph has been disposed')
  }
}

function getRecent<Key, Value>(cache: Map<Key, Value>, key: Key): Value | undefined {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function retainRecent<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value): void {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size <= MAX_PARAGRAPH_CACHE_ENTRIES) return
  const oldest = cache.keys().next()
  if (!oldest.done) cache.delete(oldest.value)
}

function prepareParagraph(shaper: RuntimeShaper, input: ParagraphInput): PreparedParagraph {
  const ownedInput = copyInput(input)
  const unicode = analyzeUnicodeText(ownedInput.text)
  const styles = resolveStyles(shaper, ownedInput, unicode.graphemeBoundaries)
  const textUtf16 = utf16(ownedInput.text)
  const bidi = ownBidi(shaper.analyzeBidi(textUtf16, ownedInput.style?.direction ?? 'auto'))
  const runs = prepareRuns(ownedInput.text, styles, unicode, bidi)
  const shapedRequest = shapeRequest(ownedInput.text, runs)
  const request = shapedRequest.request
  const borrowed = request.runs.length === 0 ? emptyShape() : shaper.shapeBatch(request)
  const shape = ownShape(borrowed)
  const ellipses = measureEllipses(shaper, runs, shape, shapedRequest.ellipses)
  const clusters = measureClusters(shaper, ownedInput.text, unicode, styles, runs, shape)
  const clusterIndexes = indexClusters(ownedInput.text, clusters)
  return {
    input: ownedInput,
    unicode,
    bidi,
    styles,
    runs,
    request,
    shape,
    ellipses,
    clusters,
    ...clusterIndexes,
  }
}

function copyInput(input: ParagraphInput): ParagraphInput {
  if (!isNonArrayObject(input)) throw new TypeError('paragraph input must be an object')
  if (typeof input.text !== 'string') throw new TypeError('paragraph text must be a string')
  if (input.style !== undefined && !isNonArrayObject(input.style)) {
    throw new TypeError('paragraph style must be an object')
  }
  if (input.spans !== undefined && !Array.isArray(input.spans)) {
    throw new TypeError('paragraph spans must be an array')
  }
  return {
    text: input.text,
    font: input.font,
    ...(input.style === undefined ? {} : { style: copyStyle(input.style, 'paragraph style') }),
    ...(input.spans === undefined
      ? {}
      : {
          spans: input.spans.map((span) => {
            if (!isNonArrayObject(span)) throw new TypeError('paragraph span must be an object')
            return {
              ...copyStyle(span, 'paragraph span'),
              start: span.start,
              end: span.end,
              ...(span.font === undefined ? {} : { font: span.font }),
            }
          }),
        }),
  }
}

function copyStyle(style: ParagraphStyle, name: string): ParagraphStyle {
  if (!isNonArrayObject(style)) throw new TypeError(`${name} must be an object`)
  if (style.features !== undefined && !Array.isArray(style.features)) {
    throw new TypeError(`${name} features must be an array`)
  }
  if (
    style.direction !== undefined &&
    style.direction !== 'auto' &&
    style.direction !== 'ltr' &&
    style.direction !== 'rtl'
  ) {
    throw new RangeError(`${name} direction must be auto, ltr, or rtl`)
  }
  return {
    ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize }),
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
    ...(style.letterSpacing === undefined ? {} : { letterSpacing: style.letterSpacing }),
    ...(style.language === undefined ? {} : { language: style.language }),
    ...(style.direction === undefined ? {} : { direction: style.direction }),
    ...(style.features === undefined
      ? {}
      : {
          features: style.features.map((feature) => {
            if (!isNonArrayObject(feature)) throw new TypeError(`${name} feature must be an object`)
            return { ...feature }
          }),
        }),
  }
}

function resolveStyles(
  shaper: RuntimeShaper,
  input: ParagraphInput,
  graphemeBoundaries: Uint32Array,
): readonly StyleSegment[] {
  const boundaries = new Set<number>([0, input.text.length])
  const legalBoundaries = new Set(graphemeBoundaries)
  const spansByStart = new Map<number, ResolvedSpanStyle[]>()
  for (const [index, span] of (input.spans ?? []).entries()) {
    assertTextRange(span.start, span.end, input.text.length, 'paragraph span')
    if (!legalBoundaries.has(span.start) || !legalBoundaries.has(span.end)) {
      throw new RangeError('paragraph span boundaries must be extended-grapheme boundaries')
    }
    boundaries.add(span.start)
    boundaries.add(span.end)
    const resolved = resolveSpanStyle(shaper, span, index)
    const starting = spansByStart.get(span.start)
    if (starting === undefined) spansByStart.set(span.start, [resolved])
    else starting.push(resolved)
  }
  const sorted = [...boundaries].sort((left, right) => left - right)
  const root = resolveStyle(shaper, input.font, input.style ?? {}, 0, input.text.length)
  if (input.text.length === 0) return [{ start: 0, end: 0, style: root }]
  const sweep = new StyleSweep(root)
  const segments: StyleSegment[] = []
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    if (start === undefined || end === undefined || start === end) continue
    for (const span of spansByStart.get(start) ?? []) sweep.add(span)
    const style = sweep.styleAt(start)
    const previous = segments.at(-1)
    if (previous !== undefined && previous.end === start && equalStyles(previous.style, style)) {
      segments[segments.length - 1] = { ...previous, end }
    } else {
      segments.push({ start, end, style })
    }
  }
  return segments
}

function resolveSpanStyle(
  shaper: RuntimeShaper,
  span: ParagraphSpan,
  index: number,
): ResolvedSpanStyle {
  if (span.font !== undefined) shaper.registerFont(requireFont(shaper, span.font))
  const lineHeight =
    span.lineHeight === undefined ? undefined : finitePositive(span.lineHeight, 'lineHeight')
  const direction = span.direction
  const language = span.language === undefined ? undefined : normalizeLanguage(span.language)
  return {
    index,
    start: span.start,
    end: span.end,
    ...(span.font === undefined ? {} : { font: span.font }),
    ...(span.fontSize === undefined ? {} : { fontSize: finitePositive(span.fontSize, 'fontSize') }),
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(span.letterSpacing === undefined
      ? {}
      : { letterSpacing: finite(span.letterSpacing, 'letterSpacing') }),
    ...(language === undefined ? {} : { language }),
    ...(direction === undefined ? {} : { direction }),
    ...(span.features === undefined
      ? {}
      : { features: resolveFeatures(span.features, span.start, span.end) }),
  }
}

/**
 * At each boundary, the last input span that is still active wins each style
 * property. Per-property max-heaps preserve that cascade without re-scanning
 * all spans for every segment; expired entries are discarded when observed.
 */
class StyleSweep {
  readonly #root: ResolvedStyle
  readonly #font = new LatestActiveValue<FontHandle>()
  readonly #fontSize = new LatestActiveValue<number>()
  readonly #lineHeight = new LatestActiveValue<number>()
  readonly #letterSpacing = new LatestActiveValue<number>()
  readonly #language = new LatestActiveValue<string>()
  readonly #direction = new LatestActiveValue<'auto' | 'ltr' | 'rtl'>()
  readonly #features = new LatestActiveValue<readonly ResolvedFontFeature[]>()

  constructor(root: ResolvedStyle) {
    this.#root = root
  }

  add(span: ResolvedSpanStyle): void {
    const entry = <Value>(value: Value): ActiveStyleValue<Value> => ({
      index: span.index,
      end: span.end,
      value,
    })
    if (span.font !== undefined) this.#font.add(entry(span.font))
    if (span.fontSize !== undefined) this.#fontSize.add(entry(span.fontSize))
    if (span.lineHeight !== undefined) this.#lineHeight.add(entry(span.lineHeight))
    if (span.letterSpacing !== undefined) this.#letterSpacing.add(entry(span.letterSpacing))
    if (span.language !== undefined) this.#language.add(entry(span.language))
    if (span.direction !== undefined) this.#direction.add(entry(span.direction))
    if (span.features !== undefined) this.#features.add(entry(span.features))
  }

  styleAt(offset: number): ResolvedStyle {
    const font = this.#font.valueAt(offset) ?? this.#root.font
    const fontSize = this.#fontSize.valueAt(offset) ?? this.#root.fontSize
    const lineHeight = this.#lineHeight.valueAt(offset) ?? this.#root.lineHeight
    const letterSpacing = this.#letterSpacing.valueAt(offset) ?? this.#root.letterSpacing
    const language = this.#language.valueAt(offset) ?? this.#root.language
    const override = this.#direction.valueAt(offset)
    const direction = override ?? this.#root.direction
    const features = this.#features.valueAt(offset) ?? this.#root.features
    return {
      font,
      fontSize,
      ...(lineHeight === undefined ? {} : { lineHeight }),
      letterSpacing,
      ...(language === undefined ? {} : { language }),
      direction,
      ...(override === undefined || direction === 'auto' ? {} : { bidiOverride: direction }),
      features,
    }
  }
}

class LatestActiveValue<Value> {
  readonly #heap: ActiveStyleValue<Value>[] = []

  add(value: ActiveStyleValue<Value>): void {
    this.#heap.push(value)
    let child = this.#heap.length - 1
    while (child > 0) {
      const parent = (child - 1) >>> 1
      if ((this.#heap[parent]?.index ?? -1) >= value.index) break
      this.#heap[child] = this.#heap[parent] as ActiveStyleValue<Value>
      child = parent
    }
    this.#heap[child] = value
  }

  valueAt(offset: number): Value | undefined {
    while (this.#heap[0]?.end !== undefined && this.#heap[0].end <= offset) this.#removeTop()
    return this.#heap[0]?.value
  }

  #removeTop(): void {
    const last = this.#heap.pop()
    if (last === undefined || this.#heap.length === 0) return
    let parent = 0
    while (true) {
      const left = parent * 2 + 1
      const right = left + 1
      const child =
        (this.#heap[right]?.index ?? -1) > (this.#heap[left]?.index ?? -1) ? right : left
      if ((this.#heap[child]?.index ?? -1) <= last.index) break
      this.#heap[parent] = this.#heap[child] as ActiveStyleValue<Value>
      parent = child
    }
    this.#heap[parent] = last
  }
}

function resolveStyle(
  shaper: RuntimeShaper,
  fontHandle: FontHandle,
  style: ParagraphStyle,
  start: number,
  end: number,
): ResolvedStyle {
  const font = requireFont(shaper, fontHandle)
  shaper.registerFont(font)
  const fontSize = finitePositive(style.fontSize ?? DEFAULT_FONT_SIZE, 'fontSize')
  const lineHeight =
    style.lineHeight === undefined ? undefined : finitePositive(style.lineHeight, 'lineHeight')
  const letterSpacing = finite(style.letterSpacing ?? 0, 'letterSpacing')
  const language = normalizeLanguage(style.language)
  const direction = style.direction ?? 'auto'
  return {
    font: fontHandle,
    fontSize,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    letterSpacing,
    ...(language === undefined ? {} : { language }),
    direction,
    features: resolveFeatures(style.features ?? [], start, end),
  }
}

function resolveFeatures(
  features: readonly FontFeature[],
  containingStart: number,
  containingEnd: number,
): readonly ResolvedFontFeature[] {
  return features.map((feature) => {
    const start = feature.start ?? containingStart
    const end = feature.end ?? containingEnd
    assertTextRange(start, end, containingEnd, `feature ${feature.tag}`)
    if (start < containingStart)
      throw new RangeError(`feature ${feature.tag} starts before its style range`)
    const value = feature.value ?? 1
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new RangeError(`feature ${feature.tag} value must be a uint32`)
    }
    return { tag: feature.tag, value, start, end }
  })
}

function prepareRuns(
  text: string,
  styles: readonly StyleSegment[],
  unicode: UnicodeTextAnalysis,
  bidi: OwnedBidiAnalysis,
): readonly PreparedRun[] {
  const runs: PreparedRun[] = []
  const bidiItems = bidiRuns(bidi.levels)
  let styleIndex = 0
  let scriptIndex = 0
  let bidiIndex = 0
  while (
    styleIndex < styles.length &&
    scriptIndex < unicode.scriptItems.length &&
    bidiIndex < bidiItems.length
  ) {
    const style = styles[styleIndex]
    const script = unicode.scriptItems[scriptIndex]
    const bidiRun = bidiItems[bidiIndex]
    if (style === undefined || script === undefined || bidiRun === undefined) break
    const start = Math.max(style.start, script.start, bidiRun.start)
    const end = Math.min(style.end, script.end, bidiRun.end)
    if (start < end) {
      const direction = style.style.bidiOverride ?? directionForLevel(bidiRun.level)
      const bidiLevel =
        style.style.bidiOverride === undefined
          ? bidiRun.level
          : forceLevelDirection(bidiRun.level, direction)
      for (const fragment of drawableFragments(text, start, end)) {
        appendPreparedRun(runs, {
          ...fragment,
          style: style.style,
          script: script.script,
          direction,
          bidiLevel,
        })
      }
    }
    const boundary = Math.min(style.end, script.end, bidiRun.end)
    if (style.end === boundary) styleIndex += 1
    if (script.end === boundary) scriptIndex += 1
    if (bidiRun.end === boundary) bidiIndex += 1
  }
  if (runs.length === 0) {
    const fallback = styles[0]
    if (fallback !== undefined) {
      const level = bidi.levels[0] ?? bidi.paragraphLevels[0] ?? 0
      runs.push({
        start: fallback.start,
        end: fallback.start,
        style: fallback.style,
        script: 'Zyyy',
        direction: fallback.style.bidiOverride ?? directionForLevel(level),
        bidiLevel: level,
      })
    }
  }
  return runs
}

function appendPreparedRun(runs: PreparedRun[], run: PreparedRun): void {
  const previous = runs.at(-1)
  if (
    previous !== undefined &&
    previous.end === run.start &&
    previous.script === run.script &&
    previous.direction === run.direction &&
    previous.bidiLevel === run.bidiLevel &&
    equalStyles(previous.style, run.style)
  ) {
    runs[runs.length - 1] = { ...previous, end: run.end }
  } else {
    runs.push(run)
  }
}

function bidiRuns(levels: Uint8Array): readonly {
  readonly start: number
  readonly end: number
  readonly level: number
}[] {
  const runs = []
  let start = 0
  while (start < levels.length) {
    const level = levels[start]
    if (level === undefined) break
    let end = start + 1
    while (end < levels.length && levels[end] === level) end += 1
    runs.push({ start, end, level })
    start = end
  }
  return runs
}

function directionForLevel(level: number): 'ltr' | 'rtl' {
  return (level & 1) === 0 ? 'ltr' : 'rtl'
}

function forceLevelDirection(level: number, direction: 'ltr' | 'rtl'): number {
  return directionForLevel(level) === direction ? level : level + 1
}

function shapeRequest(
  text: string,
  runs: readonly PreparedRun[],
): {
  readonly request: ShapeBatchRequest
  readonly ellipses: readonly Omit<PreparedEllipsis, 'advance'>[]
} {
  const features: ResolvedFontFeature[] = []
  const shapeRuns = runs.map((run) => {
    const selected = run.style.features.filter(
      (feature) => feature.start < run.end && feature.end > run.start,
    )
    const featureStart = features.length
    features.push(...selected)
    return {
      font: run.style.font,
      textStart: run.start,
      textEnd: run.end,
      direction: run.direction,
      script: run.script,
      ...(run.style.language === undefined ? {} : { language: run.style.language }),
      clusterLevel: 0 as const,
      flags: PRODUCE_UNSAFE_TO_CONCAT,
      featureStart,
      featureCount: selected.length,
    }
  })
  const ellipses = runs.map((run, sourceRun) => {
    const textStart = text.length + sourceRun
    const shapeRun = shapeRuns.length
    shapeRuns.push({
      font: run.style.font,
      textStart,
      textEnd: textStart + 1,
      direction: run.direction,
      script: run.script,
      ...(run.style.language === undefined ? {} : { language: run.style.language }),
      clusterLevel: 0 as const,
      flags: PRODUCE_UNSAFE_TO_CONCAT,
      featureStart: features.length,
      featureCount: 0,
    })
    return { sourceRun, shapeRun, textStart, textEnd: textStart + 1 }
  })
  return {
    request: { textUtf16: utf16(`${text}${'…'.repeat(runs.length)}`), runs: shapeRuns, features },
    ellipses,
  }
}

function measureEllipses(
  shaper: RuntimeShaper,
  runs: readonly PreparedRun[],
  shape: OwnedShape,
  ellipses: readonly Omit<PreparedEllipsis, 'advance'>[],
): readonly PreparedEllipsis[] {
  return ellipses.map((ellipsis) => {
    const run = runs[ellipsis.sourceRun]
    const glyphStart = shape.runGlyphStarts[ellipsis.shapeRun]
    const glyphCount = shape.runGlyphCounts[ellipsis.shapeRun]
    if (run === undefined || glyphStart === undefined || glyphCount === undefined) {
      throw new Error('shaper returned an incomplete ellipsis run')
    }
    const font = requireFont(shaper, run.style.font)
    const scale = run.style.fontSize / font.metrics.unitsPerEm
    let advance = 0
    for (let glyph = glyphStart; glyph < glyphStart + glyphCount; glyph += 1) {
      advance += Math.abs(shape.xAdvances[glyph] ?? 0) * scale
    }
    return { ...ellipsis, advance }
  })
}

function measureClusters(
  shaper: RuntimeShaper,
  text: string,
  unicode: UnicodeTextAnalysis,
  styles: readonly StyleSegment[],
  runs: readonly PreparedRun[],
  shape: OwnedShape,
): readonly MeasuredCluster[] {
  const advances = new Map<number, number>()
  const unsafe = new Set<number>()
  const shapedBoundaries = new Set<number>()
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex]
    const glyphStart = shape.runGlyphStarts[runIndex]
    const glyphCount = shape.runGlyphCounts[runIndex]
    if (run === undefined || glyphStart === undefined || glyphCount === undefined) {
      throw new Error('shaper returned an incomplete run table')
    }
    const font = requireFont(shaper, run.style.font)
    const scale = run.style.fontSize / font.metrics.unitsPerEm
    shapedBoundaries.add(run.start)
    shapedBoundaries.add(run.end)
    for (let glyph = glyphStart; glyph < glyphStart + glyphCount; glyph += 1) {
      const cluster = shape.clusters[glyph]
      const advance = shape.xAdvances[glyph]
      const flags = shape.glyphFlags[glyph]
      if (cluster === undefined || advance === undefined || flags === undefined) {
        throw new Error('shaper returned an incomplete glyph table')
      }
      shapedBoundaries.add(cluster)
      advances.set(cluster, (advances.get(cluster) ?? 0) + Math.abs(advance) * scale)
      if ((flags & GLYPH_UNSAFE_TO_BREAK) !== 0) unsafe.add(cluster)
    }
  }

  const lineBreaks = new Map(unicode.lineBreaks.map((entry) => [entry.position, entry.required]))
  const clusters: MeasuredCluster[] = []
  let styleIndex = 0
  for (let index = 0; index + 1 < unicode.graphemeBoundaries.length; index += 1) {
    const start = unicode.graphemeBoundaries[index]
    const end = unicode.graphemeBoundaries[index + 1]
    if (start === undefined || end === undefined) continue
    while ((styles[styleIndex]?.end ?? Number.POSITIVE_INFINITY) <= start) styleIndex += 1
    const styleSegment = styles[styleIndex]
    if (styleSegment === undefined || styleSegment.start > start) {
      throw new Error(`paragraph offset ${start} has no resolved style`)
    }
    const style = styleSegment.style
    const requiredBreak = lineBreaks.get(end) === true
    const hardBreak = isHardBreak(text, start)
    clusters.push({
      start,
      end,
      advance: (advances.get(start) ?? 0) + (hardBreak ? 0 : style.letterSpacing),
      safeBefore: shapedBoundaries.has(start) && !unsafe.has(start),
      style,
      requiredBreak,
      hardBreak,
    })
  }
  return clusters
}

function indexClusters(
  text: string,
  clusters: readonly MeasuredCluster[],
): Pick<PreparedParagraph, 'clusterStarts' | 'letterSpacingPrefix' | 'spacePrefix'> {
  const clusterStarts = new Uint32Array(clusters.length)
  const letterSpacingPrefix = new Float64Array(clusters.length + 1)
  const spacePrefix = new Uint32Array(clusters.length + 1)
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index]
    if (cluster === undefined) continue
    clusterStarts[index] = cluster.start
    letterSpacingPrefix[index + 1] =
      (letterSpacingPrefix[index] ?? 0) + (cluster.hardBreak ? 0 : cluster.style.letterSpacing)
    spacePrefix[index + 1] =
      (spacePrefix[index] ?? 0) + (text.charCodeAt(cluster.start) === 0x20 ? 1 : 0)
  }
  return { clusterStarts, letterSpacingPrefix, spacePrefix }
}

function planLines(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
): readonly LinePlan[] {
  const widthLimit =
    constraints.width.mode === 'unconstrained' ? Number.POSITIVE_INFINITY : constraints.width.size
  const allowed = new Set<number>()
  if (constraints.wrap === 'character') {
    for (let index = 0; index < prepared.clusters.length; index += 1) {
      const cluster = prepared.clusters[index]
      const next = prepared.clusters[index + 1]
      if (cluster !== undefined && (next?.safeBefore === true || next === undefined)) {
        allowed.add(cluster.end)
      }
    }
  } else if (constraints.wrap === 'word') {
    const shapingBoundaries = new Set(
      prepared.clusters.filter(({ safeBefore }) => safeBefore).map(({ start }) => start),
    )
    shapingBoundaries.add(prepared.input.text.length)
    for (const entry of prepared.unicode.lineBreaks) {
      if (shapingBoundaries.has(entry.position)) allowed.add(entry.position)
    }
  }

  return breakLines(shaper, prepared, allowed, widthLimit, constraints.wrap)
}

function measurePrepared(
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
  allLines: readonly LinePlan[],
): MeasuredPlan {
  const lines = visibleLines(prepared, constraints, allLines)
  const naturalContentWidth = allLines.reduce((maximum, line) => Math.max(maximum, line.advance), 0)
  const contentHeight = allLines.reduce((sum, line) => sum + line.height, 0)
  const displayAdvances = lines.map((line, index) =>
    measuredLineAdvance(prepared, constraints, lines, line, index),
  )
  const visibleWidth = displayAdvances.reduce((maximum, advance) => Math.max(maximum, advance), 0)
  const contentWidth = Math.max(naturalContentWidth, visibleWidth)
  const visibleHeight = lines.reduce((sum, line) => sum + line.height, 0)
  const width = resolveAxis(constraints.width, visibleWidth)
  const height = resolveAxis(constraints.height, visibleHeight)
  let blockOffset = 0
  const baselines = lines.map((line) => {
    const baseline = blockOffset + line.baseline
    blockOffset += line.height
    return baseline
  })
  const measurement = Object.freeze({
    width,
    height,
    contentWidth,
    contentHeight,
    firstBaseline: baselines[0] ?? 0,
    lastBaseline: baselines.at(-1) ?? 0,
    overflowed: lines.length < allLines.length || contentWidth > width || contentHeight > height,
  })
  return { measurement, lines }
}

function measuredLineAdvance(
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
  lines: readonly LinePlan[],
  line: LinePlan,
  index: number,
): number {
  if (
    constraints.align !== 'justify' ||
    constraints.width.mode !== 'exactly' ||
    line.hardBreak ||
    index >= lines.length - 1 ||
    justificationSpaces(prepared, line, line.textStart, line.textEnd) === 0
  ) {
    return line.advance
  }
  return Math.max(line.advance, constraints.width.size)
}

function visibleLines(
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
  allLines: readonly LinePlan[],
): readonly LinePlan[] {
  let count =
    constraints.maxLines === undefined
      ? allLines.length
      : Math.min(allLines.length, constraints.maxLines)
  if (constraints.overflow === 'ellipsis' && constraints.height.mode !== 'unconstrained') {
    let height = 0
    let fitting = 0
    for (const line of allLines) {
      if (height + line.height > constraints.height.size) break
      height += line.height
      fitting += 1
    }
    count = Math.min(count, fitting)
  }
  const lines = allLines.slice(0, count)
  if (constraints.overflow !== 'ellipsis' || lines.length === 0) return lines
  const last = lines.at(-1)
  if (last === undefined) return lines
  const widthLimit =
    constraints.width.mode === 'unconstrained' ? Number.POSITIVE_INFINITY : constraints.width.size
  const truncated = count < allLines.length
  if (!truncated && last.advance <= widthLimit) return lines
  return [...lines.slice(0, -1), ellipsizeLine(prepared, last, widthLimit)]
}

function ellipsizeLine(prepared: PreparedParagraph, line: LinePlan, widthLimit: number): LinePlan {
  let clusterEnd = line.clusterEnd
  let advance = line.advance
  while (clusterEnd > line.clusterStart && prepared.clusters[clusterEnd - 1]?.hardBreak === true) {
    clusterEnd -= 1
  }
  let selected = ellipsisAt(prepared, line.textEnd)
  while (
    clusterEnd > line.clusterStart &&
    Number.isFinite(widthLimit) &&
    advance + selected.advance > widthLimit
  ) {
    clusterEnd -= 1
    const removed = prepared.clusters[clusterEnd]
    if (removed !== undefined) advance -= removed.advance
    const offset = prepared.clusters[clusterEnd]?.start ?? line.textStart
    selected = ellipsisAt(prepared, offset)
  }
  const textEnd = prepared.clusters[clusterEnd]?.start ?? line.textStart
  const levelOffset = Math.max(line.textStart, textEnd - 1)
  const level = prepared.bidi.levels[levelOffset] ?? paragraphLevelAt(prepared.bidi, textEnd)
  return {
    ...line,
    clusterEnd,
    textEnd,
    advance: Math.max(0, advance) + selected.advance,
    hardBreak: false,
    ellipsis: {
      ...selected,
      cluster: textEnd,
      level,
    },
  }
}

function ellipsisAt(prepared: PreparedParagraph, offset: number): PreparedEllipsis {
  const sourceRun = prepared.runs.findIndex((run) => run.start < offset && offset <= run.end)
  const fallbackRun = prepared.runs.findIndex((run) => run.start <= offset && offset < run.end)
  const run = sourceRun >= 0 ? sourceRun : fallbackRun
  const ellipsis =
    prepared.ellipses.find((entry) => entry.sourceRun === run) ?? prepared.ellipses[0]
  if (ellipsis === undefined) throw new Error('paragraph has no ellipsis shaping run')
  return ellipsis
}

function breakLines(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  allowed: ReadonlySet<number>,
  widthLimit: number,
  wrap: 'none' | 'word' | 'character',
): readonly LinePlan[] {
  const { clusters } = prepared
  if (clusters.length === 0) return []
  const lines: LinePlan[] = []
  let lineStart = 0
  while (lineStart < clusters.length) {
    let advance = 0
    let lastAllowed = -1
    let lastAllowedAdvance = 0
    let lastSafe = -1
    let lastSafeAdvance = 0
    let lineEnd = clusters.length
    let lineAdvance = 0
    for (let index = lineStart; index < clusters.length; index += 1) {
      const cluster = clusters[index]
      if (cluster === undefined) break
      if (index > lineStart && cluster.safeBefore) {
        lastSafe = index
        lastSafeAdvance = advance
      }
      const nextAdvance = advance + cluster.advance
      if (
        wrap !== 'none' &&
        Number.isFinite(widthLimit) &&
        nextAdvance > widthLimit &&
        index > lineStart
      ) {
        if (lastAllowed > lineStart) {
          lineEnd = lastAllowed
          lineAdvance = lastAllowedAdvance
        } else if (lastSafe > lineStart) {
          lineEnd = lastSafe
          lineAdvance = lastSafeAdvance
        } else {
          advance = nextAdvance
          if (cluster.requiredBreak || index === clusters.length - 1) {
            lineEnd = index + 1
            lineAdvance = advance
            break
          }
          continue
        }
        break
      }
      advance = nextAdvance
      if (cluster.requiredBreak) {
        lineEnd = index + 1
        lineAdvance = advance
        break
      }
      if (allowed.has(cluster.end)) {
        lastAllowed = index + 1
        lastAllowedAdvance = advance
      }
      if (index === clusters.length - 1) lineAdvance = advance
    }
    if (lineEnd <= lineStart) {
      lineEnd = lineStart + 1
      lineAdvance = clusters[lineStart]?.advance ?? 0
    }
    const first = clusters[lineStart]
    const last = clusters[lineEnd - 1]
    if (first === undefined || last === undefined) throw new Error('invalid line cluster range')
    const metrics = metricsForLine(
      shaper,
      clusters.slice(lineStart, lineEnd),
      prepared.styles[0]?.style,
    )
    lines.push({
      clusterStart: lineStart,
      clusterEnd: lineEnd,
      textStart: first.start,
      textEnd: last.hardBreak ? last.start : last.end,
      advance: lineAdvance,
      hardBreak: last.hardBreak,
      ...metrics,
    })
    lineStart = lineEnd
  }
  if (clusters.at(-1)?.hardBreak === true) {
    const metrics = metricsForLine(shaper, [], prepared.styles[0]?.style)
    lines.push({
      clusterStart: clusters.length,
      clusterEnd: clusters.length,
      textStart: prepared.input.text.length,
      textEnd: prepared.input.text.length,
      advance: 0,
      hardBreak: false,
      ...metrics,
    })
  }
  return lines
}

function metricsForLine(
  shaper: RuntimeShaper,
  clusters: readonly MeasuredCluster[],
  fallback?: ResolvedStyle,
): LineMetrics {
  const styles = clusters.filter(({ hardBreak }) => !hardBreak).map(({ style }) => style)
  if (styles.length === 0 && fallback !== undefined) styles.push(fallback)
  let above = 0
  let below = 0
  for (const style of styles) {
    const font = requireFont(shaper, style.font)
    const scale = style.fontSize / font.metrics.unitsPerEm
    const ascent = font.metrics.ascender * scale
    const descent = -font.metrics.descender * scale
    const natural = (font.metrics.ascender - font.metrics.descender + font.metrics.lineGap) * scale
    const height = style.lineHeight === undefined ? natural : style.fontSize * style.lineHeight
    const leading = Math.max(0, height - ascent - descent)
    above = Math.max(above, ascent + leading / 2)
    below = Math.max(below, descent + leading / 2)
  }
  return { height: above + below, baseline: above }
}

function normalizeConstraints(constraints: ParagraphConstraints = {}): NormalizedConstraints {
  if (!isNonArrayObject(constraints)) throw new TypeError('paragraph constraints must be an object')
  const width = normalizeAxis(constraints.width, 'width')
  const height = normalizeAxis(constraints.height, 'height')
  const maxLines = constraints.maxLines
  if (maxLines !== undefined && (!Number.isSafeInteger(maxLines) || maxLines <= 0)) {
    throw new RangeError('maxLines must be a positive safe integer')
  }
  const wrap = constraints.wrap ?? 'word'
  if (wrap !== 'none' && wrap !== 'word' && wrap !== 'character') {
    throw new RangeError('wrap must be none, word, or character')
  }
  const align = constraints.align ?? 'start'
  if (align !== 'start' && align !== 'center' && align !== 'end' && align !== 'justify') {
    throw new RangeError('align must be start, center, end, or justify')
  }
  const overflow = constraints.overflow ?? 'visible'
  if (overflow !== 'visible' && overflow !== 'clip' && overflow !== 'ellipsis') {
    throw new RangeError('overflow must be visible, clip, or ellipsis')
  }
  return {
    width,
    height,
    ...(maxLines === undefined ? {} : { maxLines }),
    wrap,
    align,
    overflow,
  }
}

function normalizeAxis(
  constraint: ParagraphAxisConstraint | undefined,
  name: string,
): ParagraphAxisConstraint {
  if (constraint === undefined) return { mode: 'unconstrained' }
  if (!isNonArrayObject(constraint)) throw new TypeError(`${name} constraint must be an object`)
  if (constraint.mode === 'unconstrained') return { mode: 'unconstrained' }
  if (constraint.mode !== 'at-most' && constraint.mode !== 'exactly') {
    throw new RangeError(`${name} mode must be unconstrained, at-most, or exactly`)
  }
  return { mode: constraint.mode, size: finiteNonnegative(constraint.size, `${name} size`) }
}

function constraintKey(constraints: NormalizedConstraints): string {
  return JSON.stringify(constraints)
}

function linePlanConstraintKey(constraints: NormalizedConstraints): string {
  return JSON.stringify({
    width: constraints.width,
    wrap: constraints.wrap,
  })
}

function geometryLinesKey(
  positioningKey: string,
  align: NormalizedConstraints['align'],
  boxWidth: number,
): string {
  return JSON.stringify({
    positioningKey,
    align,
    boxWidth,
  })
}

function positioningLinesKey(lines: readonly LinePlan[]): string {
  return JSON.stringify(
    lines.map((line) => ({
      clusterStart: line.clusterStart,
      clusterEnd: line.clusterEnd,
      textStart: line.textStart,
      textEnd: line.textEnd,
      hardBreak: line.hardBreak,
      ...(line.ellipsis === undefined
        ? {}
        : {
            ellipsis: {
              sourceRun: line.ellipsis.sourceRun,
              shapeRun: line.ellipsis.shapeRun,
              cluster: line.ellipsis.cluster,
              level: line.ellipsis.level,
            },
          }),
    })),
  )
}

function positionPrepared(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  lines: readonly LinePlan[],
  positioning: PreparedPositioning,
  constraints: NormalizedConstraints,
  boxWidth: number,
): PositionedGeometry {
  if (lines.length === 0) return emptyGeometry()
  const { fragments, reshaped } = positioning
  const reshapeRunByFragment = new Map<number, number>()
  let reshapeRun = 0
  for (const [fragmentIndex, fragment] of fragments.entries()) {
    if (!fragment.reshape) continue
    reshapeRunByFragment.set(fragmentIndex, reshapeRun)
    reshapeRun += 1
  }

  const fontHandles: number[] = []
  const fontSlots = new Map<FontHandle, number>()
  const glyphFontSlots: number[] = []
  const glyphIds: number[] = []
  const clusters: number[] = []
  const glyphFontSizes: number[] = []
  const x: number[] = []
  const y: number[] = []
  const glyphFlags: number[] = []
  const lineTextStarts: number[] = []
  const lineTextEnds: number[] = []
  const lineGlyphStarts: number[] = []
  const lineGlyphCounts: number[] = []
  const lineBaselines: number[] = []
  const lineAdvances: number[] = []
  let blockOffset = 0
  let fragmentIndex = 0

  for (const [lineIndex, line] of lines.entries()) {
    const lineGlyphStart = glyphIds.length
    const justificationCounts: number[] = []
    let passedSpaces = 0
    let cursor = 0
    const baseline = blockOffset + line.baseline
    while (fragments[fragmentIndex]?.line === lineIndex) {
      const fragment = fragments[fragmentIndex]
      if (fragment === undefined) break
      const run = prepared.runs[fragment.run]
      if (run === undefined) throw new Error('line fragment references a missing shaping run')
      const reshapedRun = reshapeRunByFragment.get(fragmentIndex)
      const source = reshapedRun === undefined ? prepared.shape : reshaped
      const sourceRun = fragment.ellipsis?.shapeRun ?? reshapedRun ?? fragment.run
      if (source === undefined) throw new Error('boundary reshape result is missing')
      const glyphStart = source.runGlyphStarts[sourceRun]
      const glyphCount = source.runGlyphCounts[sourceRun]
      if (glyphStart === undefined || glyphCount === undefined) {
        throw new Error('shaper returned an incomplete positioned run')
      }
      let slot = fontSlots.get(run.style.font)
      if (slot === undefined) {
        slot = fontHandles.length
        fontHandles.push(run.style.font)
        fontSlots.set(run.style.font, slot)
      }
      const font = requireFont(shaper, run.style.font)
      const scale = run.style.fontSize / font.metrics.unitsPerEm
      const selectedStart = fragment.ellipsis?.textStart ?? fragment.start
      const selectedEnd = fragment.ellipsis?.textEnd ?? fragment.end
      const selected = glyphIndexes(source, glyphStart, glyphCount, selectedStart, selectedEnd)
      let clusterBoundary = run.direction === 'ltr' ? fragment.start : fragment.end
      for (const [selectedIndex, glyph] of selected.entries()) {
        const cluster = source.clusters[glyph]
        const glyphId = source.glyphIds[glyph]
        const xAdvance = source.xAdvances[glyph]
        const xOffset = source.xOffsets[glyph]
        const yOffset = source.yOffsets[glyph]
        const flags = source.glyphFlags[glyph]
        if (
          cluster === undefined ||
          glyphId === undefined ||
          xAdvance === undefined ||
          xOffset === undefined ||
          yOffset === undefined ||
          flags === undefined
        ) {
          throw new Error('shaper returned an incomplete positioned glyph')
        }
        glyphFontSlots.push(slot)
        glyphIds.push(glyphId)
        clusters.push(fragment.ellipsis?.cluster ?? cluster)
        glyphFontSizes.push(run.style.fontSize)
        justificationCounts.push(passedSpaces)
        x.push(cursor + xOffset * scale)
        y.push(baseline - yOffset * scale)
        glyphFlags.push(flags)
        cursor += Math.abs(xAdvance) * scale
        const nextGlyph = selected[selectedIndex + 1]
        const nextCluster = nextGlyph === undefined ? selectedEnd : source.clusters[nextGlyph]
        if (nextCluster !== cluster && fragment.ellipsis === undefined) {
          const rangeStart = run.direction === 'ltr' ? cluster : Math.min(cluster, clusterBoundary)
          const rangeEnd =
            run.direction === 'ltr'
              ? (nextCluster ?? fragment.end)
              : Math.max(cluster, clusterBoundary)
          cursor += spacingBetween(prepared, rangeStart, rangeEnd)
          passedSpaces += justificationSpaces(prepared, line, rangeStart, rangeEnd)
          clusterBoundary = cluster
        }
      }
      fragmentIndex += 1
    }
    const available = Math.max(0, boxWidth - cursor)
    if (
      constraints.align === 'justify' &&
      !line.hardBreak &&
      lineIndex < lines.length - 1 &&
      passedSpaces > 0
    ) {
      const perSpace = available / passedSpaces
      for (let glyph = lineGlyphStart; glyph < glyphIds.length; glyph += 1) {
        x[glyph] = (x[glyph] ?? 0) + (justificationCounts[glyph - lineGlyphStart] ?? 0) * perSpace
      }
      cursor += available
    } else {
      const paragraphDirection = directionForLevel(paragraphLevelAt(prepared.bidi, line.textStart))
      const offset = alignmentOffset(constraints.align, paragraphDirection, available)
      if (offset !== 0) {
        for (let glyph = lineGlyphStart; glyph < glyphIds.length; glyph += 1) {
          x[glyph] = (x[glyph] ?? 0) + offset
        }
      }
    }
    lineTextStarts.push(line.textStart)
    lineTextEnds.push(line.textEnd)
    lineGlyphStarts.push(lineGlyphStart)
    lineGlyphCounts.push(glyphIds.length - lineGlyphStart)
    lineBaselines.push(baseline)
    lineAdvances.push(cursor)
    blockOffset += line.height
  }

  return {
    fontHandles: Uint32Array.from(fontHandles),
    glyphFontSlots: Uint16Array.from(glyphFontSlots),
    glyphIds: Uint16Array.from(glyphIds),
    clusters: Uint32Array.from(clusters),
    glyphFontSizes: Float32Array.from(glyphFontSizes),
    x: Float32Array.from(x),
    y: Float32Array.from(y),
    glyphFlags: Uint16Array.from(glyphFlags),
    lineTextStarts: Uint32Array.from(lineTextStarts),
    lineTextEnds: Uint32Array.from(lineTextEnds),
    lineGlyphStarts: Uint32Array.from(lineGlyphStarts),
    lineGlyphCounts: Uint32Array.from(lineGlyphCounts),
    lineBaselines: Float32Array.from(lineBaselines),
    lineAdvances: Float32Array.from(lineAdvances),
  }
}

function preparePositioning(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  lines: readonly LinePlan[],
): PreparedPositioning {
  const fragments = collectLineFragments(prepared, lines)
  const ranges: ReshapeRange[] = []
  for (const fragment of fragments) {
    if (!fragment.reshape) continue
    const run = prepared.runs[fragment.run]
    if (run === undefined) throw new Error('line fragment references a missing shaping run')
    ranges.push({
      run: fragment.run,
      itemStart: fragment.start,
      itemEnd: fragment.end,
      contextStart: run.start,
      contextEnd: run.end,
      flags: fragment.flags,
    })
  }
  const reshaped =
    ranges.length === 0
      ? undefined
      : ownShape(shaper.reshapeRanges({ ...prepared.request, ranges }))
  return { fragments, ...(reshaped === undefined ? {} : { reshaped }) }
}

function alignmentOffset(
  align: NormalizedConstraints['align'],
  direction: 'ltr' | 'rtl',
  available: number,
): number {
  if (align === 'center') return available / 2
  if (align === 'end') return direction === 'ltr' ? available : 0
  if (align === 'start') return direction === 'rtl' ? available : 0
  return direction === 'rtl' ? available : 0
}

function justificationSpaces(
  prepared: PreparedParagraph,
  line: LinePlan,
  start: number,
  end: number,
): number {
  let trimmedEnd = line.textEnd
  while (trimmedEnd > line.textStart && prepared.input.text.charCodeAt(trimmedEnd - 1) === 0x20) {
    trimmedEnd -= 1
  }
  return clusterRangeSum(
    prepared.clusterStarts,
    prepared.spacePrefix,
    start,
    Math.min(end, trimmedEnd),
  )
}

function collectLineFragments(
  prepared: PreparedParagraph,
  lines: readonly LinePlan[],
): readonly LineFragment[] {
  const fragments: LineFragment[] = []
  for (const [lineIndex, line] of lines.entries()) {
    const levels = reorderedLineLevels(prepared.bidi, line.textStart, line.textEnd)
    const logical = []
    for (const [runIndex, run] of prepared.runs.entries()) {
      const start = Math.max(line.textStart, run.start)
      const end = Math.min(line.textEnd, run.end)
      if (start >= end) continue
      let fragmentStart = start
      while (fragmentStart < end) {
        const localStart = fragmentStart - line.textStart
        const resolvedLevel = levels[localStart] ?? run.bidiLevel
        const level =
          run.style.bidiOverride === undefined
            ? resolvedLevel
            : forceLevelDirection(resolvedLevel, run.direction)
        let fragmentEnd = fragmentStart + 1
        while (fragmentEnd < end) {
          const nextResolved = levels[fragmentEnd - line.textStart] ?? run.bidiLevel
          const nextLevel =
            run.style.bidiOverride === undefined
              ? nextResolved
              : forceLevelDirection(nextResolved, run.direction)
          if (nextLevel !== level) break
          fragmentEnd += 1
        }
        logical.push({ run: runIndex, start: fragmentStart, end: fragmentEnd, level })
        fragmentStart = fragmentEnd
      }
    }
    const decorated: Omit<LineFragment, 'line'>[] = logical.map((fragment, logicalIndex) => {
      const first = logicalIndex === 0
      const last = logicalIndex === logical.length - 1
      const run = prepared.runs[fragment.run]
      if (run === undefined) throw new Error('line fragment references a missing shaping run')
      const boundaryLine = (first && line.textStart > run.start) || (last && line.textEnd < run.end)
      const unsafe = fragmentHasFlag(
        prepared,
        fragment.run,
        fragment.start,
        fragment.end,
        GLYPH_UNSAFE_TO_CONCAT,
      )
      return {
        ...fragment,
        flags:
          PRODUCE_UNSAFE_TO_CONCAT | (first ? BEGINNING_OF_TEXT : 0) | (last ? END_OF_TEXT : 0),
        reshape: boundaryLine && unsafe,
      }
    })
    if (line.ellipsis !== undefined) {
      decorated.push({
        run: line.ellipsis.sourceRun,
        start: line.ellipsis.cluster,
        end: line.ellipsis.cluster,
        level: line.ellipsis.level,
        flags: PRODUCE_UNSAFE_TO_CONCAT,
        reshape: false,
        ellipsis: line.ellipsis,
      })
    }
    for (const fragment of reorderFragments(decorated)) {
      fragments.push({ line: lineIndex, ...fragment })
    }
  }
  return fragments
}

function reorderedLineLevels(bidi: OwnedBidiAnalysis, start: number, end: number): Uint8Array {
  const levels = bidi.levels.slice(start, end)
  const classes = bidi.classes.subarray(start, end)
  const paragraphLevel = paragraphLevelAt(bidi, start)
  let resetFrom: number | undefined = 0
  let resetTo: number | undefined
  let previousLevel = paragraphLevel
  for (let index = 0; index < classes.length; index += 1) {
    const bidiClass = classes[index]
    if (bidiClass === BIDI_B || bidiClass === BIDI_S) {
      resetTo = index + 1
      resetFrom ??= index
    } else if (
      bidiClass === BIDI_WS ||
      bidiClass === BIDI_FSI ||
      bidiClass === BIDI_LRI ||
      bidiClass === BIDI_RLI ||
      bidiClass === BIDI_PDI
    ) {
      resetFrom ??= index
    } else if (
      bidiClass === BIDI_RLE ||
      bidiClass === BIDI_LRE ||
      bidiClass === BIDI_RLO ||
      bidiClass === BIDI_LRO ||
      bidiClass === BIDI_PDF ||
      bidiClass === BIDI_BN
    ) {
      resetFrom ??= index
      levels[index] = previousLevel
    } else {
      resetFrom = undefined
    }
    if (resetFrom !== undefined && resetTo !== undefined) {
      levels.fill(paragraphLevel, resetFrom, resetTo)
      resetFrom = undefined
      resetTo = undefined
    }
    previousLevel = levels[index] ?? paragraphLevel
  }
  if (resetFrom !== undefined) levels.fill(paragraphLevel, resetFrom)
  return levels
}

function paragraphLevelAt(bidi: OwnedBidiAnalysis, offset: number): number {
  for (let index = 0; index < bidi.paragraphStarts.length; index += 1) {
    const start = bidi.paragraphStarts[index]
    const end = bidi.paragraphEnds[index]
    if (start !== undefined && end !== undefined && start <= offset && offset < end) {
      return bidi.paragraphLevels[index] ?? 0
    }
  }
  return bidi.paragraphLevels.at(-1) ?? 0
}

function reorderFragments<Fragment extends { readonly level: number }>(
  logical: readonly Fragment[],
): readonly Fragment[] {
  const visual = [...logical]
  let maximum = 0
  let lowestOdd = Number.POSITIVE_INFINITY
  for (const fragment of visual) {
    maximum = Math.max(maximum, fragment.level)
    if ((fragment.level & 1) === 1) lowestOdd = Math.min(lowestOdd, fragment.level)
  }
  if (!Number.isFinite(lowestOdd)) return visual
  for (let level = maximum; level >= lowestOdd; level -= 1) {
    let start = 0
    while (start < visual.length) {
      while (start < visual.length && (visual[start]?.level ?? -1) < level) start += 1
      let end = start
      while (end < visual.length && (visual[end]?.level ?? -1) >= level) end += 1
      reverse(visual, start, end)
      start = end
    }
  }
  return visual
}

function reverse<Value>(values: Value[], start: number, end: number): void {
  for (let left = start, right = end - 1; left < right; left += 1, right -= 1) {
    const value = values[left]
    if (value === undefined) break
    values[left] = values[right] as Value
    values[right] = value
  }
}

function fragmentHasFlag(
  prepared: PreparedParagraph,
  runIndex: number,
  start: number,
  end: number,
  flag: number,
): boolean {
  const glyphStart = prepared.shape.runGlyphStarts[runIndex]
  const glyphCount = prepared.shape.runGlyphCounts[runIndex]
  if (glyphStart === undefined || glyphCount === undefined) return true
  const selected = glyphIndexes(prepared.shape, glyphStart, glyphCount, start, end)
  const first = selected[0]
  const last = selected.at(-1)
  return (
    first === undefined ||
    last === undefined ||
    ((prepared.shape.glyphFlags[first] ?? flag) & flag) !== 0 ||
    ((prepared.shape.glyphFlags[last] ?? flag) & flag) !== 0
  )
}

function glyphIndexes(
  shape: OwnedShape,
  glyphStart: number,
  glyphCount: number,
  textStart: number,
  textEnd: number,
): number[] {
  if (glyphCount === 0 || textEnd <= textStart) return []
  const firstCluster = shape.clusters[glyphStart]
  const lastCluster = shape.clusters[glyphStart + glyphCount - 1]
  if (firstCluster === undefined || lastCluster === undefined) {
    throw new Error('shaper returned an incomplete glyph cluster table')
  }
  const ascending = firstCluster <= lastCluster
  const selectedStart = ascending
    ? glyphLowerBound(shape.clusters, glyphStart, glyphCount, textStart)
    : glyphBelow(shape.clusters, glyphStart, glyphCount, textEnd)
  const selectedEnd = ascending
    ? glyphLowerBound(shape.clusters, glyphStart, glyphCount, textEnd)
    : glyphBelow(shape.clusters, glyphStart, glyphCount, textStart)
  const indexes: number[] = []
  for (let glyph = selectedStart; glyph < selectedEnd; glyph += 1) indexes.push(glyph)
  return indexes
}

function glyphLowerBound(
  clusters: Uint32Array,
  glyphStart: number,
  glyphCount: number,
  target: number,
): number {
  let low = glyphStart
  let high = glyphStart + glyphCount
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((clusters[middle] ?? 0) < target) low = middle + 1
    else high = middle
  }
  return low
}

function glyphBelow(
  clusters: Uint32Array,
  glyphStart: number,
  glyphCount: number,
  target: number,
): number {
  let low = glyphStart
  let high = glyphStart + glyphCount
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((clusters[middle] ?? 0) >= target) low = middle + 1
    else high = middle
  }
  return low
}

function spacingBetween(prepared: PreparedParagraph, start: number, end: number): number {
  return clusterRangeSum(prepared.clusterStarts, prepared.letterSpacingPrefix, start, end)
}

function clusterRangeSum(
  starts: Uint32Array,
  prefix: Uint32Array | Float64Array,
  start: number,
  end: number,
): number {
  if (end <= start) return 0
  const first = lowerBound(starts, start)
  const afterLast = lowerBound(starts, end)
  return (prefix[afterLast] ?? 0) - (prefix[first] ?? 0)
}

function lowerBound(values: Uint32Array, target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((values[middle] ?? 0) < target) low = middle + 1
    else high = middle
  }
  return low
}

function measurementForGeometry(
  constraints: NormalizedConstraints,
  measured: ParagraphMeasurement,
  geometry: PositionedGeometry,
): ParagraphMeasurement {
  const contentWidth = maxArray(geometry.lineAdvances)
  const requiredContentWidth = Math.max(contentWidth, measured.contentWidth)
  const width = resolveAxis(constraints.width, requiredContentWidth)
  const height = measured.height
  return {
    width,
    height,
    contentWidth: requiredContentWidth,
    contentHeight: measured.contentHeight,
    firstBaseline: geometry.lineBaselines[0] ?? 0,
    lastBaseline: geometry.lineBaselines.at(-1) ?? 0,
    overflowed:
      measured.overflowed || requiredContentWidth > width || measured.contentHeight > height,
  }
}

function maxArray(values: Float32Array): number {
  let maximum = 0
  for (const value of values) maximum = Math.max(maximum, value)
  return maximum
}

function emptyGeometry(): PositionedGeometry {
  return {
    fontHandles: new Uint32Array(),
    glyphFontSlots: new Uint16Array(),
    glyphIds: new Uint16Array(),
    clusters: new Uint32Array(),
    glyphFontSizes: new Float32Array(),
    x: new Float32Array(),
    y: new Float32Array(),
    glyphFlags: new Uint16Array(),
    lineTextStarts: new Uint32Array(),
    lineTextEnds: new Uint32Array(),
    lineGlyphStarts: new Uint32Array(),
    lineGlyphCounts: new Uint32Array(),
    lineBaselines: new Float32Array(),
    lineAdvances: new Float32Array(),
  }
}

function resolveAxis(constraint: ParagraphAxisConstraint, content: number): number {
  if (constraint.mode === 'unconstrained') return content
  if (constraint.mode === 'at-most') return Math.min(content, constraint.size)
  return constraint.size
}

function requireFont(shaper: RuntimeShaper, handle: FontHandle): RegisteredFont {
  const font = shaper.registry.getByHandle(handle)
  if (font === undefined)
    throw new RangeError(`font handle ${handle} is not active in the registry`)
  return font
}

function drawableFragments(
  text: string,
  start: number,
  end: number,
): readonly { readonly start: number; readonly end: number }[] {
  const fragments = []
  let fragmentStart = start
  let offset = start
  while (offset < end) {
    const codePoint = text.codePointAt(offset)
    if (codePoint === undefined) break
    const length = codePoint > 0xffff ? 2 : 1
    if (isHardBreakCodePoint(codePoint)) {
      if (fragmentStart < offset) fragments.push({ start: fragmentStart, end: offset })
      offset += length
      if (codePoint === 0x0d && text.charCodeAt(offset) === 0x0a) offset += 1
      fragmentStart = offset
    } else {
      offset += length
    }
  }
  if (fragmentStart < end) fragments.push({ start: fragmentStart, end })
  return fragments
}

function isHardBreak(text: string, offset: number): boolean {
  const codePoint = text.codePointAt(offset)
  return codePoint !== undefined && isHardBreakCodePoint(codePoint)
}

function isHardBreakCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x0a ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    codePoint === 0x0d ||
    codePoint === 0x85 ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  )
}

function equalStyles(left: ResolvedStyle, right: ResolvedStyle): boolean {
  return (
    left.font === right.font &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.letterSpacing === right.letterSpacing &&
    left.language === right.language &&
    left.direction === right.direction &&
    left.bidiOverride === right.bidiOverride &&
    equalFeatures(left.features, right.features)
  )
}

function equalFeatures(
  left: readonly ResolvedFontFeature[],
  right: readonly ResolvedFontFeature[],
): boolean {
  return (
    left.length === right.length &&
    left.every((feature, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        feature.tag === other.tag &&
        feature.value === other.value &&
        feature.start === other.start &&
        feature.end === other.end
      )
    })
  )
}

function ownShape(shape: ShapedBatchViews): OwnedShape {
  return {
    fontHandles: shape.fontHandles.slice(),
    runFontSlots: shape.runFontSlots.slice(),
    runGlyphStarts: shape.runGlyphStarts.slice(),
    runGlyphCounts: shape.runGlyphCounts.slice(),
    glyphIds: shape.glyphIds.slice(),
    clusters: shape.clusters.slice(),
    xAdvances: shape.xAdvances.slice(),
    yAdvances: shape.yAdvances.slice(),
    xOffsets: shape.xOffsets.slice(),
    yOffsets: shape.yOffsets.slice(),
    glyphFlags: shape.glyphFlags.slice(),
  }
}

function ownBidi(bidi: BidiAnalysisViews): OwnedBidiAnalysis {
  return {
    levels: bidi.levels.slice(),
    classes: bidi.classes.slice(),
    paragraphStarts: bidi.paragraphStarts.slice(),
    paragraphEnds: bidi.paragraphEnds.slice(),
    paragraphLevels: bidi.paragraphLevels.slice(),
  }
}

function utf16(text: string): Uint16Array {
  const result = new Uint16Array(text.length)
  for (let index = 0; index < text.length; index += 1) result[index] = text.charCodeAt(index)
  return result
}

function emptyShape(): OwnedShape {
  return {
    fontHandles: new Uint32Array(),
    runFontSlots: new Uint16Array(),
    runGlyphStarts: new Uint32Array(),
    runGlyphCounts: new Uint32Array(),
    glyphIds: new Uint16Array(),
    clusters: new Uint32Array(),
    xAdvances: new Int32Array(),
    yAdvances: new Int32Array(),
    xOffsets: new Int32Array(),
    yOffsets: new Int32Array(),
    glyphFlags: new Uint16Array(),
  }
}

function assertTextRange(start: number, end: number, textLength: number, name: string): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > textLength
  ) {
    throw new RangeError(`${name} must be a non-empty UTF-16 range inside the paragraph`)
  }
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
  return value
}

function isNonArrayObject<T>(value: T): value is T & object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be finite and positive`)
  return value
}

function finiteNonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be finite and nonnegative`)
  return value
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined
  if (typeof language !== 'string') throw new TypeError('language must be a string')
  const normalized = language.trim().toLowerCase()
  if (normalized.length === 0) throw new RangeError('language must not be empty')
  return normalized
}
