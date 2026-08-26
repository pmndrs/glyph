import {
  alignSpansToClusters,
  type FormattedText,
  type GlyphPaintInput,
  type ParagraphSpan,
} from './formatted-text.js';
import {
  acquireFontSelectionForRuntime,
  assertFontSelectionForRuntime,
  concreteFonts,
  observeLoadedFontDispose,
  releaseFontSelection,
} from './loaded-font.js';
import { loadedFontBindingBytes } from './core/font-binding.js';
import {
  TextEngineHost,
  TextEngineStatusError,
  type TextEnginePublication,
  type TextEngineSession,
} from './core/host.js';
import { compileTextEngineFrameUpdate, type TextEngineStyleMutation } from './core/frame-wire.js';
import { readTextEngineLayouts, readTextEngineMeasurements } from './core/layout-query-view.js';
import { definePolicyBuffers } from './core/technique-schema.js';
import {
  id,
  type FontBindingHandle,
  type FontStackHandle,
  type GlyphId,
  type GlyphIdKind,
} from './core/render-policy.js';
import {
  compileRenderPolicy,
  RenderWireIdentityRegistry,
  type PolicyCapabilitySet,
  type PolicyDescriptor,
} from './core/render-policy.js';
import type { RuntimeShaper } from './shaper.js';
import { observeTextRuntimeDispose, textRuntimeShaper } from './text-runtime.js';
import { textShaperAbi } from './generated/text-shaper-abi.js';
import type { FontSelection, LoadedFont } from './loaded-font.js';
import {
  copyParagraphLayoutInspection,
  type ParagraphLayoutInspection,
  type ParagraphLayoutSummary,
  type ParagraphMetrics,
} from './layout.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import type { TextRuntime } from './text-runtime.js';
import type {
  ParagraphContentBox,
  ParagraphContentProperties,
  ParagraphConstraints,
  ParagraphLayoutPolicy,
  ParagraphStyle,
} from './text-properties.js';
import {
  compileEngineGeometry,
  engineLimits,
  engineStyleId,
  engineStyleValue,
  normalizedColumns,
  replacedContent,
  styledSpans,
} from './engine-encoding.js';

const TEXT_CHANGE = 1 << 0;
const STYLE_CHANGE = 1 << 1;
const GEOMETRY_CHANGE = 1 << 2;
const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * One engine paragraph id inside the paragraph's private session. Every `Paragraph`
 * owns a whole session, so the id is constant and no cross-paragraph arbitration exists.
 */
const PARAGRAPH_ID = id('paragraph', 'glyph-paragraph/query');

/**
 * The measurement-only policy registered once per runtime for paragraph sessions.
 * Paragraph sessions answer semantic-view queries and never publish render plans.
 */
const PARAGRAPH_POLICY_HANDLE = id('policy', 'glyph-paragraph/measurement');
const MEASUREMENT_TECHNIQUE = 'pmndrs.paragraph.measurement';
const MEASUREMENT_PROGRAM_NAMESPACE = 'paragraph';
const measurementBuffers = definePolicyBuffers({
  result: { id: id('buffer', 'glyph-paragraph/measurement-result'), scalar: 'f32', lanes: ['value'] },
});
const INLINE_ORIGIN_REGISTER = 0;

/**
 * A query answers, or this package is broken.
 *
 * Measurement and layout are synchronous and take no resource that could be missing: the font is
 * required at construction, the text and spans are validated there, and a constraint that is not
 * finite and nonnegative throws from the call itself. Nothing is left that a caller could get wrong
 * and nothing is left to wait for, so there is no failure to hand back. These used to return a
 * result union, which made every caller write `if (result.ok)` on every probe -- inside a flexbox
 * measure callback, many times per layout -- to guard a branch that only means the engine broke its
 * own invariant. That is a defect to report, not a state to handle, so it throws.
 */

interface ParagraphBaseOptions<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  /** Stable flow policy; varied through {@link Paragraph.update}, never per probe. */
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

