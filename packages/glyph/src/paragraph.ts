import { alignSpansToClusters, type FormattedText, type ParagraphSpan } from './formatted-text.js';
import type { Font } from './font.js';
import {
  acquireLoadedFontFaceSelection,
  isFontFaceSelection,
  type AnyFontFaceSelection,
  type FontFaceRasterOf,
} from './font-face.js';
import { createFontStack, immutableFontSelectionFonts, type FontSelection, type FontStack } from './loaded-font.js';
import { copyGlyphLayoutInspection, type GlyphLayoutInspection, type ParagraphMetrics } from './layout.js';
import type { AnyRasterFormat } from './config/raster-format.js';
import { mergePropertyList } from './property-list.js';
import type {
  ParagraphContentProperties,
  Constraints,
  ParagraphLayout,
  PropertyList,
  TextStyle,
} from './text-properties.js';
import {
  assertConstraints,
  assertParagraphLayout,
  assertTextStyle,
  assertTextStyleFeatureRanges,
} from './text-properties.js';
import { assertTextEffectsSupported, normalizedColumns, replacedContent } from './engine-encoding.js';
import { createGlyphEngine, createGlyphHandleState, type GlyphEngine } from './glyph-engine.js';
import type { HandleFontStackBinding, CodecRegistration, GlyphHandleState } from './internal/handle-state.js';
import { createRasterCodecProgram, resolveRasterPlanProgram, type RasterPlanProgram } from './config/raster.js';
import {
  createMeasurementPlanner,
  type MeasurementPlanner,
  type RetainedText,
  type RetainedTextOptions,
} from './internal/render-planner.js';
import { type CodecCapabilitySet, type CodecDescriptor, type CodecIdFactory, id } from './config/codec.js';
import { defineCodecBuffers, type AnyTechniqueSchema } from './config/schema.js';

const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_PARAGRAPH_TEXT_UNITS = 0x00ff_ffff;
const PLAN_REQUEST_BYTES = 64 * 1024;
const PLAN_RESULT_BYTES = 256 * 1024;
const PLAN_TEXT_UNITS = 256;
const MEASUREMENT_PROGRAM_NAMESPACE = 'paragraph-measurement';
/** Unconstrained, at-most, and exact probes cover the normal measure negotiation cycle. */
const MAX_CACHED_PARAGRAPH_CONSTRAINTS = 3;
const MEASUREMENT_STABLE_GLYPH_BUFFER_ID = id.buffer('glyph-paragraph/stable-glyph');

const measurementSystemBuffers = defineCodecBuffers({
  stableGlyphId: {
    id: MEASUREMENT_STABLE_GLYPH_BUFFER_ID,
    scalar: 'u32',
    lanes: ['stableGlyphId'],
  },
});

const measurementCapabilities: CodecCapabilitySet = Object.freeze({
  capabilities: Object.freeze([
    'storage-buffers',
    'alias-vec2',
    'alias-vec4',
    'ordered-direct',
    'stable-indirect',
  ] as const),
  maxBufferBytes: MAX_TEXT_ENGINE_OUTPUT_BYTES,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  maxBuffersPerDraw: 16,
  maxResourcesPerDraw: 16,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7_500,
});

interface ParagraphBaseOptions<Technique extends AnyRasterFormat> {
  readonly font: FontSelection<Technique> | AnyFontFaceSelection;
  /** Text shaping and presentation properties inherited by inline spans. */
  readonly style?: PropertyList<TextStyle>;
  readonly rasterPixelRatio?: number;
  /** Paragraph flow properties; width and height remain per-query inputs. */
  readonly layout?: PropertyList<ParagraphLayout>;
}

export type ParagraphOptions<Technique extends AnyRasterFormat> = ParagraphBaseOptions<Technique> &
  ParagraphContentProperties<Technique>;

type ParagraphContentUpdate<Technique extends AnyRasterFormat> = Readonly<{
  text?: ParagraphOptions<Technique>['text'];
}>;

export type ParagraphUpdate<Technique extends AnyRasterFormat> = Partial<ParagraphBaseOptions<Technique>> &
  ParagraphContentUpdate<Technique>;

