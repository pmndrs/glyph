import type { FontHandle } from './identity.js';
import type { ParagraphLayout, ParagraphMeasurement } from './layout.js';
import type { FontFeature, ResolvedFontFeature } from './font-feature.js';
import type { RegisteredFont } from './font.js';
import type { BidiAnalysisViews, ReshapeRange, RuntimeShaper, ShapeBatchRequest, ShapedBatchViews } from './shaper.js';
import { analyzeUnicodeText, type UnicodeTextAnalysis } from './internal/unicode.js';
import { resolveSpanCascade, type SpanCascadeEntry } from './internal/span-cascade.js';
import { profileBegin, profileEnd } from './profiler.js';

/**
 * A layout-system-neutral axis constraint.
 *
 * These modes describe the common constraint vocabulary used by flex, grid,
 * retained UI, and application-owned layout systems.
 */
export type ParagraphAxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exactly'; readonly size: number };

export interface ParagraphStyle {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
}

export interface ParagraphSpan extends ParagraphStyle {
  readonly start: number;
  readonly end: number;
  readonly font?: FontHandle;
}

export interface ParagraphInput {
  readonly text: string;
  readonly font: FontHandle;
  readonly spans?: readonly ParagraphSpan[];
  readonly style?: ParagraphStyle;
}

export interface ParagraphConstraints {
  /** Defaults to `{ mode: 'unconstrained' }`. */
  readonly width?: ParagraphAxisConstraint;
  /** Defaults to `{ mode: 'unconstrained' }`. */
  readonly height?: ParagraphAxisConstraint;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
}

/**
 * A prepared paragraph has no asynchronous methods. Font and shaper
 * dependencies must be loaded before it is exposed to a synchronous host
 * layout system.
 */
export interface Paragraph {
  /** Resolve box metrics without materializing positioned glyph arrays. */
  measure(constraints?: ParagraphConstraints): ParagraphMeasurement;
  /** Resolve the final box and materialize positioned glyph output. */
  layout(constraints?: ParagraphConstraints): ParagraphLayout;
  /**
   * Shaped glyph identity, before line breaking and positioning. A caller resolving font fallback needs to know which
   * clusters shaped to `.notdef` and nothing else, and that answer must not depend on where lines happen to break.
   */
  shaped(): ShapedGlyphIdentity;
  update(input: ParagraphInput): void;
  dispose(): void;
}

/** Glyph identity in shaping order, covering every run of the paragraph. */
export interface ShapedGlyphIdentity {
  readonly glyphIds: Uint16Array;
  readonly clusters: Uint32Array;
}

export interface ParagraphEngine {
  create(input: ParagraphInput): Paragraph;
}

export interface ParagraphEngineOptions {
  readonly shaper: RuntimeShaper;
}

interface ResolvedStyle {
  readonly font: FontHandle;
  readonly fontSize: number;
  readonly lineHeight?: number;
  readonly letterSpacing: number;
  readonly language?: string;
  readonly direction: 'auto' | 'ltr' | 'rtl';
  readonly bidiOverride?: 'ltr' | 'rtl';
  readonly features: readonly ResolvedFontFeature[];
}

interface StyleSegment {
  readonly start: number;
  readonly end: number;
  readonly style: ResolvedStyle;
}

/** The shaping properties one span states, before the cascade merges them. */
interface StatedSpanStyle {
  readonly font?: FontHandle;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly ResolvedFontFeature[];
}

interface PreparedRun extends StyleSegment {
  readonly script: string;
  readonly direction: 'ltr' | 'rtl';
  readonly bidiLevel: number;
}

interface OwnedBidiAnalysis {
  readonly levels: Uint8Array;
  readonly classes: Uint8Array;
  readonly paragraphStarts: Uint32Array;
  readonly paragraphEnds: Uint32Array;
  readonly paragraphLevels: Uint8Array;
}

interface OwnedShape {
  readonly fontHandles: Uint32Array;
  readonly runFontSlots: Uint16Array;
  readonly runGlyphStarts: Uint32Array;
  readonly runGlyphCounts: Uint32Array;
  readonly glyphIds: Uint16Array;
  readonly clusters: Uint32Array;
  readonly xAdvances: Int32Array;
  readonly yAdvances: Int32Array;
  readonly xOffsets: Int32Array;
  readonly yOffsets: Int32Array;
  readonly glyphFlags: Uint16Array;
}

/**
 * Every extended grapheme cluster of the paragraph, as parallel arrays rather than one object per cluster. A paragraph
 * holds tens of thousands of clusters and every update rebuilt all of them, which made short-lived cluster objects the
 * largest single source of garbage on the layout path.
 *
 * The backing buffers are retained across updates by {@link measureClusters} and only ever grow, so a steady-state
 * animation reuses them. `count` is the live length; the views are sliced to it, and the buffers behind them may be
 * larger.
 */
interface MeasuredClusters {
  readonly count: number;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
  /**
   * Double precision. Line breaking accumulates a line advance from these one cluster at a time and the result is
   * compared against the width limit, so rounding each cluster to single precision would move where lines break.
   */
  readonly advances: Float64Array;
  /** {@link CLUSTER_SAFE_BEFORE}, {@link CLUSTER_REQUIRED_BREAK}, and {@link CLUSTER_HARD_BREAK}. */
  readonly flags: Uint8Array;
  /** Index into {@link PreparedParagraph.styles}, so a cluster carries its style without holding a reference. */
  readonly styleIndexes: Uint32Array;
}

interface LineMetrics {
  readonly height: number;
  readonly baseline: number;
}

interface LinePlan extends LineMetrics {
  readonly clusterStart: number;
  readonly clusterEnd: number;
  readonly textStart: number;
  readonly textEnd: number;
  readonly advance: number;
  readonly hardBreak: boolean;
  readonly ellipsis?: EllipsisPlan;
}

interface EllipsisPlan {
  readonly sourceRun: number;
  readonly shapeRun: number;
  readonly textStart: number;
  readonly textEnd: number;
  readonly cluster: number;
  readonly advance: number;
  readonly level: number;
}

interface PreparedEllipsis {
  readonly sourceRun: number;
  readonly shapeRun: number;
  readonly textStart: number;
  readonly textEnd: number;
  readonly advance: number;
}

interface PreparedParagraph {
  readonly input: ParagraphInput;
  readonly unicode: UnicodeTextAnalysis;
  readonly bidi: OwnedBidiAnalysis;
  readonly styles: readonly StyleSegment[];
  readonly runs: readonly PreparedRun[];
  readonly request: ShapeBatchRequest;
  readonly shape: OwnedShape;
  readonly ellipses: readonly PreparedEllipsis[];
  readonly clusters: MeasuredClusters;
  /**
   * Cluster index for every text offset, so resolving an offset to a cluster is a load rather than a binary search.
   * Positioning resolves two offsets at every cluster boundary of every glyph, which made that search the hottest leaf
   * in a browser profile of the layout path.
   */
  readonly clusterIndexAt: Uint32Array;
  readonly letterSpacingPrefix: Float64Array;
  readonly spacePrefix: Uint32Array;
}

interface NormalizedConstraints {
  readonly width: ParagraphAxisConstraint;
  readonly height: ParagraphAxisConstraint;
  readonly maxLines?: number;
  readonly wrap: 'none' | 'word' | 'character';
  readonly align: 'start' | 'center' | 'end' | 'justify';
  readonly overflow: 'visible' | 'clip' | 'ellipsis';
}

interface MeasuredPlan {
  readonly measurement: ParagraphMeasurement;
  readonly lines: readonly LinePlan[];
}

/**
 * A fragment under construction. {@link collectLineFragments} appends fragments in logical order, then fills the
 * shaping flags and the reshape decision in place once the line's first and last fragments are known, and reorders the
 * line's own range in place. Published fragments are read-only.
 */
interface LineFragmentDraft {
  line: number;
  run: number;
  start: number;
  end: number;
  flags: number;
  level: number;
  ellipsis?: EllipsisPlan;
  reshape: boolean;
}

type LineFragment = Readonly<LineFragmentDraft>;

interface PositionedGeometry {
  readonly fontHandles: Uint32Array;
  readonly glyphFontSlots: Uint16Array;
  readonly glyphIds: Uint16Array;
  readonly clusters: Uint32Array;
  readonly glyphFontSizes: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly glyphFlags: Uint16Array;
  readonly lineTextStarts: Uint32Array;
  readonly lineTextEnds: Uint32Array;
  readonly lineGlyphStarts: Uint32Array;
  readonly lineGlyphCounts: Uint32Array;
  readonly lineBaselines: Float32Array;
  readonly lineAdvances: Float32Array;
}

interface PreparedPositioning {
  readonly fragments: readonly LineFragment[];
  readonly reshaped?: OwnedShape;
}

const DEFAULT_FONT_SIZE = 16;
const MAX_PARAGRAPH_CACHE_ENTRIES = 32;
const PRODUCE_UNSAFE_TO_CONCAT = 0x40;
const BEGINNING_OF_TEXT = 0x01;
const END_OF_TEXT = 0x02;
const GLYPH_UNSAFE_TO_BREAK = 0x01;
const GLYPH_UNSAFE_TO_CONCAT = 0x02;
/** The cluster starts at a shaping boundary that shaping did not mark unsafe to break. */
const CLUSTER_SAFE_BEFORE = 0x01;
/** Unicode line breaking requires a break after the cluster. */
const CLUSTER_REQUIRED_BREAK = 0x02;
/** The cluster is a hard line separator rather than drawable text. */
const CLUSTER_HARD_BREAK = 0x04;
/** A text offset that shaping treated as a run or cluster boundary. */
const OFFSET_SHAPED_BOUNDARY = 0x01;
/** A text offset that shaping marked unsafe to break at. */
const OFFSET_UNSAFE_TO_BREAK = 0x02;
const BIDI_BN = 9;
const BIDI_B = 10;
const BIDI_S = 11;
const BIDI_WS = 12;
const BIDI_LRE = 14;
const BIDI_LRO = 15;
const BIDI_RLE = 16;
const BIDI_RLO = 17;
const BIDI_PDF = 18;
const BIDI_LRI = 19;
const BIDI_RLI = 20;
const BIDI_FSI = 21;
const BIDI_PDI = 22;

