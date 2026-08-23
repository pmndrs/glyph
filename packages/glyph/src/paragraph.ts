import {
  alignSpansToClusters,
  type FormattedText,
  type GlyphPaintInput,
  type ParagraphSpan,
  type TextInput,
} from './formatted-text.js';
import {
  acquireFontSelectionForRuntime,
  assertFontSelectionForRuntime,
  compileRenderPolicy,
  compileTextEngineFrameUpdate,
  concreteFonts,
  loadedFontBindingBytes,
  readTextEngineLayouts,
  readTextEngineMeasurements,
  releaseFontSelection,
  textRuntimeShaper,
  textShaperAbi,
  TextEngineHost,
  TextEngineStatusError,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
  type RuntimeShaper,
  type TextEnginePublication,
  type TextEngineSession,
  type TextEngineStyleMutation,
} from './core.js';
import type { FontSelection, LoadedFont } from './loaded-font.js';
import type { ParagraphLayoutInspection, ParagraphLayoutSummary, ParagraphMetrics } from './layout.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import type { TextRuntime } from './text-runtime.js';
import type {
  ParagraphContentBox,
  ParagraphConstraints,
  ParagraphLayoutPolicy,
  ParagraphStyle,
} from './text-properties.js';
import {
  compileEngineGeometry,
  engineLimits,
  engineStyleValue,
  normalizedColumns,
  replacedContent,
  styledSpans,
} from './internal/engine-encoding.js';

const TEXT_CHANGE = 1 << 0;
const STYLE_CHANGE = 1 << 1;
const GEOMETRY_CHANGE = 1 << 2;
const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * One engine paragraph id inside the paragraph's private session. Every `Paragraph`
 * owns a whole session, so the id is constant and no cross-paragraph arbitration exists.
 */
const PARAGRAPH_ID = 1;

/**
 * The measurement-only policy registered once per runtime for paragraph sessions.
 *
 * Paragraph sessions answer synchronous semantic-view queries only; they never gather
 * or publish render plans, so the policy carries one capability set and the smallest
 * legal placeholder program. The handle lives in the high u32 range so it can never
 * collide with renderer-owned policies (the Three coordinator grows its handles up from
 * 1 on the shared Wasm instance), and every paragraph-owned handle allocates from the
 * same reserved range.
 */
const PARAGRAPH_POLICY_HANDLE = 0x8000_0001;
/** First handle (font bindings, stacks, sessions) owned by the paragraph engine context. */
const PARAGRAPH_HANDLE_BASE = 0x8000_0000;

/**
 * Why a query failed, returned by `measure()` and `layout()` instead of surfacing out of band.
 *
 * `status` is the raw text-engine status number (`textShaperAbi.status`) and `message` the
 * human-readable form. Boundary violations -- a negative constraint size, an impossible column
 * policy -- are caller arithmetic errors and throw synchronously instead; this record is
 * reserved for the engine rejecting otherwise legal input.
 */
export interface ParagraphQueryError {
  readonly operation: 'measure' | 'layout';
  readonly status: number;
  readonly message: string;
}

export type ParagraphMeasureResult =
  | { readonly ok: true; readonly metrics: ParagraphMetrics }
  | { readonly ok: false; readonly error: ParagraphQueryError };

export type ParagraphLayoutResult =
  | { readonly ok: true; readonly layout: ParagraphLayoutInspection; readonly layoutRevision: number }
  | { readonly ok: false; readonly error: ParagraphQueryError };

export interface ParagraphOptions<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly text: TextInput<Technique>;
  readonly spans?: readonly ParagraphSpan<Technique>[];
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  /** Stable flow policy; varied through {@link Paragraph.update}, never per probe. */
  readonly policy?: ParagraphLayoutPolicy;
}

export type ParagraphUpdate<Technique extends AnyRasterTechnique> = Partial<ParagraphOptions<Technique>>;

interface ResolvedParagraphState<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
  readonly style: ParagraphStyle;
  readonly paint: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly policy: ParagraphLayoutPolicy;
}

