import {
  alignSpansToClusters,
  type FormattedText,
  type GlyphPaintInput,
  type ParagraphSpan,
} from './formatted-text.js';
import type { Font } from './font.js';
import { createFontStack, immutableFontSelectionFonts, type FontSelection, type FontStack } from './loaded-font.js';
import { copyParagraphLayoutInspection, type ParagraphLayoutInspection, type ParagraphMetrics } from './layout.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import type {
  ParagraphContentBox,
  ParagraphContentProperties,
  ParagraphConstraints,
  ParagraphLayoutPolicy,
  ParagraphStyle,
} from './text-properties.js';
import { normalizedColumns, replacedContent } from './engine-encoding.js';
import { createGlyphEngine, type GlyphEngine } from './glyph-engine.js';
import type { BackendFontStackBinding, BackendPolicy, GlyphBackend } from './core/backend.js';
import {
  createRasterPolicyProgram,
  resolveRasterPlanProgram,
  type RasterPlanProgram,
} from './core/raster-plan-program.js';
import {
  createMeasurementPlan,
  type MeasurementPlan,
  type RetainedText,
  type RetainedTextOptions,
} from './core/retained-plan.js';
import { type PolicyCapabilitySet, type PolicyDescriptor, type RenderIdFactory, id } from './core/render-policy.js';
import { definePolicyBuffers, type AnyTechniqueSchema } from './core/technique-schema.js';

const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_PARAGRAPH_TEXT_UNITS = 0x00ff_ffff;
const PLAN_REQUEST_BYTES = 64 * 1024;
const PLAN_RESULT_BYTES = 256 * 1024;
const PLAN_TEXT_UNITS = 256;
const MEASUREMENT_PROGRAM_NAMESPACE = 'paragraph-measurement';
/** Unconstrained, at-most, and exact probes cover the normal layout negotiation cycle. */
const MAX_CACHED_PARAGRAPH_CONSTRAINTS = 3;
const MEASUREMENT_STABLE_GLYPH_BUFFER_ID = id.buffer('glyph-paragraph/stable-glyph');

const measurementSystemBuffers = definePolicyBuffers({
  stableGlyphId: {
    id: MEASUREMENT_STABLE_GLYPH_BUFFER_ID,
    scalar: 'u32',
    lanes: ['stableGlyphId'],
  },
});

const measurementCapabilities: PolicyCapabilitySet = Object.freeze({
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

interface ParagraphBaseOptions<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  /** Stable flow policy; width and height remain per-query inputs. */
  readonly policy?: ParagraphLayoutPolicy;
}

export type ParagraphOptions<Technique extends AnyRasterTechnique> = ParagraphBaseOptions<Technique> &
  ParagraphContentProperties<Technique>;

type ParagraphContentUpdate<Technique extends AnyRasterTechnique> =
  | Readonly<{ text?: string; spans?: readonly ParagraphSpan<Technique>[] }>
  | Readonly<{ text: FormattedText<Technique>; spans?: never }>;

export type ParagraphUpdate<Technique extends AnyRasterTechnique> = Partial<ParagraphBaseOptions<Technique>> &
  ParagraphContentUpdate<Technique>;

interface ResolvedParagraphState<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
  readonly style: ParagraphStyle;
  readonly paint: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly policy: ParagraphLayoutPolicy;
}

interface MeasurementServiceLease {
  readonly glyphEngine: GlyphEngine;
  readonly backend: GlyphBackend;
  release(): void;
}

interface MeasurementService {
  readonly glyphEngine: GlyphEngine;
  readonly backend: GlyphBackend;
}

