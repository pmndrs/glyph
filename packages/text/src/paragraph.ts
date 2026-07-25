import type { FontHandle } from './identity.js'
import type { ParagraphLayout, ParagraphMeasurement } from './layout.js'
import type { FontFeature, ResolvedFontFeature } from './text.js'
import type { RegisteredFont } from './font.js'
import type { RuntimeShaper, ShapeRunRequest, ShapedBatchViews } from './shaper.js'
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
  readonly features: readonly ResolvedFontFeature[]
}

interface StyleSegment {
  readonly start: number
  readonly end: number
  readonly style: ResolvedStyle
}

interface PreparedRun extends StyleSegment {
  readonly script: string
  readonly direction: 'ltr' | 'rtl'
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
}

interface PreparedParagraph {
  readonly input: ParagraphInput
  readonly unicode: UnicodeTextAnalysis
  readonly styles: readonly StyleSegment[]
  readonly runs: readonly PreparedRun[]
  readonly shape: OwnedShape
  readonly clusters: readonly MeasuredCluster[]
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

const DEFAULT_FONT_SIZE = 16
const PRODUCE_UNSAFE_TO_CONCAT = 0x40
const GLYPH_UNSAFE_TO_BREAK = 0x01

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
    normalizeConstraints(constraints)
    throw new Error('positioned paragraph layout is not available until roadmap item 5.2')
  }

  update(input: ParagraphInput): void {
    this.#assertActive()
    this.#prepared = prepareParagraph(this.#shaper, input)
    this.#measurements.clear()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#measurements.clear()
  }

  #measurePlan(constraints: NormalizedConstraints): MeasuredPlan {
    const key = constraintKey(constraints)
    let plan = this.#measurements.get(key)
    if (plan === undefined) {
      plan = measurePrepared(this.#shaper, this.#prepared, constraints)
      this.#measurements.set(key, plan)
    }
    return plan
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph has been disposed')
  }
}

function prepareParagraph(shaper: RuntimeShaper, input: ParagraphInput): PreparedParagraph {
  const ownedInput = copyInput(input)
  const unicode = analyzeUnicodeText(ownedInput.text)
  const styles = resolveStyles(shaper, ownedInput, unicode.graphemeBoundaries)
  const runs = prepareRuns(ownedInput.text, styles, unicode)
  const request = shapeRequest(ownedInput.text, runs)
  const borrowed = request.runs.length === 0
    ? emptyShape()
    : shaper.shapeBatch(request)
  const shape = ownShape(borrowed)
  const clusters = measureClusters(shaper, ownedInput.text, unicode, styles, runs, shape)
  return { input: ownedInput, unicode, styles, runs, shape, clusters }
}

function copyInput(input: ParagraphInput): ParagraphInput {
  if (typeof input?.text !== 'string') throw new TypeError('paragraph text must be a string')
  return {
    text: input.text,
    font: input.font,
    ...(input.style === undefined ? {} : { style: copyStyle(input.style) }),
    ...(input.spans === undefined
      ? {}
      : { spans: input.spans.map((span) => ({ ...copyStyle(span), start: span.start, end: span.end, ...(span.font === undefined ? {} : { font: span.font }) })) }),
  }
}

function copyStyle(style: ParagraphStyle): ParagraphStyle {
  return {
    ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize }),
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
    ...(style.letterSpacing === undefined ? {} : { letterSpacing: style.letterSpacing }),
    ...(style.language === undefined ? {} : { language: style.language }),
    ...(style.direction === undefined ? {} : { direction: style.direction }),
    ...(style.features === undefined
      ? {}
      : { features: style.features.map((feature) => ({ ...feature })) }),
  }
}