export function createParagraphEngine(options: ParagraphEngineOptions): ParagraphEngine {
  if (options?.shaper === undefined) throw new TypeError('paragraph engine requires a shaper');
  return new ParagraphEngineImpl(options.shaper);
}

class ParagraphEngineImpl implements ParagraphEngine {
  readonly #shaper: RuntimeShaper;

  constructor(shaper: RuntimeShaper) {
    this.#shaper = shaper;
  }

  create(input: ParagraphInput): Paragraph {
    return new ParagraphImpl(this.#shaper, input);
  }
}

class ParagraphImpl implements Paragraph {
  readonly #shaper: RuntimeShaper;
  readonly #measurements = new Map<string, MeasuredPlan>();
  readonly #linePlans = new Map<string, readonly LinePlan[]>();
  readonly #positioning = new Map<string, PreparedPositioning>();
  readonly #positionedLines = new Map<string, PositionedGeometry>();
  readonly #layouts = new Map<string, ParagraphLayout>();
  #prepared: PreparedParagraph;
  #disposed = false;

  constructor(shaper: RuntimeShaper, input: ParagraphInput) {
    this.#shaper = shaper;
    this.#prepared = prepareParagraph(shaper, input);
  }

  measure(constraints?: ParagraphConstraints): ParagraphMeasurement {
    this.#assertActive();
    const normalized = normalizeConstraints(constraints);
    return this.#measurePlan(normalized).measurement;
  }