/**
 * A framework-neutral retained paragraph: synchronous `layout(constraints)` and
 * `glyphs(constraints)` that need no scene, no renderer, and no committed frame,
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
  readonly #measurements = new Map<string, ParagraphMetrics>();
  readonly #layouts = new Map<string, ParagraphLayoutInspection>();
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
   * successful `glyphs()` produces output whose content differs from the previous positioned output.
   * "Positioned output" is everything a renderer or interaction layer consumes: the box and
   * content extents, both baselines, the overflow flag, glyph/line/missing-glyph counts, every
   * per-glyph record in order (glyph id, cluster, bidi level, font slot, em size, position,
   * advance, ink, and flags), and every per-line record in order (text span, glyph span,
   * baseline, advance, and ink). Stable glyph ids are
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
   * Measures the paragraph at `constraints`, synchronously, with no scene, no renderer, no world
   * matrix, and no committed frame. Every value is paragraph-local: the origin is the box's
   * top-left corner, positive X is right, positive Y is down. Scale and placement are the host's,
   * applied afterwards.
   *
   * This is the paragraph-scoped measurement view: sizes, both baselines, ascent and descent, the
   * intrinsic widths, and the glyph, line, and missing-glyph counts. It runs no positioned query —
   * no publication flip, no per-glyph records, no revision advance — so a flexbox host probing
   * twenty widths pays for none of that.
   *
   * Repeated measurement at equal constraints answers from cache with the identical object;
   * different constraints ride the engine's retained speculative transaction, so only geometry,
   * flow, and positioning re-run over the retained shaping. The positioned columns are a second
   * call: see `glyphs()`.
   *
   * A constraint that is not finite and nonnegative, or an impossible column policy, throws from
   * here — caller arithmetic, reported where it was written.
   */
  layout(constraints?: ParagraphConstraints): ParagraphMetrics {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    const cached = this.#measurements.get(key);
    if (cached !== undefined) return cached;
    const { summary } = this.#query(this.#fullBox(resolved), false);
    this.#measurements.set(key, summary);
    return summary;
  }

  /**
   * The positioned columns for `constraints`: per-glyph ids, positions, advances, ink boxes, and
   * the per-line spans over them.
   *
   * This is a second call because it is a second query, not a second copy. `layout()` asks the
   * engine for the measurement view, which is paragraph-scoped and synchronous: no publication
   * flip, no revision advance, no checkpoint. Asking for the positioned view makes the engine emit
   * a record per glyph and per line and copies those arrays out of Wasm. A flexbox host probing
   * twenty widths wants the first and never the second, so merging them would make every probe pay
   * for arrays it does not read.
   *
   * Skia and Flutter separate these the same way, for the same reason: `getRectsForRange` and
   * `getBoxesForSelection` are on-demand rather than part of laying out.
   *
   * `layoutRevision` advances here, when positioned output actually differs, so a host gates
   * readback on it rather than copying arrays to compare them.
   */
  glyphs(constraints?: ParagraphConstraints): ParagraphLayoutInspection {
    this.#assertActive();
    const resolved = resolveConstraints(constraints);
    const key = axisKey(resolved);
    let inspection = this.#layouts.get(key);
    if (inspection === undefined) {
      inspection = this.#query(this.#fullBox(resolved), true).inspection;
      if (inspection === undefined) throw new Error('paragraph glyph query returned no layout inspection');
      this.#layouts.set(key, inspection);
    }
    const digest = layoutDigest(inspection);
    if (digest !== this.#lastLayoutDigest) {
      this.#lastLayoutDigest = digest;
      this.#layoutRevision += 1;
    }
    return copyParagraphLayoutInspection(inspection);
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
    const geometry = compileEngineGeometry(
      this.#context.host.id,
      PARAGRAPH_ID,
      1,
      this.#geometryRevision + 1,
      box,
      0,
      text.length,
    );
    const limits = engineLimits(1, text.length, text.length, geometry.regions.length, MAX_TEXT_ENGINE_OUTPUT_BYTES);
    const request = compileTextEngineFrameUpdate({
      sessionId: session.handle,
      policyHandle: PARAGRAPH_POLICY_HANDLE,
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
        styleId: engineStyleId(this.#context.host.id, PARAGRAPH_ID, 1),
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
        styleId: engineStyleId(this.#context.host.id, PARAGRAPH_ID, index + 2),
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
      styles.push({
        opcode: 'remove',
        paragraphId: PARAGRAPH_ID,
        styleId: engineStyleId(this.#context.host.id, PARAGRAPH_ID, styleId),
      });
    }
    return styles;
  }

  /**
   * The stack handle addressing `fonts`, retaining one lease per distinct membership for
   * this paragraph's lifetime (retired on font change or disposal).
   */
  #stackFor(fonts: readonly [LoadedFont<AnyRasterTechnique>, ...LoadedFont<AnyRasterTechnique>[]]): FontStackHandle {
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

/** Copies an authored value and freezes the copy, so a caller mutating what they passed cannot change cached shaping input. */
function frozenDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => frozenDeep(entry))) as Value;
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) copy[key] = frozenDeep(nested);
  return Object.freeze(copy) as Value;
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
  const mixArray = (array: Uint8Array | Uint16Array | Uint32Array | Float32Array): void => {
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
  mixNumber(layout.ascent);
  mixNumber(layout.descent);
  mixNumber(layout.lineHeight);
  mixNumber(layout.minContentWidth);
  mixNumber(layout.maxContentWidth);
  mixNumber(layout.overflowed ? 1 : 0);
  mixNumber(layout.glyphCount);
  mixNumber(layout.lineCount);
  mixNumber(layout.missingGlyphCount);
  mixNumber(layout.inkBounds === undefined ? 0 : 1);
  if (layout.inkBounds !== undefined) {
    mixNumber(layout.inkBounds.x);
    mixNumber(layout.inkBounds.y);
    mixNumber(layout.inkBounds.width);
    mixNumber(layout.inkBounds.height);
  }
  mixArray(layout.fontHandles);
  mixArray(layout.glyphIds);
  mixArray(layout.clusters);
  mixArray(layout.glyphBidiLevels);
  mixArray(layout.glyphFontSlots);
  mixArray(layout.glyphFontSizes);
  mixArray(layout.x);
  mixArray(layout.y);
  mixArray(layout.glyphAdvances);
  mixArray(layout.glyphInkX);
  mixArray(layout.glyphInkY);
  mixArray(layout.glyphInkWidths);
  mixArray(layout.glyphInkHeights);
  mixArray(layout.glyphFlags);
  mixArray(layout.lineTextStarts);
  mixArray(layout.lineTextEnds);
  mixArray(layout.lineGlyphStarts);
  mixArray(layout.lineGlyphCounts);
  mixArray(layout.lineBaselines);
  mixArray(layout.lineAdvances);
  for (const line of layout.lines) {
    mixNumber(line.ascent);
    mixNumber(line.descent);
    mixNumber(line.lineHeight);
    mixNumber(line.inkBounds === undefined ? 0 : 1);
    if (line.inkBounds === undefined) continue;
    mixNumber(line.inkBounds.x);
    mixNumber(line.inkBounds.y);
    mixNumber(line.inkBounds.width);
    mixNumber(line.inkBounds.height);
  }
  return lanes.map((lane) => lane.toString(16).padStart(8, '0')).join('');
}

interface ParagraphEngineStackLease {
  readonly handle: FontStackHandle;
  /** Binding-handle membership that names the stack, shared by equal font selections. */
  readonly key: string;
  readonly fonts: readonly LoadedFont<AnyRasterTechnique>[];
  release(): void;
}

interface RetainedParagraphBinding {
  readonly handle: FontBindingHandle;
  stackReferences: number;
  disposalRequested: boolean;
}

interface RetainedParagraphStackBinding {
  readonly font: LoadedFont<AnyRasterTechnique>;
  readonly binding: RetainedParagraphBinding;
}

interface RetainedParagraphStack {
  readonly handle: FontStackHandle;
  readonly bindings: readonly RetainedParagraphStackBinding[];
  references: number;
}

/** Cold registrations shared by every `Paragraph` on one renderer-neutral runtime. */
class ParagraphEngineContext {
  readonly host: TextEngineHost;
  readonly #bindingHandles = new WeakMap<LoadedFont<AnyRasterTechnique>, RetainedParagraphBinding>();
  readonly #fontDisposeObservers = new Map<LoadedFont<AnyRasterTechnique>, () => void>();
  readonly #stacks = new Map<string, RetainedParagraphStack>();
  #nextHandle = 1;
  #disposed = false;

  constructor(shaper: RuntimeShaper) {
    const host = new TextEngineHost(shaper);
    try {
      host.registerPolicy(PARAGRAPH_POLICY_HANDLE, measurementPolicyBytes(host.wireIdentities));
    } catch (error) {
      try {
        host.dispose();
      } catch (disposeError) {
        const failure = new AggregateError(
          [error, disposeError],
          'paragraph engine construction and teardown both failed',
          {
            cause: error,
          },
        );
        throw failure;
      }
      throw error;
    }
    this.host = host;
  }

  createSession(options: { requestCapacity: number; resultCapacity: number }): TextEngineSession {
    this.#assertActive();
    return this.host.createSession({ ...options, handle: this.#allocateHandle('session') });
  }

  /** Ensures every font in the selection has a registered binding, and names the stack by its membership. */
  prepareFontStack(fonts: readonly LoadedFont<AnyRasterTechnique>[]): { readonly key: string } {
    this.#assertActive();
    const key = fonts.map((font) => this.#bindingHandle(font).handle).join(',');
    return { key };
  }

  retainFontStack(key: string, fonts: readonly LoadedFont<AnyRasterTechnique>[]): ParagraphEngineStackLease {
    this.#assertActive();
    const bindings = fonts.map((font) => ({ font, binding: this.#bindingHandle(font) }));
    const bindingHandles = bindings.map(({ binding }) => binding.handle);
    if (bindingHandles.join(',') !== key) throw new TypeError('paragraph font stack key does not match its fonts');
    let retained = this.#stacks.get(key);
    if (retained === undefined) {
      const unique = new Map<LoadedFont<AnyRasterTechnique>, RetainedParagraphStackBinding>();
      for (const entry of bindings) unique.set(entry.font, entry);
      retained = {
        handle: this.#allocateHandle('font-stack'),
        bindings: Object.freeze([...unique.values()]),
        references: 0,
      };
      this.host.registerFontStack(retained.handle, bindingHandles);
      for (const { binding } of retained.bindings) binding.stackReferences += 1;
      this.#stacks.set(key, retained);
    }
    retained.references += 1;
    let released = false;
    return {
      handle: retained.handle,
      key,
      fonts,
      release: () => {
        if (released) return;
        released = true;
        if (this.#disposed) return;
        if (retained.references > 1) {
          retained.references -= 1;
          return;
        }
        let failure: unknown;
        try {
          this.host.disposeFontStack(retained.handle);
        } catch (error) {
          failure = error;
        }
        this.#stacks.delete(key);
        retained.references = 0;
        for (const { font, binding } of retained.bindings) {
          if (binding.stackReferences === 0) {
            failure ??= new Error('paragraph font-binding stack ownership is inconsistent');
            continue;
          }
          binding.stackReferences -= 1;
          if (!binding.disposalRequested || binding.stackReferences !== 0) continue;
          try {
            this.#disposeFontRegistration(font, binding);
          } catch (error) {
            failure ??= error;
          }
        }
        if (failure !== undefined) throw failure;
      },
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    try {
      this.host.dispose();
    } catch (error) {
      failure = error;
    }
    for (const stopObserving of this.#fontDisposeObservers.values()) {
      try {
        stopObserving();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#fontDisposeObservers.clear();
    this.#stacks.clear();
    if (failure !== undefined) throw failure;
  }

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): RetainedParagraphBinding {
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the paragraph engine');
    const handle = this.#allocateHandle('font-binding');
    this.host.registerFontBinding(handle, font.font.handle, loadedFontBindingBytes(font, this.host.wireIdentities));
    const retained = { handle, stackReferences: 0, disposalRequested: false };
    this.#bindingHandles.set(font, retained);
    const stopObserving = observeLoadedFontDispose(font, () => this.#requestFontDisposal(font));
    this.#fontDisposeObservers.set(font, stopObserving);
    return retained;
  }

  #requestFontDisposal(font: LoadedFont<AnyRasterTechnique>): void {
    const binding = this.#bindingHandles.get(font);
    if (binding === undefined) return;
    binding.disposalRequested = true;
    if (binding.stackReferences === 0) this.#disposeFontRegistration(font, binding);
  }

  #disposeFontRegistration(font: LoadedFont<AnyRasterTechnique>, binding: RetainedParagraphBinding): void {
    let failure: unknown;
    try {
      this.host.disposeFontBinding(binding.handle);
    } catch (error) {
      failure = error;
    }
    this.#fontDisposeObservers.get(font)?.();
    this.#fontDisposeObservers.delete(font);
    this.#bindingHandles.delete(font);
    if (failure !== undefined) throw failure;
  }

  #allocateHandle<const Kind extends GlyphIdKind>(kind: Kind): GlyphId<Kind> {
    const ordinal = this.#nextHandle;
    if (ordinal > 0xffff_ffff) throw new RangeError(`paragraph ${kind} handles are exhausted`);
    this.#nextHandle = ordinal + 1;
    return this.host.id(kind, `glyph-paragraph/${ordinal}`);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph engine context is disposed');
  }
}

const contexts = new WeakMap<TextRuntime, ParagraphEngineContext>();

function paragraphEngineContext(runtime: TextRuntime): ParagraphEngineContext {
  let context = contexts.get(runtime);
  if (context === undefined) {
    context = new ParagraphEngineContext(textRuntimeShaper(runtime));
    contexts.set(runtime, context);
    const owned = context;
    observeTextRuntimeDispose(runtime, () => {
      contexts.delete(runtime);
      owned.dispose();
    });
  }
  return context;
}

/**
 * The measurement-only render policy. The engine requires every registered policy to carry at
 * least one structurally valid program even though paragraph sessions never gather or publish
 * a plan, so this ships the smallest legal identity program over one semantic scalar. It is
 * never executed: no paragraph query requests render work.
 */
function measurementPolicyBytes(identities: RenderWireIdentityRegistry): Uint8Array {
  const abi = textShaperAbi;
  const batch = abi.policy.batchFields;
  const MEASUREMENT_TECHNIQUE_ID = identities.techniqueId(MEASUREMENT_TECHNIQUE);
  const MEASUREMENT_PROGRAM_ID = identities.programId(MEASUREMENT_TECHNIQUE, MEASUREMENT_PROGRAM_NAMESPACE);
  const program = {
    techniqueId: MEASUREMENT_TECHNIQUE_ID,
    programId: MEASUREMENT_PROGRAM_ID,
    f32InputCount: 1,
    u32InputCount: 0,
    inputs: [{ scope: 'semantic' as const, field: abi.engine.semanticF32Fields.inlineOrigin }],
    buffers: [{ id: measurementBuffers.result.id, scalar: abi.policy.scalarTypes.f32, vectorWidth: 1 }],
    operations: [
      { opcode: abi.policy.opcodes.loadF32, target: INLINE_ORIGIN_REGISTER, operand0: 0 },
      {
        opcode: abi.policy.opcodes.storeF32,
        operand0: INLINE_ORIGIN_REGISTER,
        immediate0: measurementBuffers.result.id,
      },
    ],
    storageKeyMask: batch.technique | batch.program | batch.resource,
    drawKeyMask: batch.technique | batch.program | batch.resource | batch.order | batch.transform,
  };
  const flags = abi.policy.capabilityFlags;
  const capabilitySet: PolicyCapabilitySet = {
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