function resolveStyles(
  shaper: RuntimeShaper,
  input: ParagraphInput,
  graphemeBoundaries: Uint32Array,
): readonly StyleSegment[] {
  const boundaries = new Set<number>([0, input.text.length])
  const legalBoundaries = new Set(graphemeBoundaries)
  for (const span of input.spans ?? []) {
    assertTextRange(span.start, span.end, input.text.length, 'paragraph span')
    if (!legalBoundaries.has(span.start) || !legalBoundaries.has(span.end)) {
      throw new RangeError('paragraph span boundaries must be extended-grapheme boundaries')
    }
    boundaries.add(span.start)
    boundaries.add(span.end)
  }
  const sorted = [...boundaries].sort((left, right) => left - right)
  const root = resolveStyle(shaper, input.font, input.style ?? {}, 0, input.text.length)
  const segments: StyleSegment[] = []
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    if (start === undefined || end === undefined || start === end) continue
    let style = root
    for (const span of input.spans ?? []) {
      if (span.start <= start && span.end >= end) {
        style = mergeStyle(shaper, style, span, span.start, span.end)
      }
    }
    const previous = segments.at(-1)
    if (previous !== undefined && previous.end === start && equalStyles(previous.style, style)) {
      segments[segments.length - 1] = { ...previous, end }
    } else {
      segments.push({ start, end, style })
    }
  }
  return segments
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
  const lineHeight = style.lineHeight === undefined
    ? undefined
    : finitePositive(style.lineHeight, 'lineHeight')
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