  layout(constraints?: ParagraphConstraints): ParagraphLayout {
    this.#assertActive();
    const normalized = normalizeConstraints(constraints);
    const key = constraintKey(normalized);
    let layout = getRecent(this.#layouts, key);
    if (layout !== undefined) return layout;
    const measured = this.#measurePlan(normalized);
    const positioningKey = positioningLinesKey(measured.lines);
    const lineKey = geometryLinesKey(positioningKey, normalized.align, measured.measurement.width);
    let geometry = getRecent(this.#positionedLines, lineKey);
    if (geometry === undefined) {
      let positioning = getRecent(this.#positioning, positioningKey);
      if (positioning === undefined) {
        const preparingPositions = profileBegin();
        positioning = preparePositioning(this.#shaper, this.#prepared, measured.lines);
        profileEnd('layout.positioning', preparingPositions);
        retainRecent(this.#positioning, positioningKey, positioning);
      }
      const positioningGeometry = profileBegin();
      geometry = positionPrepared(
        this.#shaper,
        this.#prepared,
        measured.lines,
        positioning,
        normalized,
        measured.measurement.width,
      );
      profileEnd('layout.position', positioningGeometry);
      retainRecent(this.#positionedLines, lineKey, geometry);
    }
    layout = Object.freeze({
      ...measurementForGeometry(normalized, measured.measurement, geometry),
      ...geometry,
    });
    retainRecent(this.#layouts, key, layout);
    return layout;
  }

  shaped(): ShapedGlyphIdentity {
    this.#assertActive();
    const { shape, runs } = this.#prepared;
    // The shaping request appends one ellipsis run per source run, clustered past the end of the text, so a caller
    // inspecting glyph identity must not see them: they are how overflow is measured, not glyphs of this paragraph.
    // Those runs are requested after every source run, so the first of them bounds the paragraph's own glyphs.
    const end = runs.length < shape.runGlyphStarts.length ? (shape.runGlyphStarts[runs.length] ?? 0) : shape.glyphIds.length;
    return { glyphIds: shape.glyphIds.subarray(0, end), clusters: shape.clusters.subarray(0, end) };
  }

  update(input: ParagraphInput): void {
    this.#assertActive();
    this.#prepared = prepareParagraph(this.#shaper, input, this.#prepared);
    this.#measurements.clear();
    this.#linePlans.clear();
    this.#positioning.clear();
    this.#positionedLines.clear();
    this.#layouts.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#measurements.clear();
    this.#linePlans.clear();
    this.#positioning.clear();
    this.#positionedLines.clear();
    this.#layouts.clear();
  }

  #measurePlan(constraints: NormalizedConstraints): MeasuredPlan {
    const key = constraintKey(constraints);
    let plan = getRecent(this.#measurements, key);
    if (plan === undefined) {
      const lineKey = linePlanConstraintKey(constraints);
      let lines = getRecent(this.#linePlans, lineKey);
      if (lines === undefined) {
        const breaking = profileBegin();
        lines = planLines(this.#shaper, this.#prepared, constraints);
        profileEnd('layout.line-break', breaking);
        retainRecent(this.#linePlans, lineKey, lines);
      }
      const measuring = profileBegin();
      plan = measurePrepared(this.#prepared, constraints, lines);
      profileEnd('layout.measure', measuring);
      retainRecent(this.#measurements, key, plan);
    }
    return plan;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph has been disposed');
  }
}

function getRecent<Key, Value>(cache: Map<Key, Value>, key: Key): Value | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function retainRecent<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= MAX_PARAGRAPH_CACHE_ENTRIES) return;
  const oldest = cache.keys().next();
  if (!oldest.done) cache.delete(oldest.value);
}

function prepareParagraph(
  shaper: RuntimeShaper,
  input: ParagraphInput,
  previous?: PreparedParagraph,
): PreparedParagraph {
  const preparing = profileBegin();
  const ownedInput = copyInput(input);
  // Grapheme boundaries, line break opportunities, script items, and bidi levels are decided by the text and its base
  // direction and by nothing else, so a resize, a colour change, or a letter-spacing change all recompute a result
  // identical to the retained one. Both are owned, immutable products, so reusing them is a pointer copy.
  const sameText =
    previous !== undefined &&
    previous.input.text === ownedInput.text &&
    (previous.input.style?.direction ?? 'auto') === (ownedInput.style?.direction ?? 'auto');
  let phase = profileBegin();
  const unicode = sameText ? previous.unicode : analyzeUnicodeText(ownedInput.text);
  profileEnd('prepare.unicode', phase);
  phase = profileBegin();
  const styles = resolveStyles(shaper, ownedInput, unicode.graphemeBoundaries);
  profileEnd('prepare.styles', phase);
  phase = profileBegin();
  const bidi = sameText
    ? previous.bidi
    : ownBidi(shaper.analyzeBidi(utf16(ownedInput.text), ownedInput.style?.direction ?? 'auto'));
  profileEnd('prepare.bidi', phase);
  phase = profileBegin();
  const runs = prepareRuns(ownedInput.text, styles, unicode, bidi);
  const shapedRequest = shapeRequest(ownedInput.text, runs);
  profileEnd('prepare.runs', phase);
  const request = shapedRequest.request;
  // Shaping is deterministic in its request, and the request carries no font size, line height, or letter spacing —
  // those scale the shaped advances afterward. An animated resize therefore rebuilds an identical request, so reusing
  // the retained shape skips the whole shaping pass while every measurement below still recomputes at the new size.
  // A shape is plain owned typed arrays that nothing releases, so retaining one across preparations is safe.
  const reused = previous !== undefined && sameShapeRequest(previous.request, request) ? previous.shape : undefined;
  phase = profileBegin();
  const shape = reused ?? ownShape(request.runs.length === 0 ? emptyShape() : shaper.shapeBatch(request));
  profileEnd('prepare.shape', phase);
  phase = profileBegin();
  const ellipses = measureEllipses(shaper, runs, shape, shapedRequest.ellipses);
  profileEnd('prepare.ellipses', phase);
  phase = profileBegin();
  const clusters = measureClusters(shaper, ownedInput.text, unicode, styles, runs, shape, previous);
  profileEnd('prepare.clusters', phase);
  phase = profileBegin();
  const clusterIndexes = indexClusters(ownedInput.text, styles, clusters, previous);
  profileEnd('prepare.cluster-index', phase);
  profileEnd('prepare', preparing);
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
  };
}

function copyInput(input: ParagraphInput): ParagraphInput {
  if (!isNonArrayObject(input)) throw new TypeError('paragraph input must be an object');
  if (typeof input.text !== 'string') throw new TypeError('paragraph text must be a string');
  if (input.style !== undefined && !isNonArrayObject(input.style)) {
    throw new TypeError('paragraph style must be an object');
  }
  if (input.spans !== undefined && !Array.isArray(input.spans)) {
    throw new TypeError('paragraph spans must be an array');
  }
  return {
    text: input.text,
    font: input.font,
    ...(input.style === undefined ? {} : { style: copyStyle(input.style, 'paragraph style') }),
    ...(input.spans === undefined
      ? {}
      : {
          spans: input.spans.map((span) => {
            if (!isNonArrayObject(span)) throw new TypeError('paragraph span must be an object');
            return {
              ...copyStyle(span, 'paragraph span'),
              start: span.start,
              end: span.end,
              ...(span.font === undefined ? {} : { font: span.font }),
            };
          }),
        }),
  };
}

function copyStyle(style: ParagraphStyle, name: string): ParagraphStyle {
  if (!isNonArrayObject(style)) throw new TypeError(`${name} must be an object`);
  if (style.features !== undefined && !Array.isArray(style.features)) {
    throw new TypeError(`${name} features must be an array`);
  }
  if (
    style.direction !== undefined &&
    style.direction !== 'auto' &&
    style.direction !== 'ltr' &&
    style.direction !== 'rtl'
  ) {
    throw new RangeError(`${name} direction must be auto, ltr, or rtl`);
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
            if (!isNonArrayObject(feature)) throw new TypeError(`${name} feature must be an object`);
            return { ...feature };
          }),
        }),
  };
}

/**
 * Shaping resolution consumes the one span cascade before run segmentation, so
 * a span's font, size, language, direction, or features re-segment shaping and
 * change advances rather than only scaling already-shaped glyphs.
 */
function resolveStyles(
  shaper: RuntimeShaper,
  input: ParagraphInput,
  graphemeBoundaries: Uint32Array,
): readonly StyleSegment[] {
  const legalBoundaries = new Set(graphemeBoundaries);
  const entries: SpanCascadeEntry<StatedSpanStyle>[] = [];
  for (const span of input.spans ?? []) {
    assertTextRange(span.start, span.end, input.text.length, 'paragraph span');
    if (!legalBoundaries.has(span.start) || !legalBoundaries.has(span.end)) {
      throw new RangeError('paragraph span boundaries must be extended-grapheme boundaries');
    }
    entries.push({ start: span.start, end: span.end, properties: resolveSpanStyle(shaper, span) });
  }
  const root = resolveStyle(shaper, input.font, input.style ?? {}, 0, input.text.length);
  if (input.text.length === 0) return [{ start: 0, end: 0, style: root }];
  const segments: StyleSegment[] = [];
  for (const segment of resolveSpanCascade(entries, input.text.length, 'paragraph span')) {
    const style = styleOver(root, segment.properties);
    const previous = segments.at(-1);
    if (previous !== undefined && previous.end === segment.start && equalStyles(previous.style, style)) {
      segments[segments.length - 1] = { ...previous, end: segment.end };
    } else {
      segments.push({ start: segment.start, end: segment.end, style });
    }
  }
  return segments;
}

function resolveSpanStyle(shaper: RuntimeShaper, span: ParagraphSpan): StatedSpanStyle {
  if (span.font !== undefined) shaper.registerFont(requireFont(shaper, span.font));
  const lineHeight = span.lineHeight === undefined ? undefined : finitePositive(span.lineHeight, 'lineHeight');
  const direction = span.direction;
  const language = span.language === undefined ? undefined : normalizeLanguage(span.language);
  return {
    ...(span.font === undefined ? {} : { font: span.font }),
    ...(span.fontSize === undefined ? {} : { fontSize: finitePositive(span.fontSize, 'fontSize') }),
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(span.letterSpacing === undefined ? {} : { letterSpacing: finite(span.letterSpacing, 'letterSpacing') }),
    ...(language === undefined ? {} : { language }),
    ...(direction === undefined ? {} : { direction }),
    ...(span.features === undefined ? {} : { features: resolveFeatures(span.features, span.start, span.end) }),
  };
}

/** The paragraph is the outermost scope, so an unstated property inherits from it. */
function styleOver(root: ResolvedStyle, stated: StatedSpanStyle): ResolvedStyle {
  const lineHeight = stated.lineHeight ?? root.lineHeight;
  const language = stated.language ?? root.language;
  const direction = stated.direction ?? root.direction;
  return {
    font: stated.font ?? root.font,
    fontSize: stated.fontSize ?? root.fontSize,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    letterSpacing: stated.letterSpacing ?? root.letterSpacing,
    ...(language === undefined ? {} : { language }),
    direction,
    ...(stated.direction === undefined || direction === 'auto' ? {} : { bidiOverride: direction }),
    features: stated.features ?? root.features,
  };
}

function resolveStyle(
  shaper: RuntimeShaper,
  fontHandle: FontHandle,
  style: ParagraphStyle,
  start: number,
  end: number,
): ResolvedStyle {
  const font = requireFont(shaper, fontHandle);
  shaper.registerFont(font);
  const fontSize = finitePositive(style.fontSize ?? DEFAULT_FONT_SIZE, 'fontSize');
  const lineHeight = style.lineHeight === undefined ? undefined : finitePositive(style.lineHeight, 'lineHeight');
  const letterSpacing = finite(style.letterSpacing ?? 0, 'letterSpacing');
  const language = normalizeLanguage(style.language);
  const direction = style.direction ?? 'auto';
  return {
    font: fontHandle,
    fontSize,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    letterSpacing,
    ...(language === undefined ? {} : { language }),
    direction,
    features: resolveFeatures(style.features ?? [], start, end),
  };
}

function resolveFeatures(
  features: readonly FontFeature[],
  containingStart: number,
  containingEnd: number,
): readonly ResolvedFontFeature[] {
  return features.flatMap((feature) => {
    const start = feature.start ?? containingStart;
    const end = feature.end ?? containingEnd;
    // A feature that states no range covers whatever it is applied to, so an empty containing range makes it
    // vacuous rather than invalid. Rejecting it would fail an ordinary feature-styled field before its first
    // character is typed. An explicitly empty range is still a caller error.
    if (feature.start === undefined && feature.end === undefined && start === end) return [];
    assertTextRange(start, end, containingEnd, `feature ${feature.tag}`);
    if (start < containingStart) throw new RangeError(`feature ${feature.tag} starts before its style range`);
    const value = feature.value ?? 1;
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new RangeError(`feature ${feature.tag} value must be a uint32`);
    }
    return [{ tag: feature.tag, value, start, end }];
  });
}

function prepareRuns(
  text: string,
  styles: readonly StyleSegment[],
  unicode: UnicodeTextAnalysis,
  bidi: OwnedBidiAnalysis,
): readonly PreparedRun[] {
  const runs: PreparedRun[] = [];
  const bidiItems = bidiRuns(bidi.levels);
  let styleIndex = 0;
  let scriptIndex = 0;
  let bidiIndex = 0;
  while (styleIndex < styles.length && scriptIndex < unicode.scriptItems.length && bidiIndex < bidiItems.length) {
    const style = styles[styleIndex];
    const script = unicode.scriptItems[scriptIndex];
    const bidiRun = bidiItems[bidiIndex];
    if (style === undefined || script === undefined || bidiRun === undefined) break;
    const start = Math.max(style.start, script.start, bidiRun.start);
    const end = Math.min(style.end, script.end, bidiRun.end);
    if (start < end) {
      const direction = style.style.bidiOverride ?? directionForLevel(bidiRun.level);
      const bidiLevel =
        style.style.bidiOverride === undefined ? bidiRun.level : forceLevelDirection(bidiRun.level, direction);
      for (const fragment of drawableFragments(text, start, end)) {
        appendPreparedRun(runs, {
          ...fragment,
          style: style.style,
          script: script.script,
          direction,
          bidiLevel,
        });
      }
    }
    const boundary = Math.min(style.end, script.end, bidiRun.end);
    if (style.end === boundary) styleIndex += 1;
    if (script.end === boundary) scriptIndex += 1;
    if (bidiRun.end === boundary) bidiIndex += 1;
  }
  if (runs.length === 0) {
    const fallback = styles[0];
    if (fallback !== undefined) {
      const level = bidi.levels[0] ?? bidi.paragraphLevels[0] ?? 0;
      runs.push({
        start: fallback.start,
        end: fallback.start,
        style: fallback.style,
        script: 'Zyyy',
        direction: fallback.style.bidiOverride ?? directionForLevel(level),
        bidiLevel: level,
      });
    }
  }
  return runs;
}

function appendPreparedRun(runs: PreparedRun[], run: PreparedRun): void {
  const previous = runs.at(-1);
  if (
    previous !== undefined &&
    previous.end === run.start &&
    previous.script === run.script &&
    previous.direction === run.direction &&
    previous.bidiLevel === run.bidiLevel &&
    equalStyles(previous.style, run.style)
  ) {
    runs[runs.length - 1] = { ...previous, end: run.end };
  } else {
    runs.push(run);
  }
}

function bidiRuns(levels: Uint8Array): readonly {
  readonly start: number;
  readonly end: number;
  readonly level: number;
}[] {
  const runs = [];
  let start = 0;
  while (start < levels.length) {
    const level = levels[start];
    if (level === undefined) break;
    let end = start + 1;
    while (end < levels.length && levels[end] === level) end += 1;
    runs.push({ start, end, level });
    start = end;
  }
  return runs;
}

function directionForLevel(level: number): 'ltr' | 'rtl' {
  return (level & 1) === 0 ? 'ltr' : 'rtl';
}

function forceLevelDirection(level: number, direction: 'ltr' | 'rtl'): number {
  return directionForLevel(level) === direction ? level : level + 1;
}

function shapeRequest(
  text: string,
  runs: readonly PreparedRun[],
): {
  readonly request: ShapeBatchRequest;
  readonly ellipses: readonly Omit<PreparedEllipsis, 'advance'>[];
} {
  const features: ResolvedFontFeature[] = [];
  const shapeRuns = runs.map((run) => {
    const selected = run.style.features.filter((feature) => feature.start < run.end && feature.end > run.start);
    const featureStart = features.length;
    features.push(...selected);
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
    };
  });
  const ellipses = runs.map((run, sourceRun) => {
    const textStart = text.length + sourceRun;
    const shapeRun = shapeRuns.length;
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
    });
    return { sourceRun, shapeRun, textStart, textEnd: textStart + 1 };
  });
  return {
    request: { textUtf16: utf16(`${text}${'…'.repeat(runs.length)}`), runs: shapeRuns, features },
    ellipses,
  };
}

function measureEllipses(
  shaper: RuntimeShaper,
  runs: readonly PreparedRun[],
  shape: OwnedShape,
  ellipses: readonly Omit<PreparedEllipsis, 'advance'>[],
): readonly PreparedEllipsis[] {
  return ellipses.map((ellipsis) => {
    const run = runs[ellipsis.sourceRun];
    const glyphStart = shape.runGlyphStarts[ellipsis.shapeRun];
    const glyphCount = shape.runGlyphCounts[ellipsis.shapeRun];
    if (run === undefined || glyphStart === undefined || glyphCount === undefined) {
      throw new Error('shaper returned an incomplete ellipsis run');
    }
    const font = requireFont(shaper, run.style.font);
    const scale = run.style.fontSize / font.metrics.unitsPerEm;
    let advance = 0;
    for (let glyph = glyphStart; glyph < glyphStart + glyphCount; glyph += 1) {
      advance += Math.abs(shape.xAdvances[glyph] ?? 0) * scale;
    }
    return { ...ellipsis, advance };
  });
}

function measureClusters(
  shaper: RuntimeShaper,
  text: string,
  unicode: UnicodeTextAnalysis,
  styles: readonly StyleSegment[],
  runs: readonly PreparedRun[],
  shape: OwnedShape,
  previous?: PreparedParagraph,
): MeasuredClusters {
  // Shaping results are gathered by text offset rather than into a map and two sets keyed by offset. Every glyph of the
  // paragraph touched all three, so the hash entries were themselves a per-glyph allocation. Advances still accumulate
  // in the shaped order and in double precision, so the totals are unchanged.
  const offsets = text.length + 1;
  const offsetAdvances = new Float64Array(offsets);
  const offsetFlags = new Uint8Array(offsets);
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    const glyphStart = shape.runGlyphStarts[runIndex];
    const glyphCount = shape.runGlyphCounts[runIndex];
    if (run === undefined || glyphStart === undefined || glyphCount === undefined) {
      throw new Error('shaper returned an incomplete run table');
    }
    const font = requireFont(shaper, run.style.font);
    const scale = run.style.fontSize / font.metrics.unitsPerEm;
    offsetFlags[run.start] = (offsetFlags[run.start] ?? 0) | OFFSET_SHAPED_BOUNDARY;
    offsetFlags[run.end] = (offsetFlags[run.end] ?? 0) | OFFSET_SHAPED_BOUNDARY;
    for (let glyph = glyphStart; glyph < glyphStart + glyphCount; glyph += 1) {
      const cluster = shape.clusters[glyph];
      const advance = shape.xAdvances[glyph];
      const flags = shape.glyphFlags[glyph];
      if (cluster === undefined || advance === undefined || flags === undefined) {
        throw new Error('shaper returned an incomplete glyph table');
      }
      offsetAdvances[cluster] = (offsetAdvances[cluster] ?? 0) + Math.abs(advance) * scale;
      offsetFlags[cluster] =
        (offsetFlags[cluster] ?? 0) |
        OFFSET_SHAPED_BOUNDARY |
        ((flags & GLYPH_UNSAFE_TO_BREAK) !== 0 ? OFFSET_UNSAFE_TO_BREAK : 0);
    }
  }
  const requiredBreaks = new Uint8Array(offsets);
  for (const entry of unicode.lineBreaks) requiredBreaks[entry.position] = entry.required ? 1 : 0;