/**
 * A framework-neutral retained paragraph: synchronous `measure(constraints)` and
 * `layout(constraints)` that need no scene, no renderer, and no committed frame,
 * and that leave authored state untouched.
 *
 * Each paragraph owns one engine session on its runtime's Wasm shaper and answers every
 * query through the paragraph-scoped synchronous measure call -- no publication flip, no
 * revision burn, no renderer fence, and no allocation of positioned arrays on measure.
 * Authored properties change only through `update()`; probing any number of candidate
 * constraints never mutates them, which is what makes the object safe to drive from inside
 * a layout host's own layout pass. Queries are synchronous and never call back into the
 * host, so they cannot re-enter; returned measurements and layouts own their memory (the
 * readers copy out of borrowed Wasm publication bytes).
 */
export class Paragraph<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  #desired: ResolvedParagraphState<Technique>;
  #leasedFonts: readonly LoadedFont<Technique>[];
  readonly #context: ParagraphEngineContext;
  #session: TextEngineSession | undefined;
  /** Live font-stack leases keyed by the stack's binding-handle membership. */
  readonly #stackLeases = new Map<string, ParagraphEngineStackLease>();
  /**
   * Stacks replaced by a font change but still referenced by the engine's retained styles.
   * Each retires (releases) right after the next successful query reapplies styles.
   */
  readonly #retiredStackLeases: ParagraphEngineStackLease[] = [];
  #styleCount = 0;
  #geometryRevision = 0;
  #engineRevision = 0;
  #planRevision = 0;
  #acknowledgedGeneration = 0;
  readonly #measurements = new Map<string, ParagraphMeasureResult>();
  readonly #layouts = new Map<string, ParagraphLayoutResult>();
  #lastLayoutDigest: string | undefined;
  #layoutRevision = 0;
  #disposed = false;

  constructor(properties: ParagraphOptions<Technique>) {
    if (properties === undefined) throw new TypeError('Paragraph properties are required');
    const primary = concreteFonts(properties.font)[0];
    if (primary === undefined) throw new TypeError('paragraph font selection must contain at least one font');
    const runtime = primary.runtime;
    assertFontSelectionForRuntime(properties.font, runtime);
    this.#context = paragraphEngineContext(runtime);
    this.#desired = normalizeParagraphState(properties);
    this.#leasedFonts = selectedFonts(this.#desired);
    acquireFonts(this.#leasedFonts, runtime);
    // Column range invariants fail here, at construction, exactly as the Three.js Text fails
    // them at set(); the width-exactness rule stays a per-query concern because it depends on
    // the constraint being probed.
    normalizedColumns(this.#fullBox({ width: undefined, height: undefined }));
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
  /**
   * Monotonic paragraph-scoped revision of the positioned output.
   *
   * It starts at 0 (no positioned output yet) and advances by exactly one each time a
   * successful `layout()` produces output whose content differs from the previous layout's.
   * "Positioned output" is everything a renderer or interaction layer consumes: the box and
   * content extents, both baselines, the overflow flag, glyph/line/missing-glyph counts, every
   * per-glyph record in order (glyph id, cluster, font slot, em size, x, y, flags), and every
   * per-line record in order (text span, glyph span, baseline, advance). Stable glyph ids are
   * deliberately excluded: identity bookkeeping that changes without a geometric change must
   * not force a host to read back. Equality is decided by a 96-bit digest of that content, so
   * a missed advance requires a hash collision, and equal output never advances the revision.
   */
  get layoutRevision(): number {
    return this.#layoutRevision;
  }
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Synchronously measures the paragraph at `constraints`, without materializing per-glyph
   * arrays and without touching authored state.
   *
   * Returns `{ ok: true, metrics }`, where `metrics` carries the constrained measurement plus
   * intrinsic `minContentWidth`/`maxContentWidth`; the intrinsics are content-only and ride
   * the same measurement pass. Repeated measurement at the same constraints answers from a
   * cached result with no engine call; different constraints ride the engine's retained
   * speculative transaction, so only geometry, flow, and positioning re-run over the retained
   * shaping. Equal inputs answer with the identical cached object.
   *
   * Engine rejection resolves as `{ ok: false, error }`. Boundary violations -- nonfinite or
   * negative sizes, an impossible column policy -- throw synchronously instead: they are caller
   * arithmetic errors, not measurement outcomes.
   */
  measure(constraints?: ParagraphConstraints): ParagraphMeasureResult {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    const cached = this.#measurements.get(key);
    if (cached !== undefined) return cached;
    try {
      // Intrinsic widths ride the same measurement record: the engine derives them from
      // one cluster-arena scan mirroring the breaker's wrap decisions, so a host never
      // pays a second query at zero width.
      const { summary } = this.#query(this.#fullBox(resolved), false);
      const result: ParagraphMeasureResult = Object.freeze({ ok: true, metrics: summary });
      this.#measurements.set(key, result);
      return result;
    } catch (error) {
      return { ok: false, error: queryFailure('measure', error) };
    }
  }

  /**
   * Produces the final positioned glyph arrays for `constraints`.
   *
   * Like {@link Paragraph.measure}, this is synchronous, scene-free, and leaves authored state
   * untouched; it additionally materializes the per-line and per-glyph arrays out of Wasm. The
   * returned `layoutRevision` advances exactly when the positioned output differs from the
   * previous layout's (see the property's contract), so a layout host can gate array readback
   * on `paragraph.layoutRevision !== lastSeenRevision` instead of copying arrays to compare them.
   */
  layout(constraints?: ParagraphConstraints): ParagraphLayoutResult {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    const cached = this.#layouts.get(key);
    if (cached !== undefined) return cached;
    try {
      const query = this.#query(this.#fullBox(resolved), true);
      const inspection = query.inspection;
      if (inspection === undefined) throw new Error('paragraph layout query returned no layout inspection');
      const digest = layoutDigest(inspection);
      if (digest !== this.#lastLayoutDigest) {
        this.#lastLayoutDigest = digest;
        this.#layoutRevision += 1;
      }
      const result: ParagraphLayoutResult = Object.freeze({
        ok: true,
        layout: inspection,
        layoutRevision: this.#layoutRevision,
      });
      this.#layouts.set(key, result);
      return result;
    } catch (error) {
      return { ok: false, error: queryFailure('layout', error) };
    }
  }

  /**
   * Re-states authored properties. Unchanged properties cost nothing; any accepted change
   * invalidates cached measurements, layouts, and intrinsics, and the next query observes it.
   * Replacement text carries its own formatting: a literal clears the spans it replaced unless
   * new ones arrive. The next query carries the new content as one whole-buffer replace, which
   * the engine rebuilds from without retaining stale shaping.
   */
  update(update: ParagraphUpdate<Technique>): void {
    this.#assertActive();
    const normalizedUpdate = replacedContent(update);
    const changes = classifyChanges(normalizedUpdate);
    if (changes === 0) return;
    const next = normalizeParagraphState({ ...this.#desired, ...normalizedUpdate } as ParagraphOptions<Technique>);
    const runtime = concreteFonts(next.font)[0]!.runtime;
    assertFontSelectionForRuntime(next.font, runtime);
    const fonts = selectedFonts(next);
    acquireFonts(fonts, runtime);
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = fonts;
    if (this.#stacksDifferFrom(fonts)) {
      for (const lease of this.#stackLeases.values()) this.#retiredStackLeases.push(lease);
      this.#stackLeases.clear();
    }
    this.#desired = next;
    this.#measurements.clear();
    this.#layouts.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#session?.dispose();
    this.#session = undefined;
    for (const lease of this.#stackLeases.values()) lease.release();
    this.#stackLeases.clear();
    for (const lease of this.#retiredStackLeases.splice(0)) lease.release();
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = [];
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph has been disposed');
  }

  /** Whether the stacks currently retained address a different font set than `fonts`. */
  #stacksDifferFrom(fonts: readonly LoadedFont<Technique>[]): boolean {
    const previous = [...this.#stackLeases.values()].flatMap((lease) => lease.fonts);
    if (previous.length !== fonts.length) return true;
    const members = new Set<LoadedFont<AnyRasterTechnique>>(previous);
    return fonts.some((font) => !members.has(font as LoadedFont<AnyRasterTechnique>));
  }

  /**
   * Answers one query through the paragraph-scoped synchronous engine measure.
   *
   * Every request carries the same full semantic batch -- one whole-buffer text replace,
   * the compiled styles, and the probed geometry -- so the engine's input fingerprints
   * match across consecutive queries and it retains one speculative transaction: repeated
   * measurement at different constraints re-runs only geometry, flow, and positioning over
   * the retained shaping, without reshaping. When authored content actually changed, the
   * fingerprint mismatch makes the engine rebuild from the replaced batch instead. The
   * committed session state stays empty forever (queries never publish), so the
   * replace-at-zero batch is exactly an initial insert whenever a rebuild happens.
   *
   * The measurement summary is always returned; the positioned inspection accompanies it
   * when `inspection` is requested.
   */
  #query(
    box: ParagraphContentBox,
    inspection: boolean,
  ): { readonly summary: ParagraphLayoutSummary; readonly inspection?: ParagraphLayoutInspection } {
    const session = this.#ensureSession();
    const text = this.#desired.text;
    const styleMutations = this.#compileStyles();
    const geometry = compileEngineGeometry(PARAGRAPH_ID, this.#geometryRevision + 1, box, 0, text.length);
    const limits = engineLimits(1, text.length, text.length, geometry.regions.length, MAX_TEXT_ENGINE_OUTPUT_BYTES);
    const request = compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: PARAGRAPH_POLICY_HANDLE,
      capabilitySet: 1,
      expectedEngineRevision: this.#engineRevision,
      consumedPlanRevision: this.#planRevision,
      acknowledgedPublicationGeneration: this.#acknowledgedGeneration,
      semanticViewMask: inspection
        ? textShaperAbi.engine.semanticViewMasks.layoutInspection
        : textShaperAbi.engine.semanticViewMasks.measurement,
      limits,
      paragraphMutations: [{ opcode: 'upsert', paragraphId: PARAGRAPH_ID, order: 0 }],
      textMutations: [{ paragraphId: PARAGRAPH_ID, start: 0, deleteCount: 0, insert: text }],
      styleMutations,
      constraints: [geometry.constraint],
      regions: geometry.regions,
    });
    let publication: TextEnginePublication;
    try {
      publication = session.measureParagraph(request, PARAGRAPH_ID);
    } catch (error) {
      if (error instanceof TextEngineStatusError) throw error;
      throw error;
    }
    this.#engineRevision = publication.engineRevision;
    this.#planRevision = publication.planRevision;
    this.#acknowledgedGeneration = publication.publicationGeneration;
    let summary: ParagraphLayoutSummary;
    let positioned: ParagraphLayoutInspection | undefined;
    if (inspection) {
      const layout = readTextEngineLayouts(publication).get(PARAGRAPH_ID);
      if (layout === undefined) throw new Error('paragraph layout query returned no layout inspection');
      summary = layout;
      positioned = layout;
    } else {
      const measured = readTextEngineMeasurements(publication).get(PARAGRAPH_ID);
      if (measured === undefined) throw new Error('paragraph measure query returned no measurement');
      summary = measured;
    }
    // The request applied the current style list; stacks retired by earlier font changes
    // can no longer be referenced by the engine's retained styles.
    this.#styleCount = 1 + styledSpans(this.#desired.spans).length;
    for (const lease of this.#retiredStackLeases.splice(0)) lease.release();
    this.#geometryRevision += 1;
    return positioned === undefined ? { summary } : { summary, inspection: positioned };
  }

  #compileStyles(): readonly TextEngineStyleMutation[] {
    const text = this.#desired.text;
    const styles: TextEngineStyleMutation[] = [
      {
        opcode: 'upsert',
        paragraphId: PARAGRAPH_ID,
        styleId: 1,
        cascadeOrder: 0,
        start: 0,
        end: text.length,
        root: true,
        value: engineStyleValue(this.#desired.style, this.#desired.paint, 0, text.length, {
          fontStackHandle: this.#stackFor(concreteFonts(this.#desired.font)),
          fontSize: this.#desired.style.fontSize ?? 16,
          rasterPixelRatio: this.#desired.rasterPixelRatio ?? 1,
        }),
      },
    ];
    for (const [index, span] of styledSpans(this.#desired.spans).entries()) {
      styles.push({
        opcode: 'upsert',
        paragraphId: PARAGRAPH_ID,
        styleId: index + 2,
        cascadeOrder: index + 1,
        start: span.start,
        end: span.end,
        value: engineStyleValue(span.style ?? {}, span.paint, span.start, span.end, {
          // An unstated span font inherits the cascading root stack, exactly as the Three
          // batch compiles it; a stated one addresses its own stack.
          ...(span.font === undefined ? {} : { fontStackHandle: this.#stackFor(concreteFonts(span.font)) }),
        }),
      });
    }
    for (let styleId = styles.length + 1; styleId <= this.#styleCount; styleId += 1) {
      styles.push({ opcode: 'remove', paragraphId: PARAGRAPH_ID, styleId });
    }
    return styles;
  }

  /**
   * The stack handle addressing `fonts`, retaining one lease per distinct membership for
   * this paragraph's lifetime (retired on font change or disposal).
   */
  #stackFor(fonts: readonly [LoadedFont<AnyRasterTechnique>, ...LoadedFont<AnyRasterTechnique>[]]): number {
    const prepared = this.#context.prepareFontStack(fonts);
    let lease = this.#stackLeases.get(prepared.key);
    if (lease === undefined) {
      lease = this.#context.retainFontStack(prepared.key, fonts);
      this.#stackLeases.set(prepared.key, lease);
    }
    return lease.handle;
  }

  #ensureSession(): TextEngineSession {
    if (this.#session !== undefined) return this.#session;
    const session = this.#context.createSession({ requestCapacity: 64 * 1024, resultCapacity: 256 * 1024 });
    this.#session = session;
    return session;
  }

  #fullBox(constraints: ResolvedConstraints): ParagraphContentBox {
    return flowBox(this.#desired.policy, constraints.width, constraints.height);
  }
}

/** Merges stable policy with per-call axes without materializing explicit `undefined` properties. */
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

function queryFailure(operation: 'measure' | 'layout', error: unknown): ParagraphQueryError {
  if (!(error instanceof TextEngineStatusError)) throw error;
  return Object.freeze({ operation, status: error.status, message: error.message });
}

function classifyChanges<Technique extends AnyRasterTechnique>(update: ParagraphUpdate<Technique>): number {
  let changes = 0;
  if (Object.hasOwn(update, 'text')) changes |= TEXT_CHANGE | STYLE_CHANGE | GEOMETRY_CHANGE;
  if (
    Object.hasOwn(update, 'font') ||
    Object.hasOwn(update, 'spans') ||
    Object.hasOwn(update, 'style') ||
    Object.hasOwn(update, 'paint') ||
    Object.hasOwn(update, 'rasterPixelRatio')
  ) {
    changes |= STYLE_CHANGE;
  }
  if (Object.hasOwn(update, 'policy')) changes |= GEOMETRY_CHANGE;
  return changes;
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

/**
 * Cluster resolution runs whenever text or stated spans change identity, and each retained
 * span is frozen so the identity short-circuit against `previous.spans` cannot be undermined
 * by a mutated record. Mirrors the Three.js Text's desired-state normalization exactly.
 */
function normalizeParagraphState<Technique extends AnyRasterTechnique>(
  properties: ParagraphOptions<Technique>,
  previous?: ResolvedParagraphState<Technique>,
): ResolvedParagraphState<Technique> {
  const formatted = typeof properties.text === 'string' ? undefined : (properties.text as FormattedText<Technique>);
  const text = formatted?.text ?? (properties.text as string);
  const stated = formatted?.spans ?? properties.spans ?? [];
  const resolved =
    previous !== undefined && previous.text === text && previous.spans === stated
      ? stated
      : alignSpansToClusters(text, stated);
  const spans =
    resolved === previous?.spans ? previous.spans : Object.freeze(resolved.map((span) => Object.freeze({ ...span })));
  return Object.freeze({
    font: properties.font,
    text,
    spans,
    style: Object.freeze({ ...(properties.style ?? {}) }),
    paint: Object.freeze({ ...(properties.paint ?? {}) }),
    policy: Object.freeze({ ...(properties.policy ?? {}) }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
  });
}

function selectedFonts<Technique extends AnyRasterTechnique>(
  state: ResolvedParagraphState<Technique>,
): readonly LoadedFont<Technique>[] {
  const fonts = new Set<LoadedFont<Technique>>(concreteFonts(state.font));
  for (const span of state.spans)
    if (span.font !== undefined) for (const font of concreteFonts(span.font)) fonts.add(font);
  return [...fonts];
}

function acquireFonts<Technique extends AnyRasterTechnique>(
  fonts: readonly LoadedFont<Technique>[],
  runtime: TextRuntime,
): void {
  const acquired: LoadedFont<Technique>[] = [];
  try {
    for (const font of fonts) {
      acquireFontSelectionForRuntime(font, runtime);
      acquired.push(font);
    }
  } catch (error) {
    releaseFonts(acquired);
    throw error;
  }
}

function releaseFonts<Technique extends AnyRasterTechnique>(fonts: readonly LoadedFont<Technique>[]): void {
  for (const font of fonts) releaseFontSelection(font);
}

/** Font-stack membership by loaded-font identity, ignoring order. */
function sameFonts(
  previous: readonly LoadedFont<AnyRasterTechnique>[],
  next: readonly LoadedFont<AnyRasterTechnique>[],
): boolean {
  if (previous.length !== next.length) return false;
  const members = new Set(previous);
  return next.every((font) => members.has(font));
}

/**
 * A 96-bit digest of exactly the positioned output the layout-revision contract names:
 * scalar extents and flags plus the ordered per-glyph and per-line records, with stable
 * glyph ids deliberately excluded (identity churn without geometric change must not force
 * readback). Three independent FNV-1a lanes keep collision odds far below any realistic
 * layout population while costing one linear pass and no allocation beyond the digest.
 */
function layoutDigest(layout: ParagraphLayoutInspection): string {
  const lanes = [0x811c_9dc5, 0x0100_0193, 0x9dc5_811c];
  const mixByte = (byte: number): void => {
    for (const [index, seed] of lanes.entries()) {
      lanes[index] = Math.imul(seed ^ byte, 0x0100_0193 + index * 0x9e37_79b9) >>> 0;
    }
  };
  const mixArray = (array: Uint16Array | Uint32Array | Float32Array): void => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let index = 0; index < bytes.length; index += 1) mixByte(bytes[index]!);
  };
  const mixNumber = (value: number): void => {
    mixArray(Float32Array.of(value));
  };
  mixNumber(layout.width);
  mixNumber(layout.height);
  mixNumber(layout.contentWidth);
  mixNumber(layout.contentHeight);
  mixNumber(layout.firstBaseline);
  mixNumber(layout.lastBaseline);
  mixNumber(layout.overflowed ? 1 : 0);
  mixNumber(layout.glyphCount);
  mixNumber(layout.lineCount);
  mixNumber(layout.missingGlyphCount);
  mixArray(layout.glyphIds);
  mixArray(layout.clusters);
  mixArray(layout.glyphFontSlots);
  mixArray(layout.glyphFontSizes);
  mixArray(layout.x);
  mixArray(layout.y);
  mixArray(layout.glyphFlags);
  mixArray(layout.lineTextStarts);
  mixArray(layout.lineTextEnds);
  mixArray(layout.lineGlyphStarts);
  mixArray(layout.lineGlyphCounts);
  mixArray(layout.lineBaselines);
  mixArray(layout.lineAdvances);
  return lanes.map((lane) => lane.toString(16).padStart(8, '0')).join('');
}

interface ParagraphEngineStackLease {
  readonly handle: number;
  /** Binding-handle membership that names the stack, shared by equal font selections. */
  readonly key: string;
  readonly fonts: readonly LoadedFont<AnyRasterTechnique>[];
  release(): void;
}

/** Cold registrations shared by every `Paragraph` on one renderer-neutral runtime. */
class ParagraphEngineContext {
  readonly host: TextEngineHost;
  readonly #bindingHandles = new WeakMap<LoadedFont<AnyRasterTechnique>, number>();
  readonly #stacks = new Map<string, { lease: ParagraphEngineStackLease }>();
  #nextHandle = PARAGRAPH_HANDLE_BASE;

  constructor(shaper: RuntimeShaper) {
    this.host = new TextEngineHost(shaper);
    this.host.registerPolicy(PARAGRAPH_POLICY_HANDLE, measurementPolicyBytes());
  }

  createSession(options: { requestCapacity: number; resultCapacity: number }): TextEngineSession {
    return this.host.createSession({ ...options, handle: this.#allocateHandle('paragraph session') });
  }

  /** Ensures every font in the selection has a registered binding, and names the stack by its membership. */
  prepareFontStack(fonts: readonly LoadedFont<AnyRasterTechnique>[]): { readonly key: string } {
    const key = fonts.map((font) => this.#bindingHandle(font)).join(',');
    return { key };
  }

  retainFontStack(key: string, fonts: readonly LoadedFont<AnyRasterTechnique>[]): ParagraphEngineStackLease {
    let retained = this.#stacks.get(key);
    if (retained === undefined) {
      const handle = this.#allocateHandle('paragraph font stack');
      this.host.registerFontStack(handle, [...key.split(',').map((value) => Number.parseInt(value, 10))]);
      let released = false;
      const lease: ParagraphEngineStackLease = {
        handle,
        key,
        fonts,
        release: () => {
          if (released) return;
          released = true;
          const entry = this.#stacks.get(key);
          if (entry === undefined || entry.lease !== lease) return;
          this.#stacks.delete(key);
          this.host.disposeFontStack(handle);
        },
      };
      retained = { lease };
      this.#stacks.set(key, retained);
    }
    return retained.lease;
  }

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): number {
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the paragraph engine');
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    const handle = this.#allocateHandle('paragraph font binding');
    this.host.registerFontBinding(handle, font.font.handle, loadedFontBindingBytes(font, this.host.wireIdentities));
    this.#bindingHandles.set(font, handle);
    return handle;
  }

  #allocateHandle(label: string): number {
    const handle = this.#nextHandle;
    if (handle > 0xffff_ffff) throw new RangeError(`${label} handles are exhausted`);
    this.#nextHandle = handle + 1;
    return handle;
  }
}

const contexts = new WeakMap<TextRuntime, ParagraphEngineContext>();

function paragraphEngineContext(runtime: TextRuntime): ParagraphEngineContext {
  let context = contexts.get(runtime);
  if (context === undefined) {
    context = new ParagraphEngineContext(textRuntimeShaper(runtime));
    contexts.set(runtime, context);
  }
  return context;
}

/**
 * The measurement-only render policy. The engine requires every registered policy to carry at
 * least one structurally valid program even though paragraph sessions never gather or publish
 * a plan, so this ships the smallest legal identity program over one semantic scalar. It is
 * never executed: no paragraph query requests render work.
 */
function measurementPolicyBytes(): Uint8Array {
  const abi = textShaperAbi;
  const batch = abi.policy.batchFields;
  const program = {
    techniqueId: 1,
    programId: 1,
    f32InputCount: 1,
    u32InputCount: 0,
    inputs: [{ scope: 'semantic' as const, field: abi.engine.semanticF32Fields.inlineOrigin }],
    buffers: [{ id: 1, scalar: abi.policy.scalarTypes.f32, vectorWidth: 1 }],
    operations: [
      { opcode: abi.policy.opcodes.loadF32, target: 0, operand0: 0 },
      { opcode: abi.policy.opcodes.storeF32, operand0: 0, immediate0: 1 },
    ],
    storageKeyMask: batch.technique | batch.program | batch.resource,
    drawKeyMask: batch.technique | batch.program | batch.resource | batch.order | batch.transform,
  };
  const flags = abi.policy.capabilityFlags;
  const capabilitySet: PolicyCapabilitySet = {
    id: 1,
    flags: flags.storageBuffers | flags.aliasVec2 | flags.aliasVec4 | flags.orderedDirect | flags.stableIndirect,
    maxBufferBytes: 64 * 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw: 16,
    maxResourcesPerDraw: 16,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7_500,
  };
  const descriptor: PolicyDescriptor = { capabilitySets: [capabilitySet], programs: [program] };
  return compileRenderPolicy(descriptor);
}