function mergeStyle(
  shaper: RuntimeShaper,
  base: ResolvedStyle,
  span: ParagraphSpan,
  start: number,
  end: number,
): ResolvedStyle {
  const fontHandle = span.font ?? base.font
  const font = requireFont(shaper, fontHandle)
  shaper.registerFont(font)
  const fontSize = span.fontSize === undefined
    ? base.fontSize
    : finitePositive(span.fontSize, 'fontSize')
  const lineHeight = span.lineHeight === undefined
    ? base.lineHeight
    : finitePositive(span.lineHeight, 'lineHeight')
  const letterSpacing = span.letterSpacing === undefined
    ? base.letterSpacing
    : finite(span.letterSpacing, 'letterSpacing')
  const language = span.language === undefined ? base.language : normalizeLanguage(span.language)
  return {
    font: fontHandle,
    fontSize,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    letterSpacing,
    ...(language === undefined ? {} : { language }),
    direction: span.direction ?? base.direction,
    features: span.features === undefined ? base.features : resolveFeatures(span.features, start, end),
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
    if (start < containingStart) throw new RangeError(`feature ${feature.tag} starts before its style range`)
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
): readonly PreparedRun[] {
  const runs: PreparedRun[] = []
  for (const style of styles) {
    for (const script of unicode.scriptItems) {
      const start = Math.max(style.start, script.start)
      const end = Math.min(style.end, script.end)
      if (start >= end) continue
      for (const fragment of drawableFragments(text, start, end)) {
        const run: PreparedRun = {
          ...fragment,
          style: style.style,
          script: script.script,
          direction: style.style.direction === 'rtl' ? 'rtl' : 'ltr',
        }
        const previous = runs.at(-1)
        if (
          previous !== undefined &&
          previous.end === run.start &&
          previous.script === run.script &&
          previous.direction === run.direction &&
          equalStyles(previous.style, run.style)
        ) {
          runs[runs.length - 1] = { ...previous, end: run.end }
        } else {
          runs.push(run)
        }
      }
    }
  }
  runs.sort((left, right) => left.start - right.start || left.end - right.end)
  return runs
}

function shapeRequest(text: string, runs: readonly PreparedRun[]): {
  readonly textUtf16: Uint16Array
  readonly runs: readonly ShapeRunRequest[]
  readonly features: readonly ResolvedFontFeature[]
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
  const textUtf16 = new Uint16Array(text.length)
  for (let index = 0; index < text.length; index += 1) textUtf16[index] = text.charCodeAt(index)
  return { textUtf16, runs: shapeRuns, features }
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
  for (let index = 0; index + 1 < unicode.graphemeBoundaries.length; index += 1) {
    const start = unicode.graphemeBoundaries[index]
    const end = unicode.graphemeBoundaries[index + 1]
    if (start === undefined || end === undefined) continue
    const style = styleAt(styles, start)
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

function measurePrepared(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
): MeasuredPlan {
  const widthLimit = constraints.width.mode === 'unconstrained'
    ? Number.POSITIVE_INFINITY
    : constraints.width.size
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

  const lines = breakLines(shaper, prepared, allowed, widthLimit, constraints.wrap)
  const contentWidth = lines.reduce((maximum, line) => Math.max(maximum, line.advance), 0)
  const contentHeight = lines.reduce((sum, line) => sum + line.height, 0)
  const width = resolveAxis(constraints.width, contentWidth)
  const height = resolveAxis(constraints.height, contentHeight)
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
    overflowed: contentWidth > width || contentHeight > height,
  })
  return { measurement, lines }
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
    const metrics = metricsForLine(shaper, clusters.slice(lineStart, lineEnd), prepared.styles[0]?.style)
    lines.push({
      clusterStart: lineStart,
      clusterEnd: lineEnd,
      textStart: first.start,
      textEnd: last.end,
      advance: lineAdvance,
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
  const width = normalizeAxis(constraints.width, 'width')
  const height = normalizeAxis(constraints.height, 'height')
  const maxLines = constraints.maxLines
  if (maxLines !== undefined && (!Number.isSafeInteger(maxLines) || maxLines <= 0)) {
    throw new RangeError('maxLines must be a positive safe integer')
  }
  return {
    width,
    height,
    ...(maxLines === undefined ? {} : { maxLines }),
    wrap: constraints.wrap ?? 'word',
    align: constraints.align ?? 'start',
    overflow: constraints.overflow ?? 'visible',
  }
}

function normalizeAxis(
  constraint: ParagraphAxisConstraint | undefined,
  name: string,
): ParagraphAxisConstraint {
  if (constraint === undefined || constraint.mode === 'unconstrained') {
    return { mode: 'unconstrained' }
  }
  return { mode: constraint.mode, size: finiteNonnegative(constraint.size, `${name} size`) }
}

function constraintKey(constraints: NormalizedConstraints): string {
  return JSON.stringify(constraints)
}

function resolveAxis(constraint: ParagraphAxisConstraint, content: number): number {
  if (constraint.mode === 'unconstrained') return content
  if (constraint.mode === 'at-most') return Math.min(content, constraint.size)
  return constraint.size
}

function requireFont(shaper: RuntimeShaper, handle: FontHandle): RegisteredFont {
  const font = shaper.registry.getByHandle(handle)
  if (font === undefined) throw new RangeError(`font handle ${handle} is not active in the registry`)
  return font
}

function styleAt(styles: readonly StyleSegment[], offset: number): ResolvedStyle {
  const style = styles.find((entry) => entry.start <= offset && offset < entry.end)
  if (style === undefined) throw new Error(`paragraph offset ${offset} has no resolved style`)
  return style.style
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
  return codePoint === 0x0a || codePoint === 0x0b || codePoint === 0x0c || codePoint === 0x0d || codePoint === 0x85 || codePoint === 0x2028 || codePoint === 0x2029
}

function equalStyles(left: ResolvedStyle, right: ResolvedStyle): boolean {
  return left.font === right.font &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.letterSpacing === right.letterSpacing &&
    left.language === right.language &&
    left.direction === right.direction &&
    equalFeatures(left.features, right.features)
}

function equalFeatures(
  left: readonly ResolvedFontFeature[],
  right: readonly ResolvedFontFeature[],
): boolean {
  return left.length === right.length && left.every((feature, index) => {
    const other = right[index]
    return other !== undefined && feature.tag === other.tag && feature.value === other.value && feature.start === other.start && feature.end === other.end
  })
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
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end || end > textLength) {
    throw new RangeError(`${name} must be a non-empty UTF-16 range inside the paragraph`)
  }
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
  return value
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`)
  return value
}

function finiteNonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`)
  return value
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined
  const normalized = language.trim().toLowerCase()
  if (normalized.length === 0) throw new RangeError('language must not be empty')
  return normalized
}