  const count = Math.max(0, unicode.graphemeBoundaries.length - 1);
  const retained = previous?.clusters;
  const starts = reuseTypedArray(retained?.starts, count, (capacity) => new Uint32Array(capacity).subarray(0, count));
  const ends = reuseTypedArray(retained?.ends, count, (capacity) => new Uint32Array(capacity).subarray(0, count));
  const clusterAdvances = reuseTypedArray(retained?.advances, count, (capacity) =>
    new Float64Array(capacity).subarray(0, count),
  );
  const flags = reuseTypedArray(retained?.flags, count, (capacity) => new Uint8Array(capacity).subarray(0, count));
  const styleIndexes = reuseTypedArray(retained?.styleIndexes, count, (capacity) =>
    new Uint32Array(capacity).subarray(0, count),
  );
  let styleIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const start = unicode.graphemeBoundaries[index] ?? 0;
    const end = unicode.graphemeBoundaries[index + 1] ?? 0;
    while ((styles[styleIndex]?.end ?? Number.POSITIVE_INFINITY) <= start) styleIndex += 1;
    const styleSegment = styles[styleIndex];
    if (styleSegment === undefined || styleSegment.start > start) {
      throw new Error(`paragraph offset ${start} has no resolved style`);
    }
    const hardBreak = isHardBreak(text, start);
    const boundary = offsetFlags[start] ?? 0;
    starts[index] = start;
    ends[index] = end;
    clusterAdvances[index] = (offsetAdvances[start] ?? 0) + (hardBreak ? 0 : styleSegment.style.letterSpacing);
    styleIndexes[index] = styleIndex;
    flags[index] =
      ((boundary & (OFFSET_SHAPED_BOUNDARY | OFFSET_UNSAFE_TO_BREAK)) === OFFSET_SHAPED_BOUNDARY
        ? CLUSTER_SAFE_BEFORE
        : 0) |
      (requiredBreaks[end] === 1 ? CLUSTER_REQUIRED_BREAK : 0) |
      (hardBreak ? CLUSTER_HARD_BREAK : 0);
  }
  return { count, starts, ends, advances: clusterAdvances, flags, styleIndexes };
}

/** The style a cluster resolved to during measurement. */
function clusterStyle(prepared: PreparedParagraph, index: number): ResolvedStyle {
  const style = prepared.styles[prepared.clusters.styleIndexes[index] ?? 0]?.style;
  if (style === undefined) throw new Error(`cluster ${index} has no resolved style`);
  return style;
}

/** Smallest retained index capacity. Ordinary paragraphs never pay a growth step on their first frames. */
const MINIMUM_CLUSTER_INDEX_CAPACITY = 512;

/**
 * Reuses a retained buffer's memory when it already holds `length` elements, and otherwise grows to a high watermark
 * that later preparations reuse. The returned view carries the live length, so binary searches over it stay correct
 * while the backing allocation outlives any single preparation.
 */
function reuseTypedArray<Array extends Uint8Array | Uint32Array | Float64Array>(
  previous: Array | undefined,
  length: number,
  construct: (capacity: number) => Array,
): Array {
  const capacity = previous === undefined ? 0 : previous.buffer.byteLength / previous.BYTES_PER_ELEMENT;
  if (previous !== undefined && capacity >= length) {
    const view = new (previous.constructor as new (buffer: ArrayBufferLike, offset: number, length: number) => Array)(
      previous.buffer,
      0,
      length,
    );
    view.fill(0);
    return view;
  }
  return construct(Math.max(length, MINIMUM_CLUSTER_INDEX_CAPACITY, capacity * 2));
}

function indexClusters(
  text: string,
  styles: readonly StyleSegment[],
  clusters: MeasuredClusters,
  previous?: PreparedParagraph,
): Pick<PreparedParagraph, 'clusterIndexAt' | 'letterSpacingPrefix' | 'spacePrefix'> {
  const { count, starts, flags, styleIndexes } = clusters;
  const letterSpacingPrefix = reuseTypedArray(previous?.letterSpacingPrefix, count + 1, (capacity) =>
    new Float64Array(capacity).subarray(0, count + 1),
  );
  const spacePrefix = reuseTypedArray(previous?.spacePrefix, count + 1, (capacity) =>
    new Uint32Array(capacity).subarray(0, count + 1),
  );
  const clusterIndexAt = reuseTypedArray(previous?.clusterIndexAt, text.length + 1, (capacity) =>
    new Uint32Array(capacity).subarray(0, text.length + 1),
  );
  for (let index = 0; index < count; index += 1) {
    const start = starts[index] ?? 0;
    const letterSpacing =
      ((flags[index] ?? 0) & CLUSTER_HARD_BREAK) !== 0
        ? 0
        : (styles[styleIndexes[index] ?? 0]?.style.letterSpacing ?? 0);
    letterSpacingPrefix[index + 1] = (letterSpacingPrefix[index] ?? 0) + letterSpacing;
    spacePrefix[index + 1] = (spacePrefix[index] ?? 0) + (text.charCodeAt(start) === 0x20 ? 1 : 0);
  }
  // The same answer a lower-bound search over the cluster starts gives, resolved once for every offset in one pass.
  let cluster = 0;
  for (let offset = 0; offset <= text.length; offset += 1) {
    while (cluster < count && (starts[cluster] ?? 0) < offset) cluster += 1;
    clusterIndexAt[offset] = cluster;
  }
  return { clusterIndexAt, letterSpacingPrefix, spacePrefix };
}

function planLines(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
): readonly LinePlan[] {
  const widthLimit = constraints.width.mode === 'unconstrained' ? Number.POSITIVE_INFINITY : constraints.width.size;
  const { count, starts, ends, flags } = prepared.clusters;
  const allowed = new Set<number>();
  if (constraints.wrap === 'character') {
    for (let index = 0; index < count; index += 1) {
      const nextIsSafe = index + 1 === count || ((flags[index + 1] ?? 0) & CLUSTER_SAFE_BEFORE) !== 0;
      if (nextIsSafe) allowed.add(ends[index] ?? 0);
    }
  } else if (constraints.wrap === 'word') {
    const shapingBoundaries = new Set<number>();
    for (let index = 0; index < count; index += 1) {
      if (((flags[index] ?? 0) & CLUSTER_SAFE_BEFORE) !== 0) shapingBoundaries.add(starts[index] ?? 0);
    }
    shapingBoundaries.add(prepared.input.text.length);
    for (const entry of prepared.unicode.lineBreaks) {
      if (shapingBoundaries.has(entry.position)) allowed.add(entry.position);
    }
  }

  return breakLines(shaper, prepared, allowed, widthLimit, constraints.wrap);
}