/** A renderer-free retained paragraph whose queries are synchronous after async construction. */
export class Paragraph<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  #desired: ResolvedParagraphState<Technique>;
  #engine: ParagraphEngine;
  readonly #serviceLease: MeasurementServiceLease;
  readonly #measurements = new Map<string, ParagraphMetrics>();
  readonly #layouts = new Map<string, ParagraphLayoutInspection>();
  #engineConstraintKey: string | undefined;
  #engineBox: ParagraphContentBox;
  #lastLayoutDigest: string | undefined;
  #layoutRevision = 0;
  #disposed = false;

  private constructor(
    desired: ResolvedParagraphState<Technique>,
    serviceLease: MeasurementServiceLease,
    engine: ParagraphEngine,
  ) {
    this.#desired = desired;
    this.#serviceLease = serviceLease;
    this.#engine = engine;
    this.#engineBox = flowBox(desired.policy, undefined, undefined);
  }

  /** @internal The root factory owns asynchronous engine acquisition. */
  static _create<Technique extends AnyRasterTechnique>(
    desired: ResolvedParagraphState<Technique>,
    serviceLease: MeasurementServiceLease,
    engine: ParagraphEngine,
  ): Paragraph<Technique> {
    return new Paragraph(desired, serviceLease, engine);
  }

  get font(): FontSelection<Technique> {
    return this.#desired.font;
  }
  get text(): string {
    return this.#desired.text;
  }
  get spans(): readonly ParagraphSpan<Technique>[] {
    return this.#desired.spans;
  }
  get style(): ParagraphStyle {
    return this.#desired.style;
  }
  get paint(): GlyphPaintInput {
    return this.#desired.paint;
  }
  get policy(): ParagraphLayoutPolicy {
    return this.#desired.policy;
  }
  get layoutRevision(): number {
    return this.#layoutRevision;
  }
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Measure current desired text without a renderer, scene, matrix, or publication.
   * A cache miss may synchronously incur font and layout lookup work in the text engine.
   */
  layout(constraints?: ParagraphConstraints): ParagraphMetrics {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    const cached = readParagraphQueryCache(this.#measurements, key);
    if (cached !== undefined) return cached;
    this.#selectConstraints(key, resolved);
    const measured = this.#engine.text.layout();
    writeParagraphQueryCache(this.#measurements, key, measured);
    return measured;
  }

  /**
   * Return caller-owned positioned glyph and line columns for current desired text.
   * A cache miss may synchronously incur glyph lookup and positioning work; every call copies the columns.
   */
  glyphs(constraints?: ParagraphConstraints): ParagraphLayoutInspection {
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
    return copyParagraphLayoutInspection(inspection);
  }

  /** Replace desired authored state; malformed input rejects before state changes. */
  update(update: ParagraphUpdate<Technique>): void {
    this.#assertActive();
    const normalizedUpdate = replacedContent(update);
    if (!hasParagraphChange(normalizedUpdate)) return;
    const next = normalizeParagraphState(
      { ...this.#desired, ...normalizedUpdate } as ParagraphOptions<Technique>,
      this.#desired,
    );
    const nextBox = flowBox(next.policy, this.#engineBox.width, this.#engineBox.height);
    if (sameTechniqueSet(this.#desired, next)) {
      this.#engine.update(next, nextBox);
    } else {
      const replacement = new ParagraphEngine(this.#serviceLease.backend, next, nextBox);
      const previous = this.#engine;
      this.#engine = replacement;
      previous.dispose();
    }
    this.#desired = next;
    this.#engineBox = nextBox;
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
    this.#measurements.clear();
    this.#layouts.clear();
    if (failure !== undefined) throw failure;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  #selectConstraints(key: string, constraints: ResolvedConstraints): void {
    if (this.#engineConstraintKey === key) return;
    const box = flowBox(this.#desired.policy, constraints.width, constraints.height);
    normalizedColumns(box);
    this.#engine.update(this.#desired, box);
    this.#engineConstraintKey = key;
    this.#engineBox = box;
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
export async function createParagraph<Technique extends AnyRasterTechnique>(
  options: ParagraphOptions<Technique>,
): Promise<Paragraph<Technique>> {
  if (options === undefined) throw new TypeError('paragraph options are required');
  const desired = normalizeParagraphState(options);
  const box = flowBox(desired.policy, undefined, undefined);
  normalizedColumns(box);
  const serviceLease = await acquireMeasurementService();
  try {
    const engine = new ParagraphEngine(serviceLease.backend, desired, box);
    return Paragraph._create(desired, serviceLease, engine);
  } catch (error) {
    serviceLease.release();
    throw error;
  }
}

class ParagraphEngine {
  readonly backend: GlyphBackend;
  readonly policy: BackendPolicy;
  readonly retainedPlan: MeasurementPlan;
  readonly text: RetainedText;
  readonly #singleFontStacks = new WeakMap<
    Font<AnyRasterTechnique>,
    FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>
  >();
  #disposed = false;

  constructor(backend: GlyphBackend, desired: ResolvedParagraphState<AnyRasterTechnique>, box: ParagraphContentBox) {
    let policy: BackendPolicy | undefined;
    let retainedPlan: MeasurementPlan | undefined;
    let text: RetainedText | undefined;
    try {
      policy = backend.installPolicy((identities) => measurementPolicyDescriptor(identities, desired));
      retainedPlan = createMeasurementPlan(backend, {
        policy,
        limits: measurementLimits(),
        requestCapacity: PLAN_REQUEST_BYTES,
        resultCapacity: PLAN_RESULT_BYTES,
        textCapacity: Math.max(PLAN_TEXT_UNITS, desired.text.length + 1),
      });
      text = createEngineText(backend, retainedPlan, desired, box, this.#singleFontStacks);
    } catch (error) {
      let teardownFailure: Readonly<{ error: unknown }> | undefined;
      try {
        text?.dispose();
        retainedPlan?.dispose();
        policy?.dispose();
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
    this.backend = backend;
    this.policy = policy;
    this.retainedPlan = retainedPlan;
    this.text = text;
  }

  update(desired: ResolvedParagraphState<AnyRasterTechnique>, box: ParagraphContentBox): void {
    this.#assertActive();
    const bindings: BackendFontStackBinding[] = [];
    try {
      this.text.update(engineTextOptions(this.backend, desired, box, bindings, this.#singleFontStacks));
    } finally {
      disposeBindings(bindings);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const dispose of [() => this.text.dispose(), () => this.retainedPlan.dispose(), () => this.policy.dispose()]) {
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
  backend: GlyphBackend,
  retainedPlan: MeasurementPlan,
  desired: ResolvedParagraphState<AnyRasterTechnique>,
  box: ParagraphContentBox,
  singleFontStacks: WeakMap<Font<AnyRasterTechnique>, FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>>,
): RetainedText {
  const bindings: BackendFontStackBinding[] = [];
  try {
    return retainedPlan.createText(engineTextOptions(backend, desired, box, bindings, singleFontStacks));
  } finally {
    disposeBindings(bindings);
  }
}

function engineTextOptions(
  backend: GlyphBackend,
  desired: ResolvedParagraphState<AnyRasterTechnique>,
  box: ParagraphContentBox,
  bindings: BackendFontStackBinding[],
  singleFontStacks: WeakMap<Font<AnyRasterTechnique>, FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>>,
): RetainedTextOptions {
  const font = bindSelection(backend, desired.font, bindings, singleFontStacks);
  const spans = desired.spans.map((span) => ({
    start: span.start,
    end: span.end,
    ...(span.font === undefined ? {} : { font: bindSelection(backend, span.font, bindings, singleFontStacks) }),
    ...(span.style === undefined ? {} : { style: span.style }),
    ...(span.paint === undefined ? {} : { paint: span.paint }),
  }));
  return {
    font,
    text: spans.length === 0 ? desired.text : { text: desired.text, spans },
    contentBox: box,
    style: desired.style,
    paint: desired.paint,
    ...(desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: desired.rasterPixelRatio }),
  };
}

function bindSelection(
  backend: GlyphBackend,
  selection: FontSelection<AnyRasterTechnique>,
  bindings: BackendFontStackBinding[],
  singleFontStacks: WeakMap<Font<AnyRasterTechnique>, FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>>,
): BackendFontStackBinding {
  const fonts = immutableFontSelectionFonts(selection);
  let stack: FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>;
  if ('fonts' in selection) {
    stack = selection as FontStack<AnyRasterTechnique, Font<AnyRasterTechnique>>;
  } else {
    const font = fonts[0];
    stack = singleFontStacks.get(font) ?? createFontStack(font);
    singleFontStacks.set(font, stack);
  }
  const binding = backend.bindFontStack(stack);
  bindings.push(binding);
  return binding;
}

function disposeBindings(bindings: readonly BackendFontStackBinding[]): void {
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

function measurementPolicyDescriptor(
  identities: RenderIdFactory,
  desired: ResolvedParagraphState<AnyRasterTechnique>,
): PolicyDescriptor {
  const programs = uniqueTechniques(desired).map((technique) => {
    const program = resolveRasterPlanProgram(technique.id);
    if (program === undefined) {
      throw new TypeError(`no portable raster plan program is registered for "${technique.id}"`);
    }
    return createRasterPolicyProgram(program as RasterPlanProgram<AnyRasterTechnique, AnyTechniqueSchema>, {
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

function uniqueTechniques(desired: ResolvedParagraphState<AnyRasterTechnique>): readonly AnyRasterTechnique[] {
  const byId = new Map<string, AnyRasterTechnique>();
  const selections: FontSelection<AnyRasterTechnique>[] = [desired.font];
  for (const span of desired.spans) if (span.font !== undefined) selections.push(span.font);
  for (const selection of selections) {
    for (const font of immutableFontSelectionFonts(selection)) {
      const existing = byId.get(font.technique.id);
      if (existing !== undefined && existing !== font.technique) {
        throw new TypeError(`font techniques reuse the id "${font.technique.id}" with different objects`);
      }
      byId.set(font.technique.id, font.technique);
    }
  }
  return [...byId.values()];
}

function sameTechniqueSet(
  left: ResolvedParagraphState<AnyRasterTechnique>,
  right: ResolvedParagraphState<AnyRasterTechnique>,
): boolean {
  const leftIds = uniqueTechniques(left)
    .map(({ id: techniqueId }) => techniqueId)
    .sort();
  const rightIds = uniqueTechniques(right)
    .map(({ id: techniqueId }) => techniqueId)
    .sort();
  return leftIds.length === rightIds.length && leftIds.every((value, index) => value === rightIds[index]);
}

interface ResolvedConstraints {
  readonly width: ParagraphConstraints['width'];
  readonly height: ParagraphConstraints['height'];
}

function resolveConstraints(constraints: ParagraphConstraints | undefined): ResolvedConstraints {
  const width = constraints?.width;
  const height = constraints?.height;
  validateAxis(width, 'width');
  validateAxis(height, 'height');
  return { width, height };
}

function validateAxis(value: ParagraphConstraints['width'], name: string): void {
  if (value === undefined || value.mode === 'unconstrained') return;
  if (!Number.isFinite(value.size) || value.size < 0) {
    throw new RangeError(`paragraph ${name} constraint must be finite and nonnegative`);
  }
}

function axisKey(constraints: ResolvedConstraints): string {
  const key = (value: ParagraphConstraints['width']): string =>
    value === undefined || value.mode === 'unconstrained' ? 'u' : `${value.mode}:${value.size}`;
  return `${key(constraints.width)}|${key(constraints.height)}`;
}

function flowBox(
  policy: ParagraphLayoutPolicy,
  width: ParagraphConstraints['width'],
  height: ParagraphConstraints['height'],
): ParagraphContentBox {
  return {
    ...policy,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function hasParagraphChange<Technique extends AnyRasterTechnique>(update: ParagraphUpdate<Technique>): boolean {
  return ['font', 'text', 'spans', 'style', 'paint', 'rasterPixelRatio', 'policy'].some((key) =>
    Object.hasOwn(update, key),
  );
}

function frozenDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => frozenDeep(entry))) as Value;
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) copy[key] = frozenDeep(nested);
  return Object.freeze(copy) as Value;
}

function normalizeParagraphState<Technique extends AnyRasterTechnique>(
  properties: ParagraphOptions<Technique>,
  previous?: ResolvedParagraphState<Technique>,
): ResolvedParagraphState<Technique> {
  if (properties === null || typeof properties !== 'object') throw new TypeError('paragraph options must be an object');
  const formatted = typeof properties.text === 'string' ? undefined : (properties.text as FormattedText<Technique>);
  if (formatted !== undefined && properties.spans !== undefined) {
    throw new TypeError('formatted paragraph text owns its spans; do not also pass spans');
  }
  const text = formatted?.text ?? (properties.text as string);
  const stated = formatted?.spans ?? properties.spans ?? [];
  const resolved =
    previous !== undefined && previous.text === text && previous.spans === stated
      ? stated
      : alignSpansToClusters(text, stated);
  const spans =
    resolved === previous?.spans ? previous.spans : Object.freeze(resolved.map((span) => frozenDeep({ ...span })));
  immutableFontSelectionFonts(properties.font);
  for (const span of spans) if (span.font !== undefined) immutableFontSelectionFonts(span.font);
  return Object.freeze({
    font: properties.font,
    text,
    spans,
    style: frozenDeep({ ...(properties.style ?? {}) }),
    paint: frozenDeep({ ...(properties.paint ?? {}) }),
    policy: frozenDeep({ ...(properties.policy ?? {}) }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
  });
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
    return { glyphEngine, backend: glyphEngine.createBackend({ integration: '@pmndrs/glyph/paragraph' }) };
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

function layoutDigest(layout: ParagraphLayoutInspection): string {
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