interface ResolvedParagraphState<Technique extends AnyRasterFormat> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
  readonly style: TextStyle;
  readonly rasterPixelRatio?: number;
  readonly layout: ParagraphLayout;
}

interface MeasurementServiceLease {
  readonly glyphEngine: GlyphEngine;
  readonly handleState: GlyphHandleState;
  release(): void;
}

interface MeasurementService {
  readonly glyphEngine: GlyphEngine;
  readonly handleState: GlyphHandleState;
}

/** A renderer-free retained paragraph whose queries are synchronous after async construction. */
export class Paragraph<Technique extends AnyRasterFormat = AnyRasterFormat> {
  #desired: ResolvedParagraphState<Technique>;
  #authoredFont: FontSelection<Technique> | AnyFontFaceSelection;
  #ownedFont: Font<AnyRasterFormat> | undefined;
  #engine: ParagraphEngine;
  readonly #serviceLease: MeasurementServiceLease;
  readonly #measurements = new Map<string, ParagraphMetrics>();
  readonly #layouts = new Map<string, GlyphLayoutInspection>();
  #engineConstraintKey: string | undefined;
  #engineConstraints: Constraints = {};
  #lastLayoutDigest: string | undefined;
  #layoutRevision = 0;
  #disposed = false;

  private constructor(
    desired: ResolvedParagraphState<Technique>,
    authoredFont: FontSelection<Technique> | AnyFontFaceSelection,
    ownedFont: Font<AnyRasterFormat> | undefined,
    serviceLease: MeasurementServiceLease,
    engine: ParagraphEngine,
  ) {
    this.#desired = desired;
    this.#authoredFont = authoredFont;
    this.#ownedFont = ownedFont;
    this.#serviceLease = serviceLease;
    this.#engine = engine;
  }

  /** @internal The root factory owns asynchronous engine acquisition. */
  static _create<Technique extends AnyRasterFormat>(
    desired: ResolvedParagraphState<Technique>,
    authoredFont: FontSelection<Technique> | AnyFontFaceSelection,
    ownedFont: Font<AnyRasterFormat> | undefined,
    serviceLease: MeasurementServiceLease,
    engine: ParagraphEngine,
  ): Paragraph<Technique> {
    return new Paragraph(desired, authoredFont, ownedFont, serviceLease, engine);
  }