function measurePrepared(
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
  allLines: readonly LinePlan[],
): MeasuredPlan {
  const lines = visibleLines(prepared, constraints, allLines);
  const naturalContentWidth = allLines.reduce((maximum, line) => Math.max(maximum, line.advance), 0);
  const contentHeight = allLines.reduce((sum, line) => sum + line.height, 0);
  const displayAdvances = lines.map((line, index) => measuredLineAdvance(prepared, constraints, lines, line, index));
  const visibleWidth = displayAdvances.reduce((maximum, advance) => Math.max(maximum, advance), 0);
  const contentWidth = Math.max(naturalContentWidth, visibleWidth);
  const visibleHeight = lines.reduce((sum, line) => sum + line.height, 0);
  const width = resolveAxis(constraints.width, visibleWidth);
  const height = resolveAxis(constraints.height, visibleHeight);
  let blockOffset = 0;
  const baselines = lines.map((line) => {
    const baseline = blockOffset + line.baseline;
    blockOffset += line.height;
    return baseline;
  });
  const measurement = Object.freeze({
    width,
    height,
    contentWidth,
    contentHeight,
    firstBaseline: baselines[0] ?? 0,
    lastBaseline: baselines.at(-1) ?? 0,
    overflowed: lines.length < allLines.length || contentWidth > width || contentHeight > height,
  });
  return { measurement, lines };
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
    return line.advance;
  }
  return Math.max(line.advance, constraints.width.size);
}

function visibleLines(
  prepared: PreparedParagraph,
  constraints: NormalizedConstraints,
  allLines: readonly LinePlan[],
): readonly LinePlan[] {
  let count = constraints.maxLines === undefined ? allLines.length : Math.min(allLines.length, constraints.maxLines);
  if (constraints.overflow === 'ellipsis' && constraints.height.mode !== 'unconstrained') {
    let height = 0;
    let fitting = 0;
    for (const line of allLines) {
      if (height + line.height > constraints.height.size) break;
      height += line.height;
      fitting += 1;
    }
    count = Math.min(count, fitting);
  }
  const lines = allLines.slice(0, count);
  if (constraints.overflow !== 'ellipsis' || lines.length === 0) return lines;
  const last = lines.at(-1);
  if (last === undefined) return lines;
  const widthLimit = constraints.width.mode === 'unconstrained' ? Number.POSITIVE_INFINITY : constraints.width.size;
  const truncated = count < allLines.length;
  if (!truncated && last.advance <= widthLimit) return lines;
  return [...lines.slice(0, -1), ellipsizeLine(prepared, last, widthLimit)];
}

function ellipsizeLine(prepared: PreparedParagraph, line: LinePlan, widthLimit: number): LinePlan {
  const { count, starts, advances, flags } = prepared.clusters;
  const startAt = (index: number): number => (index < count ? (starts[index] ?? 0) : line.textStart);
  let clusterEnd = line.clusterEnd;
  let advance = line.advance;
  while (clusterEnd > line.clusterStart && ((flags[clusterEnd - 1] ?? 0) & CLUSTER_HARD_BREAK) !== 0) {
    clusterEnd -= 1;
  }
  let selected = ellipsisAt(prepared, line.textEnd);
  while (clusterEnd > line.clusterStart && Number.isFinite(widthLimit) && advance + selected.advance > widthLimit) {
    clusterEnd -= 1;
    if (clusterEnd < count) advance -= advances[clusterEnd] ?? 0;
    selected = ellipsisAt(prepared, startAt(clusterEnd));
  }
  const textEnd = startAt(clusterEnd);
  const levelOffset = Math.max(line.textStart, textEnd - 1);
  const level = prepared.bidi.levels[levelOffset] ?? paragraphLevelAt(prepared.bidi, textEnd);
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
  };
}

function ellipsisAt(prepared: PreparedParagraph, offset: number): PreparedEllipsis {
  const sourceRun = prepared.runs.findIndex((run) => run.start < offset && offset <= run.end);
  const fallbackRun = prepared.runs.findIndex((run) => run.start <= offset && offset < run.end);
  const run = sourceRun >= 0 ? sourceRun : fallbackRun;
  const ellipsis = prepared.ellipses.find((entry) => entry.sourceRun === run) ?? prepared.ellipses[0];
  if (ellipsis === undefined) throw new Error('paragraph has no ellipsis shaping run');
  return ellipsis;
}

function breakLines(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  allowed: ReadonlySet<number>,
  widthLimit: number,
  wrap: 'none' | 'word' | 'character',
): readonly LinePlan[] {
  const { count, starts, ends, advances: clusterAdvances, flags } = prepared.clusters;
  if (count === 0) return [];
  const lines: LinePlan[] = [];
  let lineStart = 0;
  while (lineStart < count) {
    let advance = 0;
    let lastAllowed = -1;
    let lastAllowedAdvance = 0;
    let lastSafe = -1;
    let lastSafeAdvance = 0;
    let lineEnd = count;
    let lineAdvance = 0;
    for (let index = lineStart; index < count; index += 1) {
      const clusterFlags = flags[index] ?? 0;
      if (index > lineStart && (clusterFlags & CLUSTER_SAFE_BEFORE) !== 0) {
        lastSafe = index;
        lastSafeAdvance = advance;
      }
      const requiredBreak = (clusterFlags & CLUSTER_REQUIRED_BREAK) !== 0;
      const nextAdvance = advance + (clusterAdvances[index] ?? 0);
      if (wrap !== 'none' && Number.isFinite(widthLimit) && nextAdvance > widthLimit && index > lineStart) {
        if (lastAllowed > lineStart) {
          lineEnd = lastAllowed;
          lineAdvance = lastAllowedAdvance;
        } else if (lastSafe > lineStart) {
          lineEnd = lastSafe;
          lineAdvance = lastSafeAdvance;
        } else {
          advance = nextAdvance;
          if (requiredBreak || index === count - 1) {
            lineEnd = index + 1;
            lineAdvance = advance;
            break;
          }
          continue;
        }
        break;
      }
      advance = nextAdvance;
      if (requiredBreak) {
        lineEnd = index + 1;
        lineAdvance = advance;
        break;
      }
      if (allowed.has(ends[index] ?? 0)) {
        lastAllowed = index + 1;
        lastAllowedAdvance = advance;
      }
      if (index === count - 1) lineAdvance = advance;
    }
    if (lineEnd <= lineStart) {
      lineEnd = lineStart + 1;
      lineAdvance = clusterAdvances[lineStart] ?? 0;
    }
    const lastHardBreak = ((flags[lineEnd - 1] ?? 0) & CLUSTER_HARD_BREAK) !== 0;
    const metrics = metricsForLine(shaper, prepared, lineStart, lineEnd, prepared.styles[0]?.style);
    lines.push({
      clusterStart: lineStart,
      clusterEnd: lineEnd,
      textStart: starts[lineStart] ?? 0,
      textEnd: (lastHardBreak ? starts[lineEnd - 1] : ends[lineEnd - 1]) ?? 0,
      advance: lineAdvance,
      hardBreak: lastHardBreak,
      ...metrics,
    });
    lineStart = lineEnd;
  }
  if (((flags[count - 1] ?? 0) & CLUSTER_HARD_BREAK) !== 0) {
    const metrics = metricsForLine(shaper, prepared, count, count, prepared.styles[0]?.style);
    lines.push({
      clusterStart: count,
      clusterEnd: count,
      textStart: prepared.input.text.length,
      textEnd: prepared.input.text.length,
      advance: 0,
      hardBreak: false,
      ...metrics,
    });
  }
  return lines;
}

/**
 * Line box metrics over the drawable clusters of `[lineStart, lineEnd)`. Both extents are maxima over the contributing
 * styles, so the clusters are visited in place: the order is irrelevant and a repeated style contributes nothing new,
 * which lets the common single-style line resolve its font and scale once.
 */
function metricsForLine(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  lineStart: number,
  lineEnd: number,
  fallback?: ResolvedStyle,
): LineMetrics {
  const { flags, styleIndexes } = prepared.clusters;
  let above = 0;
  let below = 0;
  let contributed = false;
  let lastStyleIndex = -1;
  for (let index = lineStart; index < lineEnd; index += 1) {
    if (((flags[index] ?? 0) & CLUSTER_HARD_BREAK) !== 0) continue;
    const styleIndex = styleIndexes[index] ?? 0;
    if (contributed && styleIndex === lastStyleIndex) continue;
    lastStyleIndex = styleIndex;
    contributed = true;
    const extents = styleLineExtents(shaper, clusterStyle(prepared, index));
    above = Math.max(above, extents.above);
    below = Math.max(below, extents.below);
  }
  if (!contributed && fallback !== undefined) {
    const extents = styleLineExtents(shaper, fallback);
    above = Math.max(above, extents.above);
    below = Math.max(below, extents.below);
  }
  return { height: above + below, baseline: above };
}

function styleLineExtents(
  shaper: RuntimeShaper,
  style: ResolvedStyle,
): { readonly above: number; readonly below: number } {
  const font = requireFont(shaper, style.font);
  const scale = style.fontSize / font.metrics.unitsPerEm;
  const ascent = font.metrics.ascender * scale;
  const descent = -font.metrics.descender * scale;
  const natural = (font.metrics.ascender - font.metrics.descender + font.metrics.lineGap) * scale;
  const height = style.lineHeight === undefined ? natural : style.fontSize * style.lineHeight;
  const leading = Math.max(0, height - ascent - descent);
  return { above: ascent + leading / 2, below: descent + leading / 2 };
}

function normalizeConstraints(constraints: ParagraphConstraints = {}): NormalizedConstraints {
  if (!isNonArrayObject(constraints)) throw new TypeError('paragraph constraints must be an object');
  const width = normalizeAxis(constraints.width, 'width');
  const height = normalizeAxis(constraints.height, 'height');
  const maxLines = constraints.maxLines;
  if (maxLines !== undefined && (!Number.isSafeInteger(maxLines) || maxLines <= 0)) {
    throw new RangeError('maxLines must be a positive safe integer');
  }
  const wrap = constraints.wrap ?? 'word';
  if (wrap !== 'none' && wrap !== 'word' && wrap !== 'character') {
    throw new RangeError('wrap must be none, word, or character');
  }
  const align = constraints.align ?? 'start';
  if (align !== 'start' && align !== 'center' && align !== 'end' && align !== 'justify') {
    throw new RangeError('align must be start, center, end, or justify');
  }
  const overflow = constraints.overflow ?? 'visible';
  if (overflow !== 'visible' && overflow !== 'clip' && overflow !== 'ellipsis') {
    throw new RangeError('overflow must be visible, clip, or ellipsis');
  }
  return {
    width,
    height,
    ...(maxLines === undefined ? {} : { maxLines }),
    wrap,
    align,
    overflow,
  };
}

function normalizeAxis(constraint: ParagraphAxisConstraint | undefined, name: string): ParagraphAxisConstraint {
  if (constraint === undefined) return { mode: 'unconstrained' };
  if (!isNonArrayObject(constraint)) throw new TypeError(`${name} constraint must be an object`);
  if (constraint.mode === 'unconstrained') return { mode: 'unconstrained' };
  if (constraint.mode !== 'at-most' && constraint.mode !== 'exactly') {
    throw new RangeError(`${name} mode must be unconstrained, at-most, or exactly`);
  }
  return { mode: constraint.mode, size: finiteNonnegative(constraint.size, `${name} size`) };
}

function constraintKey(constraints: NormalizedConstraints): string {
  return JSON.stringify(constraints);
}

function linePlanConstraintKey(constraints: NormalizedConstraints): string {
  return JSON.stringify({
    width: constraints.width,
    wrap: constraints.wrap,
  });
}

function geometryLinesKey(positioningKey: string, align: NormalizedConstraints['align'], boxWidth: number): string {
  return JSON.stringify({
    positioningKey,
    align,
    boxWidth,
  });
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
  );
}

function positionPrepared(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  lines: readonly LinePlan[],
  positioning: PreparedPositioning,
  constraints: NormalizedConstraints,
  boxWidth: number,
): PositionedGeometry {
  if (lines.length === 0) return emptyGeometry();
  const { fragments, reshaped } = positioning;
  const reshapeRunByFragment = new Map<number, number>();
  let reshapeRun = 0;
  for (const [fragmentIndex, fragment] of fragments.entries()) {
    if (!fragment.reshape) continue;
    reshapeRunByFragment.set(fragmentIndex, reshapeRun);
    reshapeRun += 1;
  }

  const fontHandles: number[] = [];
  const fontSlots = new Map<FontHandle, number>();
  // Every output glyph comes from one source glyph, so the shaped runs bound the output. The arrays are written in
  // place and sliced to the final count, which removes both the per-glyph push and the copy that `TypedArray.from`
  // made out of every accumulator.
  let capacity = prepared.shape.glyphIds.length + (reshaped?.glyphIds.length ?? 0);
  let glyphFontSlots = new Uint16Array(capacity);
  let glyphIds = new Uint16Array(capacity);
  let clusters = new Uint32Array(capacity);
  let glyphFontSizes = new Float32Array(capacity);
  // Both axes accumulate in double precision and narrow once, when the geometry is handed out. Alignment and
  // justification already read `x` back and add to it, and single precision would round at the store and again at the
  // adjustment and drift from the golden layout. The same becomes true of `y` the moment vertical alignment or a
  // vertical writing mode lands, so the rule is the axis, not today's caller.
  let x = new Float64Array(capacity);
  let y = new Float64Array(capacity);
  let glyphFlags = new Uint16Array(capacity);
  const justifying = constraints.align === 'justify';
  let justificationCounts = justifying ? new Uint32Array(capacity) : undefined;
  const lineTextStarts = new Uint32Array(lines.length);
  const lineTextEnds = new Uint32Array(lines.length);
  const lineGlyphStarts = new Uint32Array(lines.length);
  const lineGlyphCounts = new Uint32Array(lines.length);
  const lineBaselines = new Float32Array(lines.length);
  const lineAdvances = new Float32Array(lines.length);
  let count = 0;
  let blockOffset = 0;
  let fragmentIndex = 0;

  const reserve = (needed: number): void => {
    if (needed <= capacity) return;
    let next = Math.max(capacity * 2, 64);
    while (next < needed) next *= 2;
    capacity = next;
    glyphFontSlots = grownTypedArray(glyphFontSlots, next);
    glyphIds = grownTypedArray(glyphIds, next);
    clusters = grownTypedArray(clusters, next);
    glyphFontSizes = grownTypedArray(glyphFontSizes, next);
    x = grownTypedArray(x, next);
    y = grownTypedArray(y, next);
    glyphFlags = grownTypedArray(glyphFlags, next);
    if (justificationCounts !== undefined) justificationCounts = grownTypedArray(justificationCounts, next);
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const lineGlyphStart = count;
    let passedSpaces = 0;
    let cursor = 0;
    const baseline = blockOffset + line.baseline;
    while (fragments[fragmentIndex]?.line === lineIndex) {
      const fragment = fragments[fragmentIndex];
      if (fragment === undefined) break;
      const run = prepared.runs[fragment.run];
      if (run === undefined) throw new Error('line fragment references a missing shaping run');
      const reshapedRun = reshapeRunByFragment.get(fragmentIndex);
      const source = reshapedRun === undefined ? prepared.shape : reshaped;
      const sourceRun = fragment.ellipsis?.shapeRun ?? reshapedRun ?? fragment.run;
      if (source === undefined) throw new Error('boundary reshape result is missing');
      const glyphStart = source.runGlyphStarts[sourceRun];
      const glyphCount = source.runGlyphCounts[sourceRun];
      if (glyphStart === undefined || glyphCount === undefined) {
        throw new Error('shaper returned an incomplete positioned run');
      }
      let slot = fontSlots.get(run.style.font);
      if (slot === undefined) {
        slot = fontHandles.length;
        fontHandles.push(run.style.font);
        fontSlots.set(run.style.font, slot);
      }
      const font = requireFont(shaper, run.style.font);
      const scale = run.style.fontSize / font.metrics.unitsPerEm;
      const selectedStart = fragment.ellipsis?.textStart ?? fragment.start;
      const selectedEnd = fragment.ellipsis?.textEnd ?? fragment.end;
      const selected = glyphRange(source, glyphStart, glyphCount, selectedStart, selectedEnd);
      reserve(count + (selected.end - selected.start));
      let clusterBoundary = run.direction === 'ltr' ? fragment.start : fragment.end;
      for (let glyph = selected.start; glyph < selected.end; glyph += 1) {
        const cluster = source.clusters[glyph];
        const glyphId = source.glyphIds[glyph];
        const xAdvance = source.xAdvances[glyph];
        const xOffset = source.xOffsets[glyph];
        const yOffset = source.yOffsets[glyph];
        const flags = source.glyphFlags[glyph];
        if (
          cluster === undefined ||
          glyphId === undefined ||
          xAdvance === undefined ||
          xOffset === undefined ||
          yOffset === undefined ||
          flags === undefined
        ) {
          throw new Error('shaper returned an incomplete positioned glyph');
        }
        glyphFontSlots[count] = slot;
        glyphIds[count] = glyphId;
        clusters[count] = fragment.ellipsis?.cluster ?? cluster;
        glyphFontSizes[count] = run.style.fontSize;
        if (justificationCounts !== undefined) justificationCounts[count] = passedSpaces;
        x[count] = cursor + xOffset * scale;
        y[count] = baseline - yOffset * scale;
        glyphFlags[count] = flags;
        count += 1;
        cursor += Math.abs(xAdvance) * scale;
        const nextCluster = glyph + 1 < selected.end ? source.clusters[glyph + 1] : selectedEnd;
        if (nextCluster !== cluster && fragment.ellipsis === undefined) {
          const rangeStart = run.direction === 'ltr' ? cluster : Math.min(cluster, clusterBoundary);
          const rangeEnd = run.direction === 'ltr' ? (nextCluster ?? fragment.end) : Math.max(cluster, clusterBoundary);
          cursor += spacingBetween(prepared, rangeStart, rangeEnd);
          passedSpaces += justificationSpaces(prepared, line, rangeStart, rangeEnd);
          clusterBoundary = cluster;
        }
      }
      fragmentIndex += 1;
    }
    const available = Math.max(0, boxWidth - cursor);
    if (justifying && !line.hardBreak && lineIndex < lines.length - 1 && passedSpaces > 0) {
      const perSpace = available / passedSpaces;
      for (let glyph = lineGlyphStart; glyph < count; glyph += 1) {
        x[glyph] = (x[glyph] ?? 0) + (justificationCounts?.[glyph] ?? 0) * perSpace;
      }
      cursor += available;
    } else {
      const paragraphDirection = directionForLevel(paragraphLevelAt(prepared.bidi, line.textStart));
      const offset = alignmentOffset(constraints.align, paragraphDirection, available);
      if (offset !== 0) {
        for (let glyph = lineGlyphStart; glyph < count; glyph += 1) {
          x[glyph] = (x[glyph] ?? 0) + offset;
        }
      }
    }
    lineTextStarts[lineIndex] = line.textStart;
    lineTextEnds[lineIndex] = line.textEnd;
    lineGlyphStarts[lineIndex] = lineGlyphStart;
    lineGlyphCounts[lineIndex] = count - lineGlyphStart;
    lineBaselines[lineIndex] = baseline;
    lineAdvances[lineIndex] = cursor;
    blockOffset += line.height;
  }

  return {
    fontHandles: Uint32Array.from(fontHandles),
    glyphFontSlots: glyphFontSlots.subarray(0, count),
    glyphIds: glyphIds.subarray(0, count),
    clusters: clusters.subarray(0, count),
    glyphFontSizes: glyphFontSizes.subarray(0, count),
    x: new Float32Array(x.subarray(0, count)),
    y: new Float32Array(y.subarray(0, count)),
    glyphFlags: glyphFlags.subarray(0, count),
    lineTextStarts,
    lineTextEnds,
    lineGlyphStarts,
    lineGlyphCounts,
    lineBaselines,
    lineAdvances,
  };
}