  get font(): FontSelection<Technique> | AnyFontFaceSelection {
    return this.#authoredFont;
  }
  get text(): string {
    return this.#desired.text;
  }
  /** Text shaping and presentation properties inherited by inline spans. */
  get style(): TextStyle {
    return this.#desired.style;
  }
  /** Paragraph flow properties such as wrapping, alignment, and line limits. */
  get layout(): ParagraphLayout {
    return this.#desired.layout;
  }
  get layoutRevision(): number {
    return this.#layoutRevision;
  }
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Measure current desired text without a renderer, scene, matrix, or publication.
   * A cache miss may synchronously incur font and measure lookup work in the text engine.
   */
  measure(constraints?: Constraints): ParagraphMetrics {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    const cached = readParagraphQueryCache(this.#measurements, key);
    if (cached !== undefined) return cached;
    this.#selectConstraints(key, resolved);
    const measured = this.#engine.text.measure();
    writeParagraphQueryCache(this.#measurements, key, measured);
    return measured;
  }

  /**
   * Return caller-owned positioned glyph and line columns for current desired text.
   * A cache miss may synchronously incur glyph lookup and positioning work; every call copies the columns.
   */
  glyphs(constraints?: Constraints): GlyphLayoutInspection {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    let inspection = readParagraphQueryCache(this.#layouts, key);
    if (inspection === undefined) {
      this.#selectConstraints(key, resolved);
      inspection = this.#engine.text.glyphs();
      writeParagraphQueryCache(this.#layouts, key, inspection);
    }
    const digest = layoutDigest(inspection);
    if (digest !== this.#lastLayoutDigest) {
      this.#lastLayoutDigest = digest;
      this.#layoutRevision += 1;
    }
    return copyGlyphLayoutInspection(inspection);
  }

  /** Replace desired authored state; malformed input rejects before state changes. */
  update(update: ParagraphUpdate<Technique>): void {
    this.#assertActive();
    assertNoRawSpans(update, 'paragraph update');
    const normalizedUpdate = replacedContent(update);
    if (!hasParagraphChange(normalizedUpdate)) return;
    const authoredFont = Object.hasOwn(normalizedUpdate, 'font')
      ? (normalizedUpdate.font as FontSelection<Technique> | AnyFontFaceSelection)
      : this.#authoredFont;
    const resolved =
      authoredFont === this.#authoredFont
        ? { font: this.#desired.font, owned: this.#ownedFont }
        : resolveParagraphFont(authoredFont);
    try {
      const next = normalizeParagraphState(
        { ...this.#desired, ...normalizedUpdate, font: resolved.font } as ResolvedParagraphOptions<Technique>,
        this.#desired,
      );
      if (sameTechniqueSet(this.#desired, next)) {
        this.#engine.update(next, this.#engineConstraints);
      } else {
        const replacement = new ParagraphEngine(this.#serviceLease.handleState, next, this.#engineConstraints);
        const previous = this.#engine;
        this.#engine = replacement;
        previous.dispose();
      }
      const previousOwned = this.#ownedFont;
      this.#desired = next;
      this.#authoredFont = authoredFont;
      this.#ownedFont = resolved.owned;
      if (previousOwned !== resolved.owned) previousOwned?.dispose();
    } catch (error) {
      if (resolved.owned !== this.#ownedFont) resolved.owned?.dispose();
      throw error;
    }
    this.#measurements.clear();
    this.#layouts.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    try {
      this.#engine.dispose();
    } catch (error) {
      failure = error;
    }
    try {
      this.#serviceLease.release();
    } catch (error) {
      failure ??= error;
    }
    try {
      this.#ownedFont?.dispose();
      this.#ownedFont = undefined;
    } catch (error) {
      failure ??= error;
    }
    this.#measurements.clear();
    this.#layouts.clear();
    if (failure !== undefined) throw failure;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  #selectConstraints(key: string, constraints: Constraints): void {
    if (this.#engineConstraintKey === key) return;
    normalizedColumns(this.#desired.layout, constraints);
    this.#engine.update(this.#desired, constraints);
    this.#engineConstraintKey = key;
    this.#engineConstraints = constraints;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph has been disposed');
  }
}

function readParagraphQueryCache<Value>(cache: Map<string, Value>, key: string): Value | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function writeParagraphQueryCache<Value>(cache: Map<string, Value>, key: string, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= MAX_CACHED_PARAGRAPH_CONSTRAINTS) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/** Initialize renderer-free measurement, then return a synchronously queryable Paragraph. */
export function createParagraph<const Selection extends AnyFontFaceSelection>(
  options: Omit<ParagraphOptions<FontFaceRasterOf<Selection>>, 'font'> & { readonly font: Selection },
): Promise<Paragraph<FontFaceRasterOf<Selection>>>;
export function createParagraph<Technique extends AnyRasterFormat>(
  options: ParagraphOptions<Technique>,
): Promise<Paragraph<Technique>>;
export async function createParagraph<Technique extends AnyRasterFormat>(
  options: ParagraphOptions<Technique>,
): Promise<Paragraph<Technique>> {
  if (options === undefined) throw new TypeError('paragraph options are required');
  assertNoRawSpans(options, 'paragraph options');
  const resolved = resolveParagraphFont(options.font);
  let desired: ResolvedParagraphState<Technique>;
  try {
    desired = normalizeParagraphState({ ...options, font: resolved.font });
  } catch (error) {
    resolved.owned?.dispose();
    throw error;
  }
  const constraints = resolveConstraints(undefined);
  normalizedColumns(desired.layout, constraints);
  const serviceLease = await acquireMeasurementService();
  try {
    const engine = new ParagraphEngine(serviceLease.handleState, desired, constraints);
    return Paragraph._create(desired, options.font, resolved.owned, serviceLease, engine);
  } catch (error) {
    resolved.owned?.dispose();
    serviceLease.release();
    throw error;
  }
}

type ResolvedParagraphOptions<Technique extends AnyRasterFormat> = Omit<ParagraphOptions<Technique>, 'font'> & {
  readonly font: FontSelection<Technique>;
};

function resolveParagraphFont<Technique extends AnyRasterFormat>(
  selection: FontSelection<Technique> | AnyFontFaceSelection,
): { readonly font: FontSelection<Technique>; readonly owned: Font<AnyRasterFormat> | undefined } {
  if (isFontFaceSelection(selection)) {
    const font = acquireLoadedFontFaceSelection(selection) as Font<Technique>;
    return { font, owned: font };
  }
  immutableFontSelectionFonts(selection);
  return { font: selection, owned: undefined };
}

class ParagraphEngine {
  readonly handleState: GlyphHandleState;
  readonly codec: CodecRegistration;
  readonly planner: MeasurementPlanner;
  readonly text: RetainedText;
  readonly #singleFontStacks = new WeakMap<Font<AnyRasterFormat>, FontStack<AnyRasterFormat, Font<AnyRasterFormat>>>();
  #disposed = false;

  constructor(
    handleState: GlyphHandleState,
    desired: ResolvedParagraphState<AnyRasterFormat>,
    constraints: Constraints,
  ) {
    let codec: CodecRegistration | undefined;
    let planner: MeasurementPlanner | undefined;
    let text: RetainedText | undefined;
    try {
      codec = handleState.installCodec((identities) => measurementCodecDescriptor(identities, desired));
      planner = createMeasurementPlanner(handleState, {
        codec,
        limits: measurementLimits(),
        requestCapacity: PLAN_REQUEST_BYTES,
        resultCapacity: PLAN_RESULT_BYTES,
        textCapacity: Math.max(PLAN_TEXT_UNITS, desired.text.length + 1),
      });
      text = createEngineText(handleState, planner, desired, constraints, this.#singleFontStacks);
    } catch (error) {
      let teardownFailure: Readonly<{ error: unknown }> | undefined;
      try {
        text?.dispose();
        planner?.dispose();
        codec?.dispose();
      } catch (disposeError) {
        teardownFailure = { error: disposeError };
      }
      if (teardownFailure !== undefined) {
        // oxlint-disable-next-line eslint/preserve-caught-error -- AggregateError retains both caught failures.
        throw new AggregateError([error, teardownFailure.error], 'paragraph construction and teardown both failed', {
          cause: error,
        });
      }
      throw error;
    }
    this.handleState = handleState;
    this.codec = codec;
    this.planner = planner;
    this.text = text;
  }

  update(desired: ResolvedParagraphState<AnyRasterFormat>, constraints: Constraints): void {
    this.#assertActive();
    const bindings: HandleFontStackBinding[] = [];
    try {
      this.text.update(engineTextOptions(this.handleState, desired, constraints, bindings, this.#singleFontStacks));
    } finally {
      disposeBindings(bindings);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const dispose of [() => this.text.dispose(), () => this.planner.dispose(), () => this.codec.dispose()]) {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph engine has been disposed');
  }
}

function createEngineText(
  handleState: GlyphHandleState,
  planner: MeasurementPlanner,
  desired: ResolvedParagraphState<AnyRasterFormat>,
  constraints: Constraints,
  singleFontStacks: WeakMap<Font<AnyRasterFormat>, FontStack<AnyRasterFormat, Font<AnyRasterFormat>>>,
): RetainedText {
  const bindings: HandleFontStackBinding[] = [];
  try {
    return planner.createText(engineTextOptions(handleState, desired, constraints, bindings, singleFontStacks));
  } finally {
    disposeBindings(bindings);
  }
}

function engineTextOptions(
  handleState: GlyphHandleState,
  desired: ResolvedParagraphState<AnyRasterFormat>,
  constraints: Constraints,
  bindings: HandleFontStackBinding[],
  singleFontStacks: WeakMap<Font<AnyRasterFormat>, FontStack<AnyRasterFormat, Font<AnyRasterFormat>>>,
): RetainedTextOptions {
  const font = bindSelection(handleState, desired.font, bindings, singleFontStacks);
  const spans = desired.spans.map((span) => ({
    start: span.start,
    end: span.end,
    ...(span.font === undefined ? {} : { font: bindSelection(handleState, span.font, bindings, singleFontStacks) }),
    ...(span.style === undefined ? {} : { style: span.style }),
  }));
  return {
    font,
    text: spans.length === 0 ? desired.text : { text: desired.text, spans },
    style: desired.style,
    layout: desired.layout,
    constraints,
    ...(desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: desired.rasterPixelRatio }),
  };
}

function bindSelection(
  handleState: GlyphHandleState,
  selection: FontSelection<AnyRasterFormat>,
  bindings: HandleFontStackBinding[],
  singleFontStacks: WeakMap<Font<AnyRasterFormat>, FontStack<AnyRasterFormat, Font<AnyRasterFormat>>>,
): HandleFontStackBinding {
  const fonts = immutableFontSelectionFonts(selection);
  let stack: FontStack<AnyRasterFormat, Font<AnyRasterFormat>>;
  if ('fonts' in selection) {
    stack = selection as FontStack<AnyRasterFormat, Font<AnyRasterFormat>>;
  } else {
    const font = fonts[0];
    stack = singleFontStacks.get(font) ?? createFontStack(font);
    singleFontStacks.set(font, stack);
  }
  const binding = handleState.bindFontStack(stack);
  bindings.push(binding);
  return binding;
}

function disposeBindings(bindings: readonly HandleFontStackBinding[]): void {
  let failure: unknown;
  for (const binding of [...bindings].reverse()) {
    try {
      binding.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

function measurementCodecDescriptor(
  identities: CodecIdFactory,
  desired: ResolvedParagraphState<AnyRasterFormat>,
): CodecDescriptor {
  const programs = uniqueTechniques(desired).map((technique) => {
    const program = resolveRasterPlanProgram(technique.id);
    if (program === undefined) {
      throw new TypeError(`no portable raster plan program is registered for "${technique.id}"`);
    }
    return createRasterCodecProgram(program as RasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema>, {
      namespace: MEASUREMENT_PROGRAM_NAMESPACE,
      system: measurementSystemBuffers,
      capabilitySet: measurementCapabilities,
      transformMode: 'direct',
      allocationMode: 'ordered',
      ids: identities,
    });
  });
  return { capabilitySets: [measurementCapabilities], programs };
}

function measurementLimits() {
  return Object.freeze({
    maxParagraphs: 1,
    maxClusters: MAX_PARAGRAPH_TEXT_UNITS,
    maxLines: MAX_PARAGRAPH_TEXT_UNITS,
    maxRegions: 16,
    maxExclusions: 1,
    maxInlineObjects: 1,
    maxSlotsPerBand: 32,
    maxOutputBytes: MAX_TEXT_ENGINE_OUTPUT_BYTES,
  });
}

function uniqueTechniques(desired: ResolvedParagraphState<AnyRasterFormat>): readonly AnyRasterFormat[] {
  const byId = new Map<string, AnyRasterFormat>();
  const selections: FontSelection<AnyRasterFormat>[] = [desired.font];
  for (const span of desired.spans) if (span.font !== undefined) selections.push(span.font);
  for (const selection of selections) {
    for (const font of immutableFontSelectionFonts(selection)) {
      const existing = byId.get(font.raster.id);
      if (existing !== undefined && existing !== font.raster) {
        throw new TypeError(`font techniques reuse the id "${font.raster.id}" with different objects`);
      }
      byId.set(font.raster.id, font.raster);
    }
  }
  return [...byId.values()];
}

function sameTechniqueSet(
  left: ResolvedParagraphState<AnyRasterFormat>,
  right: ResolvedParagraphState<AnyRasterFormat>,
): boolean {
  const leftIds = uniqueTechniques(left)
    .map(({ id: techniqueId }) => techniqueId)
    .sort();
  const rightIds = uniqueTechniques(right)
    .map(({ id: techniqueId }) => techniqueId)
    .sort();
  return leftIds.length === rightIds.length && leftIds.every((value, index) => value === rightIds[index]);
}

function resolveConstraints(constraints: Constraints | undefined): Constraints {
  if (constraints !== undefined) assertConstraints(constraints, 'paragraph constraints');
  const width = constraints?.width;
  const height = constraints?.height;
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function axisKey(constraints: Constraints): string {
  const key = (value: Constraints['width']): string =>
    value === undefined || value.mode === 'unconstrained' ? 'u' : `${value.mode}:${value.size}`;
  return `${key(constraints.width)}|${key(constraints.height)}`;
}

function hasParagraphChange<Technique extends AnyRasterFormat>(update: ParagraphUpdate<Technique>): boolean {
  return ['font', 'text', 'style', 'rasterPixelRatio', 'layout'].some((key) => Object.hasOwn(update, key));
}

function frozenDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => frozenDeep(entry))) as Value;
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) copy[key] = frozenDeep(nested);
  return Object.freeze(copy) as Value;
}

function normalizeParagraphState<Technique extends AnyRasterFormat>(
  properties: ResolvedParagraphOptions<Technique>,
  previous?: ResolvedParagraphState<Technique>,
): ResolvedParagraphState<Technique> {
  if (properties === null || typeof properties !== 'object') throw new TypeError('paragraph options must be an object');
  const formatted = typeof properties.text === 'string' ? undefined : (properties.text as FormattedText<Technique>);
  const text = formatted?.text ?? (properties.text as string);
  const stated = formatted?.spans ?? (properties as ResolvedParagraphState<Technique>).spans ?? [];
  const resolved =
    previous !== undefined && previous.text === text && previous.spans === stated
      ? stated
      : alignSpansToClusters(text, stated);
  const spans =
    resolved === previous?.spans ? previous.spans : Object.freeze(resolved.map((span) => frozenDeep({ ...span })));
  immutableFontSelectionFonts(properties.font);
  for (const [index, span] of spans.entries()) {
    if (span.font !== undefined) immutableFontSelectionFonts(span.font);
    if (span.style !== undefined) {
      assertTextStyle(span.style, `paragraph span ${index} style`);
      assertTextStyleFeatureRanges(span.style, span.start, span.end, `paragraph span ${index} style`);
    }
  }
  const style = mergePropertyList(properties.style, 'paragraph style');
  const layout = mergePropertyList(properties.layout, 'paragraph layout');
  assertTextStyle(style, 'paragraph style');
  assertTextStyleFeatureRanges(style, 0, text.length, 'paragraph style');
  assertParagraphLayout(layout, 'paragraph layout');
  const rootTechniques = immutableFontSelectionFonts(properties.font).map((font) => font.raster);
  assertTextEffectsSupported(
    style,
    [
      ...rootTechniques,
      ...spans.flatMap((span) =>
        span.font === undefined ? [] : immutableFontSelectionFonts(span.font).map((font) => font.raster),
      ),
    ],
    'paragraph style',
  );
  for (const [index, span] of spans.entries()) {
    if (span.style === undefined) continue;
    assertTextEffectsSupported(
      span.style,
      span.font === undefined ? rootTechniques : immutableFontSelectionFonts(span.font).map((font) => font.raster),
      `paragraph span ${index} style`,
    );
  }
  if (
    properties.rasterPixelRatio !== undefined &&
    (!Number.isFinite(properties.rasterPixelRatio) || properties.rasterPixelRatio <= 0)
  ) {
    throw new RangeError('paragraph rasterPixelRatio must be positive and finite');
  }
  return Object.freeze({
    font: properties.font,
    text,
    spans,
    style: frozenDeep(style),
    layout: frozenDeep(layout),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
  });
}

function assertNoRawSpans(value: object, subject: string): void {
  if (Object.hasOwn(value, 'spans')) {
    throw new TypeError(`${subject} cannot declare raw spans; compose formatted text with txt and span`);
  }
}

let measurementServicePromise: Promise<MeasurementService> | undefined;
let measurementServiceReferences = 0;

/** @internal Deterministic lifecycle evidence for package tests. */
export function paragraphMeasurementServiceReport(): Readonly<{ active: boolean; paragraphs: number }> {
  return { active: measurementServicePromise !== undefined, paragraphs: measurementServiceReferences };
}

function acquireMeasurementService(): Promise<MeasurementServiceLease> {
  measurementServiceReferences += 1;
  let promise = measurementServicePromise;
  if (promise === undefined) {
    promise = createMeasurementService();
    measurementServicePromise = promise;
    void promise.catch(() => {
      if (measurementServicePromise === promise) measurementServicePromise = undefined;
    });
  }
  return promise.then(
    (service) => {
      let released = false;
      return {
        ...service,
        release() {
          if (released) return;
          released = true;
          releaseMeasurementService(service, promise);
        },
      };
    },
    (error: unknown) => {
      measurementServiceReferences -= 1;
      throw error;
    },
  );
}

async function createMeasurementService(): Promise<MeasurementService> {
  const glyphEngine = await createGlyphEngine();
  try {
    return {
      glyphEngine,
      handleState: createGlyphHandleState(glyphEngine, { integration: '@pmndrs/glyph/paragraph' }),
    };
  } catch (error) {
    glyphEngine.dispose();
    throw error;
  }
}

function releaseMeasurementService(service: MeasurementService, promise: Promise<MeasurementService>): void {
  if (measurementServiceReferences <= 0) throw new Error('paragraph measurement service lease underflow');
  measurementServiceReferences -= 1;
  if (measurementServiceReferences !== 0) return;
  if (measurementServicePromise === promise) measurementServicePromise = undefined;
  service.glyphEngine.dispose();
}

function layoutDigest(layout: GlyphLayoutInspection): string {
  const lanes = [0x811c_9dc5, 0x0100_0193, 0x9dc5_811c];
  const mixByte = (byte: number): void => {
    for (const [index, seed] of lanes.entries()) {
      lanes[index] = Math.imul(seed ^ byte, 0x0100_0193 + index * 0x9e37_79b9) >>> 0;
    }
  };
  const mixArray = (array: Uint8Array | Uint16Array | Uint32Array | Float32Array): void => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let index = 0; index < bytes.length; index += 1) mixByte(bytes[index]!);
  };
  const mixNumber = (value: number): void => mixArray(Float32Array.of(value));
  for (const value of [
    layout.width,
    layout.height,
    layout.contentWidth,
    layout.contentHeight,
    layout.firstBaseline,
    layout.lastBaseline,
    layout.ascent,
    layout.descent,
    layout.lineHeight,
    layout.minContentWidth,
    layout.maxContentWidth,
    layout.overflowed ? 1 : 0,
    layout.glyphCount,
    layout.lineCount,
    layout.missingGlyphCount,
  ]) {
    mixNumber(value);
  }
  mixNumber(layout.inkBounds === undefined ? 0 : 1);
  if (layout.inkBounds !== undefined) {
    for (const value of [layout.inkBounds.x, layout.inkBounds.y, layout.inkBounds.width, layout.inkBounds.height]) {
      mixNumber(value);
    }
  }
  for (const array of [
    layout.fontHandles,
    layout.glyphIds,
    layout.clusters,
    layout.glyphBidiLevels,
    layout.glyphFontSlots,
    layout.glyphFontSizes,
    layout.x,
    layout.y,
    layout.glyphAdvances,
    layout.glyphInkX,
    layout.glyphInkY,
    layout.glyphInkWidths,
    layout.glyphInkHeights,
    layout.glyphFlags,
    layout.lineTextStarts,
    layout.lineTextEnds,
    layout.lineGlyphStarts,
    layout.lineGlyphCounts,
    layout.lineBaselines,
    layout.lineAdvances,
  ]) {
    mixArray(array);
  }
  for (const line of layout.lines) {
    mixNumber(line.ascent);
    mixNumber(line.descent);
    mixNumber(line.lineHeight);
    mixNumber(line.inkBounds === undefined ? 0 : 1);
    if (line.inkBounds !== undefined) {
      for (const value of [line.inkBounds.x, line.inkBounds.y, line.inkBounds.width, line.inkBounds.height]) {
        mixNumber(value);
      }
    }
  }
  return lanes.map((lane) => lane.toString(16).padStart(8, '0')).join('');
}