function grownTypedArray<T extends Uint16Array | Uint32Array | Float32Array | Float64Array>(
  array: T,
  capacity: number,
): T {
  const next = new (array.constructor as new (length: number) => T)(capacity);
  next.set(array as unknown as ArrayLike<number> & ArrayBufferView as never);
  return next;
}

function preparePositioning(
  shaper: RuntimeShaper,
  prepared: PreparedParagraph,
  lines: readonly LinePlan[],
): PreparedPositioning {
  const fragmenting = profileBegin();
  const fragments = collectLineFragments(prepared, lines);
  profileEnd('layout.fragments', fragmenting);
  const ranges: ReshapeRange[] = [];
  for (const fragment of fragments) {
    if (!fragment.reshape) continue;
    const run = prepared.runs[fragment.run];
    if (run === undefined) throw new Error('line fragment references a missing shaping run');
    ranges.push({
      run: fragment.run,
      itemStart: fragment.start,
      itemEnd: fragment.end,
      contextStart: run.start,
      contextEnd: run.end,
      flags: fragment.flags,
    });
  }
  const reshaping = profileBegin();
  const reshaped = ranges.length === 0 ? undefined : ownShape(shaper.reshapeRanges({ ...prepared.request, ranges }));
  profileEnd('layout.reshape', reshaping);
  return { fragments, ...(reshaped === undefined ? {} : { reshaped }) };
}

function alignmentOffset(align: NormalizedConstraints['align'], direction: 'ltr' | 'rtl', available: number): number {
  if (align === 'center') return available / 2;
  if (align === 'end') return direction === 'ltr' ? available : 0;
  if (align === 'start') return direction === 'rtl' ? available : 0;
  return direction === 'rtl' ? available : 0;
}

function justificationSpaces(prepared: PreparedParagraph, line: LinePlan, start: number, end: number): number {
  let trimmedEnd = line.textEnd;
  while (trimmedEnd > line.textStart && prepared.input.text.charCodeAt(trimmedEnd - 1) === 0x20) {
    trimmedEnd -= 1;
  }
  return clusterRangeSum(prepared, prepared.spacePrefix, start, Math.min(end, trimmedEnd));
}

function collectLineFragments(prepared: PreparedParagraph, lines: readonly LinePlan[]): readonly LineFragment[] {
  const fragments: LineFragmentDraft[] = [];
  // One scratch buffer for the whole paragraph rather than a fresh copy of every line's levels. The reordered levels
  // of a line are read only while that line's fragments are built, so the lines share it.
  const levels = new Uint8Array(prepared.input.text.length);
  for (const [lineIndex, line] of lines.entries()) {
    const levelCount = reorderedLineLevels(prepared.bidi, line.textStart, line.textEnd, levels);
    const logicalStart = fragments.length;
    for (const [runIndex, run] of prepared.runs.entries()) {
      const start = Math.max(line.textStart, run.start);
      const end = Math.min(line.textEnd, run.end);
      if (start >= end) continue;
      let fragmentStart = start;
      while (fragmentStart < end) {
        const level = fragmentLevel(run, levels, levelCount, fragmentStart - line.textStart);
        let fragmentEnd = fragmentStart + 1;
        while (fragmentEnd < end) {
          if (fragmentLevel(run, levels, levelCount, fragmentEnd - line.textStart) !== level) break;
          fragmentEnd += 1;
        }
        fragments.push({
          line: lineIndex,
          run: runIndex,
          start: fragmentStart,
          end: fragmentEnd,
          level,
          flags: 0,
          reshape: false,
        });
        fragmentStart = fragmentEnd;
      }
    }
    const logicalEnd = fragments.length;
    for (let index = logicalStart; index < logicalEnd; index += 1) {
      const fragment = fragments[index];
      if (fragment === undefined) continue;
      const first = index === logicalStart;
      const last = index === logicalEnd - 1;
      const run = prepared.runs[fragment.run];
      if (run === undefined) throw new Error('line fragment references a missing shaping run');
      const boundaryLine = (first && line.textStart > run.start) || (last && line.textEnd < run.end);
      fragment.flags = PRODUCE_UNSAFE_TO_CONCAT | (first ? BEGINNING_OF_TEXT : 0) | (last ? END_OF_TEXT : 0);
      fragment.reshape =
        boundaryLine && fragmentHasFlag(prepared, fragment.run, fragment.start, fragment.end, GLYPH_UNSAFE_TO_CONCAT);
    }
    if (line.ellipsis !== undefined) {
      fragments.push({
        line: lineIndex,
        run: line.ellipsis.sourceRun,
        start: line.ellipsis.cluster,
        end: line.ellipsis.cluster,
        level: line.ellipsis.level,
        flags: PRODUCE_UNSAFE_TO_CONCAT,
        reshape: false,
        ellipsis: line.ellipsis,
      });
    }
    reorderFragments(fragments, logicalStart, fragments.length);
  }
  return fragments;
}

/** The bidi level a fragment resolves to, honouring a span that overrode the run's direction. */
function fragmentLevel(run: PreparedRun, levels: Uint8Array, levelCount: number, localOffset: number): number {
  const resolved = (localOffset < levelCount ? levels[localOffset] : undefined) ?? run.bidiLevel;
  return run.style.bidiOverride === undefined ? resolved : forceLevelDirection(resolved, run.direction);
}

/**
 * Writes the line's levels, with the trailing and separator resets of UAX #9 rule L1 applied, into the first
 * `end - start` entries of `levels` and returns how many it wrote.
 */
function reorderedLineLevels(bidi: OwnedBidiAnalysis, start: number, end: number, levels: Uint8Array): number {
  const count = Math.max(0, Math.min(end, bidi.levels.length) - start);
  for (let index = 0; index < count; index += 1) levels[index] = bidi.levels[start + index] ?? 0;
  const classes = bidi.classes;
  const paragraphLevel = paragraphLevelAt(bidi, start);
  let resetFrom: number | undefined = 0;
  let resetTo: number | undefined;
  let previousLevel = paragraphLevel;
  for (let index = 0; index < count; index += 1) {
    const bidiClass = classes[start + index];
    if (bidiClass === BIDI_B || bidiClass === BIDI_S) {
      resetTo = index + 1;
      resetFrom ??= index;
    } else if (
      bidiClass === BIDI_WS ||
      bidiClass === BIDI_FSI ||
      bidiClass === BIDI_LRI ||
      bidiClass === BIDI_RLI ||
      bidiClass === BIDI_PDI
    ) {
      resetFrom ??= index;
    } else if (
      bidiClass === BIDI_RLE ||
      bidiClass === BIDI_LRE ||
      bidiClass === BIDI_RLO ||
      bidiClass === BIDI_LRO ||
      bidiClass === BIDI_PDF ||
      bidiClass === BIDI_BN
    ) {
      resetFrom ??= index;
      levels[index] = previousLevel;
    } else {
      resetFrom = undefined;
    }
    if (resetFrom !== undefined && resetTo !== undefined) {
      levels.fill(paragraphLevel, resetFrom, resetTo);
      resetFrom = undefined;
      resetTo = undefined;
    }
    previousLevel = levels[index] ?? paragraphLevel;
  }
  if (resetFrom !== undefined) levels.fill(paragraphLevel, resetFrom, count);
  return count;
}

function paragraphLevelAt(bidi: OwnedBidiAnalysis, offset: number): number {
  for (let index = 0; index < bidi.paragraphStarts.length; index += 1) {
    const start = bidi.paragraphStarts[index];
    const end = bidi.paragraphEnds[index];
    if (start !== undefined && end !== undefined && start <= offset && offset < end) {
      return bidi.paragraphLevels[index] ?? 0;
    }
  }
  return bidi.paragraphLevels.at(-1) ?? 0;
}

/** Reorders `visual[rangeStart, rangeEnd)` from logical into visual order in place, by UAX #9 rule L2. */
function reorderFragments<Fragment extends { readonly level: number }>(
  visual: Fragment[],
  rangeStart: number,
  rangeEnd: number,
): void {
  let maximum = 0;
  let lowestOdd = Number.POSITIVE_INFINITY;
  for (let index = rangeStart; index < rangeEnd; index += 1) {
    const level = visual[index]?.level ?? 0;
    maximum = Math.max(maximum, level);
    if ((level & 1) === 1) lowestOdd = Math.min(lowestOdd, level);
  }
  if (!Number.isFinite(lowestOdd)) return;
  for (let level = maximum; level >= lowestOdd; level -= 1) {
    let start = rangeStart;
    while (start < rangeEnd) {
      while (start < rangeEnd && (visual[start]?.level ?? -1) < level) start += 1;
      let end = start;
      while (end < rangeEnd && (visual[end]?.level ?? -1) >= level) end += 1;
      reverse(visual, start, end);
      start = end;
    }
  }
}

function reverse<Value>(values: Value[], start: number, end: number): void {
  for (let left = start, right = end - 1; left < right; left += 1, right -= 1) {
    const value = values[left];
    if (value === undefined) break;
    values[left] = values[right] as Value;
    values[right] = value;
  }
}

function fragmentHasFlag(
  prepared: PreparedParagraph,
  runIndex: number,
  start: number,
  end: number,
  flag: number,
): boolean {
  const glyphStart = prepared.shape.runGlyphStarts[runIndex];
  const glyphCount = prepared.shape.runGlyphCounts[runIndex];
  if (glyphStart === undefined || glyphCount === undefined) return true;
  const selected = glyphRange(prepared.shape, glyphStart, glyphCount, start, end);
  const first = selected.end > selected.start ? selected.start : undefined;
  const last = selected.end > selected.start ? selected.end - 1 : undefined;
  return (
    first === undefined ||
    last === undefined ||
    ((prepared.shape.glyphFlags[first] ?? flag) & flag) !== 0 ||
    ((prepared.shape.glyphFlags[last] ?? flag) & flag) !== 0
  );
}

/**
 * The selected glyphs of a run are always one contiguous ascending span, so the selection is two indices. Materializing
 * it as an array allocated one entry per glyph to describe a range that two integers already describe.
 */
function glyphRange(
  shape: OwnedShape,
  glyphStart: number,
  glyphCount: number,
  textStart: number,
  textEnd: number,
): { readonly start: number; readonly end: number } {
  if (glyphCount === 0 || textEnd <= textStart) return EMPTY_GLYPH_RANGE;
  const firstCluster = shape.clusters[glyphStart];
  const lastCluster = shape.clusters[glyphStart + glyphCount - 1];
  if (firstCluster === undefined || lastCluster === undefined) {
    throw new Error('shaper returned an incomplete glyph cluster table');
  }
  const ascending = firstCluster <= lastCluster;
  const selectedStart = ascending
    ? glyphLowerBound(shape.clusters, glyphStart, glyphCount, textStart)
    : glyphBelow(shape.clusters, glyphStart, glyphCount, textEnd);
  const selectedEnd = ascending
    ? glyphLowerBound(shape.clusters, glyphStart, glyphCount, textEnd)
    : glyphBelow(shape.clusters, glyphStart, glyphCount, textStart);
  return { start: selectedStart, end: selectedEnd };
}

const EMPTY_GLYPH_RANGE = { start: 0, end: 0 } as const;

function glyphLowerBound(clusters: Uint32Array, glyphStart: number, glyphCount: number, target: number): number {
  let low = glyphStart;
  let high = glyphStart + glyphCount;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((clusters[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function glyphBelow(clusters: Uint32Array, glyphStart: number, glyphCount: number, target: number): number {
  let low = glyphStart;
  let high = glyphStart + glyphCount;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((clusters[middle] ?? 0) >= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function spacingBetween(prepared: PreparedParagraph, start: number, end: number): number {
  return clusterRangeSum(prepared, prepared.letterSpacingPrefix, start, end);
}

function clusterRangeSum(
  prepared: PreparedParagraph,
  prefix: Uint32Array | Float64Array,
  start: number,
  end: number,
): number {
  if (end <= start) return 0;
  // An offset past the table addresses no cluster, and answering `0` would invert the prefix difference rather than
  // return nothing. Shaped clusters cross the Wasm boundary, so a malformed one must degrade, not silently mis-space.
  const index = prepared.clusterIndexAt;
  const last = index.length - 1;
  const first = index[Math.min(start, last)] ?? 0;
  const afterLast = index[Math.min(end, last)] ?? 0;
  return (prefix[afterLast] ?? 0) - (prefix[first] ?? 0);
}

function measurementForGeometry(
  constraints: NormalizedConstraints,
  measured: ParagraphMeasurement,
  geometry: PositionedGeometry,
): ParagraphMeasurement {
  const contentWidth = maxArray(geometry.lineAdvances);
  const requiredContentWidth = Math.max(contentWidth, measured.contentWidth);
  const width = resolveAxis(constraints.width, requiredContentWidth);
  const height = measured.height;
  return {
    width,
    height,
    contentWidth: requiredContentWidth,
    contentHeight: measured.contentHeight,
    firstBaseline: geometry.lineBaselines[0] ?? 0,
    lastBaseline: geometry.lineBaselines.at(-1) ?? 0,
    overflowed: measured.overflowed || requiredContentWidth > width || measured.contentHeight > height,
  };
}

function maxArray(values: Float32Array): number {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);
  return maximum;
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
  };
}

function resolveAxis(constraint: ParagraphAxisConstraint, content: number): number {
  if (constraint.mode === 'unconstrained') return content;
  if (constraint.mode === 'at-most') return Math.min(content, constraint.size);
  return constraint.size;
}

function requireFont(shaper: RuntimeShaper, handle: FontHandle): RegisteredFont {
  const font = shaper.registry.getByHandle(handle);
  if (font === undefined) throw new RangeError(`font handle ${handle} is not active in the registry`);
  return font;
}

function drawableFragments(
  text: string,
  start: number,
  end: number,
): readonly { readonly start: number; readonly end: number }[] {
  const fragments = [];
  let fragmentStart = start;
  let offset = start;
  while (offset < end) {
    const codePoint = text.codePointAt(offset);
    if (codePoint === undefined) break;
    const length = codePoint > 0xffff ? 2 : 1;
    if (isHardBreakCodePoint(codePoint)) {
      if (fragmentStart < offset) fragments.push({ start: fragmentStart, end: offset });
      offset += length;
      if (codePoint === 0x0d && text.charCodeAt(offset) === 0x0a) offset += 1;
      fragmentStart = offset;
    } else {
      offset += length;
    }
  }
  if (fragmentStart < end) fragments.push({ start: fragmentStart, end });
  return fragments;
}

function isHardBreak(text: string, offset: number): boolean {
  const codePoint = text.codePointAt(offset);
  return codePoint !== undefined && isHardBreakCodePoint(codePoint);
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
  );
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
  );
}

function equalFeatures(left: readonly ResolvedFontFeature[], right: readonly ResolvedFontFeature[]): boolean {
  return (
    left.length === right.length &&
    left.every((feature, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        feature.tag === other.tag &&
        feature.value === other.value &&
        feature.start === other.start &&
        feature.end === other.end
      );
    })
  );
}

/**
 * Whether two shape requests would produce identical shaped output. Compares exactly what the shaper reads, so a
 * paragraph whose size, line height, or letter spacing changed rebuilds an equal request and reuses its shape.
 */
function sameShapeRequest(left: ShapeBatchRequest, right: ShapeBatchRequest): boolean {
  if (left.textUtf16.length !== right.textUtf16.length) return false;
  for (let index = 0; index < left.textUtf16.length; index += 1) {
    if (left.textUtf16[index] !== right.textUtf16[index]) return false;
  }
  if (left.runs.length !== right.runs.length) return false;
  for (let index = 0; index < left.runs.length; index += 1) {
    const a = left.runs[index]!;
    const b = right.runs[index]!;
    if (
      a.font !== b.font ||
      a.textStart !== b.textStart ||
      a.textEnd !== b.textEnd ||
      a.direction !== b.direction ||
      a.script !== b.script ||
      a.language !== b.language ||
      a.clusterLevel !== b.clusterLevel ||
      a.flags !== b.flags ||
      a.featureStart !== b.featureStart ||
      a.featureCount !== b.featureCount
    ) {
      return false;
    }
  }
  if (left.features.length !== right.features.length) return false;
  for (let index = 0; index < left.features.length; index += 1) {
    const a = left.features[index]!;
    const b = right.features[index]!;
    if (a.tag !== b.tag || a.value !== b.value || a.start !== b.start || a.end !== b.end) return false;
  }
  return true;
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
  };
}

function ownBidi(bidi: BidiAnalysisViews): OwnedBidiAnalysis {
  return {
    levels: bidi.levels.slice(),
    classes: bidi.classes.slice(),
    paragraphStarts: bidi.paragraphStarts.slice(),
    paragraphEnds: bidi.paragraphEnds.slice(),
    paragraphLevels: bidi.paragraphLevels.slice(),
  };
}

function utf16(text: string): Uint16Array {
  const result = new Uint16Array(text.length);
  for (let index = 0; index < text.length; index += 1) result[index] = text.charCodeAt(index);
  return result;
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
  };
}

function assertTextRange(start: number, end: number, textLength: number, name: string): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end || end > textLength) {
    throw new RangeError(`${name} must be a non-empty UTF-16 range inside the paragraph`);
  }
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function isNonArrayObject<T>(value: T): value is T & object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
  return value;
}

function finiteNonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
  return value;
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined;
  if (typeof language !== 'string') throw new TypeError('language must be a string');
  const normalized = language.trim().toLowerCase();
  if (normalized.length === 0) throw new RangeError('language must not be empty');
  return normalized;
}
