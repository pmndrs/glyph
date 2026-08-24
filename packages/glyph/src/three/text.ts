import * as THREE from 'three/webgpu';

import {
  alignSpansToClusters,
  type FormattedText,
  type GlyphPaintInput,
  type ParagraphSpan,
  type TextInput,
} from '../formatted-text.js';
import {
  acquireFontSelectionForRuntime,
  assertFontSelectionForRuntime,
  concreteFonts,
  releaseFontSelection,
} from '../core.js';
import type { FontSelection, LoadedFont } from '../loaded-font.js';
import type {
  GlyphBufferCapacity,
  ParagraphBaseProperties,
  ParagraphContentBox,
  ParagraphStyle,
} from '../text-properties.js';
import type { FontFeature } from '../font-feature.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import {
  compileTextEngineFrameUpdate,
  readTextEngineLayouts,
  readTextEngineMeasurements,
  TextEngineRenderPlanView,
  TextEngineStatusError,
  textShaperAbi,
  type TextEngineConstraint,
  type TextEngineFault,
  type TextEnginePublication,
  type TextEngineRegion,
  type TextEngineSession,
  type TextEngineStyleMutation,
  type TextEngineTextMutation,
} from '../core.js';
import type { LayoutBox, ParagraphLayoutInspection, ParagraphLayoutSummary } from '../layout.js';
import {
  createGlyphPlacements,
  type GlyphApplication,
  type GlyphCaret,
  type GlyphPlacements,
} from '../glyph-placement.js';
import {
  compileEngineGeometry,
  engineLimits,
  engineStyleValue,
  minimalTextMutation,
  normalizedColumns,
  replacedContent,
  styledSpans,
} from '../engine-encoding.js';
import { textFrameError, type TextFrameSubject } from './frame-error.js';
import { ThreeTextRenderPlanExecutor } from './engine-plan-target.js';
import {
  threeTextEngineCoordinator,
  type ThreeTextMaterialLease,
  type ThreeTextEngineCoordinator,
  type ThreeTextEngineStackLease,
} from './engine-runtime.js';
import type { ThreeTextMaterial } from './material.js';

// The scoped import lint denies `/three` any reach into `internal/`, so the guard is written here as
// the same ecosystem-standard comparison a bundler strips in a production build.
const DEV = process.env.NODE_ENV !== 'production';
const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;
const TEXT_CHANGE = 1 << 0;
const STYLE_CHANGE = 1 << 1;
const GEOMETRY_CHANGE = 1 << 2;
const ALL_SEMANTIC_CHANGES = TEXT_CHANGE | STYLE_CHANGE | GEOMETRY_CHANGE;

export type TextSpan<Technique extends AnyRasterTechnique> = ParagraphSpan<Technique> &
  Readonly<{ material?: ThreeTextMaterial }>;

type TextBaseProperties<Technique extends AnyRasterTechnique> = ParagraphBaseProperties<Technique>;

type TextContentProperties<Technique extends AnyRasterTechnique> =
  | Readonly<{ text: string; spans?: readonly TextSpan<Technique>[] }>
  | Readonly<{ text: FormattedText<Technique>; spans?: never }>;

export type TextProperties<Technique extends AnyRasterTechnique> = TextBaseProperties<Technique> &
  TextContentProperties<Technique> &
  Readonly<{ material?: ThreeTextMaterial }>;

export type StandaloneTextProperties<Technique extends AnyRasterTechnique> = TextProperties<Technique> &
  Readonly<{ capacity?: GlyphBufferCapacity; pixelSnapping?: boolean }>;

export type TextUpdate<Technique extends AnyRasterTechnique> =
  | (Partial<TextBaseProperties<Technique>> &
      Readonly<{ text?: string; spans?: readonly TextSpan<Technique>[]; material?: ThreeTextMaterial }>)
  | (Partial<TextBaseProperties<Technique>> &
      Readonly<{ text: FormattedText<Technique>; spans?: never; material?: ThreeTextMaterial }>);

export interface TextGroupOptions {
  readonly capacity?: GlyphBufferCapacity;
  /** Allows Rust to reorder compatible draws when descendants do not require compositing order. */
  readonly compositing?: 'ordered' | 'independent';
  readonly renderOrder?: number;
  readonly material?: ThreeTextMaterial;
  /** Snap Bitmap vertices to physical pixels. Off by default because snapping quantizes animated transforms. */
  readonly pixelSnapping?: boolean;
}

/**
 * What the paragraph has published, as a value rather than as the absence of an error.
 *
 * `'unbound'` and `'pending'` are distinguished because they need different responses: an unbound
 * paragraph is not in the scene graph and never will commit on its own, while a pending one commits
 * on the next world-matrix update. The previous surface collapsed both into `undefined` from
 * `layout()`, and the only positive signal available was that `.error` was still unset.
 */
export type TextCommitState =
  | Readonly<{ status: 'unbound' }>
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'committed'; revision: number }>
  | Readonly<{ status: 'failed'; error: unknown }>;

interface DesiredTextState<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly TextSpan<Technique>[];
  readonly contentBox: ParagraphContentBox;
  readonly style: ParagraphStyle;
  readonly paint: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly material?: ThreeTextMaterial;
}

type PendingTextMutation = Readonly<{
  start: number;
  deleteCount: number;
  insert: string;
}>;

/**
 * The reconciler protocol a batch binding drives a `Text` through.
 *
 * It hands out the pending mutation queue and clears it, so whoever holds it decides
 * what the engine's text buffer becomes: one `markApplied` from outside publishes a
 * paragraph whose buffer no longer matches the engine's. It is therefore module-private
 * rather than public `Text` methods. `Text` grants the accessor from inside its own class
 * body, the only scope its `#` state is reachable from, so nothing reaches the emitted
 * declarations and no consumer can name or call it.
 */
interface TextReconciler {
  runtime(text: Text<AnyRasterTechnique>): TextRuntime;
  properties<Technique extends AnyRasterTechnique>(text: Text<Technique>): TextProperties<Technique>;
  needsApply(text: Text<AnyRasterTechnique>): boolean;
  semanticChanges(text: Text<AnyRasterTechnique>): number;
  textMutations(text: Text<AnyRasterTechnique>): readonly PendingTextMutation[];
  markApplied(text: Text<AnyRasterTechnique>): void;
  bind(text: Text<AnyRasterTechnique>, binding: ThreeTextBatchBinding, group: TextGroup | undefined): void;
  unbindFrom(text: Text<AnyRasterTechnique>, binding: ThreeTextBatchBinding): void;
}

let reconciler!: TextReconciler;

export class Text<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  static {
    reconciler = {
      runtime: (text) => text.#runtime,
      properties: (text) => text.#coreProperties(),
      needsApply: (text) => text.#desiredRevision !== text.#appliedRevision,
      semanticChanges: (text) => text.#semanticChanges,
      textMutations: (text) => text.#textMutations,
      markApplied: (text) => text.#markApplied(),
      bind: (text, binding, group) => text.#bind(binding, group),
      unbindFrom: (text, binding) => text.#unbindFrom(binding),
    };
  }

  readonly #runtime: TextRuntime;
  #desired: DesiredTextState<Technique>;
  #leasedFonts: readonly LoadedFont<Technique>[];
  #standaloneCapacity: GlyphBufferCapacity;
  readonly #pixelSnapping: boolean;
  #binding: ThreeTextBatchBinding | undefined;
  #textGroup: TextGroup | undefined;
  #desiredRevision = 0;
  #appliedRevision = -1;
  #semanticChanges = ALL_SEMANTIC_CHANGES;
  readonly #textMutations: PendingTextMutation[] = [];
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(properties: StandaloneTextProperties<Technique>) {
    super();
    const normalized = normalizeDesired(properties);
    const primary = concreteFonts(normalized.font)[0];
    this.#runtime = primary.runtime;
    this.#desired = normalized;
    this.#leasedFonts = selectedFonts(normalized);
    acquireFonts(this.#leasedFonts, this.#runtime);
    this.#standaloneCapacity = normalizeCapacity(properties.capacity ?? { size: 256, policy: 'grow' });
    this.#pixelSnapping = normalizePixelSnapping(properties.pixelSnapping);
  }

  get textGroup(): TextGroup | undefined {
    return this.#textGroup;
  }
  get pixelSnapping(): boolean {
    return this.#pixelSnapping;
  }
  get bound(): boolean {
    return this.#binding !== undefined;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get error(): unknown {
    return this.#error ?? this.#textGroup?.error;
  }
  get gpuBytes(): number {
    return this.#binding?.gpuBytes ?? 0;
  }
  get font(): FontSelection<Technique> {
    return this.#desired.font;
  }
  set font(value: FontSelection<Technique>) {
    this.set({ font: value });
  }
  get text(): string {
    return this.#desired.text;
  }
  set text(value: TextInput<Technique>) {
    this.set({ text: value } as TextUpdate<Technique>);
  }
  get spans(): readonly TextSpan<Technique>[] {
    return this.#desired.spans;
  }
  set spans(value: readonly TextSpan<Technique>[]) {
    this.set({ spans: value });
  }
  get contentBox(): ParagraphContentBox {
    return this.#desired.contentBox;
  }
  set contentBox(value: ParagraphContentBox) {
    this.set({ contentBox: value });
  }
  get style(): ParagraphStyle {
    return this.#desired.style;
  }
  set style(value: ParagraphStyle) {
    this.set({ style: value });
  }
  get paint(): GlyphPaintInput {
    return this.#desired.paint;
  }
  set paint(value: GlyphPaintInput) {
    this.set({ paint: value });
  }
  get rasterPixelRatio(): number {
    return this.#desired.rasterPixelRatio ?? 1;
  }
  set rasterPixelRatio(value: number) {
    this.set({ rasterPixelRatio: value });
  }
  get material(): ThreeTextMaterial | undefined {
    return this.#desired.material;
  }
  set material(value: ThreeTextMaterial | undefined) {
    this.set({ material: value } as TextUpdate<Technique>);
  }

  set(update: TextUpdate<Technique>): void {
    this.#assertActive();
    const normalizedUpdate = replacedContent(update);
    const changes = classifySemanticChanges(normalizedUpdate);
    if (changes === 0) return;
    const next = normalizeDesired(
      { ...this.#desired, ...normalizedUpdate } as TextProperties<Technique>,
      this.#desired,
    );
    const textMutation = minimalTextMutation(this.#desired.text, next.text);
    const fonts = selectedFonts(next);
    acquireFonts(fonts, this.#runtime);
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = fonts;
    this.#desired = next;
    if (textMutation !== undefined) this.#textMutations.push(textMutation);
    this.#desiredRevision += 1;
    this.#semanticChanges |= changes;
  }

  setCapacity(capacity: GlyphBufferCapacity): void {
    this.#assertActive();
    this.#standaloneCapacity = normalizeCapacity(capacity);
    if (this.#textGroup === undefined) this.#binding?.setCapacity(this.#standaloneCapacity);
  }
  /**
   * The committed measurement, or `undefined` when this paragraph has not published one yet.
   *
   * Sizes, baselines, ascent, descent, and the glyph and line counts. This takes the
   * paragraph-scoped engine query: no publication flip, no per-glyph records, no array copies,
   * so a scene that measures every frame stays on the cheap path.
   *
   * `undefined` means no committed layout, not a failure. `commitState()` is the positive signal.
   */
  layout(): ParagraphLayoutSummary | undefined {
    this.#assertActive();
    return this.#binding?.measurement(eraseTextTechnique(this));
  }
  /**
   * The positioned columns of the committed layout, or `undefined` when none is committed.
   *
   * Separate from `layout()` because it is a separate engine query: `layout()` takes the
   * paragraph-scoped measurement path with no publication flip, while this asks the engine to emit
   * a record per glyph and copies those arrays out of Wasm. Reading a width should not pay for
   * that, and a scene that measures every frame would.
   */
  glyphs(): ParagraphLayoutInspection | undefined {
    this.#assertActive();
    return this.#binding?.layoutInspection(eraseTextTechnique(this));
  }
  /**
   * Has this paragraph published a layout, and did it succeed.
   *
   * This is the positive signal. A caller that needed to know a layout committed previously had to
   * force `updateMatrixWorld(true)` and then infer success from `error` still being `undefined`.
   */
  commitState(): TextCommitState {
    if (this.#disposed) return { status: 'unbound' };
    const error = this.error;
    if (error !== undefined) return { status: 'failed', error };
    // A paragraph outside the scene graph will never commit on its own, which is a different
    // answer from one that commits on the next world-matrix update. Parenthood, not the batch
    // binding, is what separates them: binding happens during that update.
    if (this.parent === null) return { status: 'unbound' };
    if (this.#binding === undefined || this.#desiredRevision !== this.#appliedRevision) {
      return { status: 'pending' };
    }
    return { status: 'committed', revision: this.#appliedRevision };
  }

  /**
   * Copies this paragraph's glyphs into a structure that can be manipulated and applied back.
   *
   * Step one of **snapshot, manipulate, restore**. The snapshot retains no renderer or engine
   * resource, states its own coordinate space, addresses glyphs, words, and lines directly, and
   * names any glyph whose drawn position it could not read.
   *
   * Returns `undefined` when the paragraph has no committed layout, which `commitState()`
   * distinguishes from being unbound.
   */
  snapshotGlyphs(): GlyphPlacements | undefined {
    this.#assertActive();
    return this.#binding?.glyphPlacements(eraseTextTechnique(this));
  }

  /**
   * Writes a manipulated snapshot to the retained GPU buffer: no reshape, no CPU re-upload.
   *
   * Step two. Applies to every glyph or reports exactly which it did not reach — a partial write is
   * a value the caller receives, never a silence. Throws when `placements` describes a layout this
   * paragraph has since replaced, because the identities in it no longer address the same glyphs.
   */
  applyGlyphs(placements: GlyphPlacements): GlyphApplication {
    this.#assertActive();
    if (this.#binding === undefined) throw new Error('glyph placements require a bound Text');
    return this.#binding.applyGlyphPlacements(eraseTextTechnique(this), placements);
  }

  /**
   * Returns every glyph to where the layout put it, and hands authority back to the layout.
   *
   * Step three, and a first-class one. An override left pinned at its target outlives the motion
   * that set it and shadows the next committed origins; the previous surface made a caller discover
   * that by observing the corruption.
   */
  restoreGlyphs(): void {
    this.#assertActive();
    this.#binding?.clearGlyphOrigins(eraseTextTechnique(this));
  }

  /** Nearest cluster boundary to a paragraph-local point. `undefined` without a committed layout. */
  caretAt(x: number, y: number): GlyphCaret | undefined {
    return this.snapshotGlyphs()?.caretAt(x, y);
  }

  /** Line-clipped rectangles covering a UTF-16 range. `undefined` without a committed layout. */
  selectionRects(start: number, end: number): readonly LayoutBox[] | undefined {
    return this.snapshotGlyphs()?.selectionRects(start, end);
  }

  override updateMatrixWorld(force?: boolean): void {
    if (this.#disposed) {
      super.updateMatrixWorld(force);
      return;
    }
    const boundary = nearestTextGroup(this);
    if (boundary?.disposed) {
      this.#unbind();
    } else if (boundary !== undefined) {
      // The group publishes this text on its own traversal; validate now so an
      // incompatible attachment fails at the paragraph rather than the batch.
      validateText(eraseTextTechnique(this));
    } else if (this.parent !== null) {
      if (this.#binding === undefined || this.#textGroup !== undefined) {
        this.#unbind();
        this.#binding = new ThreeTextBatchBinding(this.#runtime, this.#standaloneCapacity, undefined);
      }
      this.#binding.reconcileStandalone(eraseTextTechnique(this));
      try {
        this.#binding.synchronize();
        // A latched batch published nothing this frame, so the rejection `.error` already holds is
        // still the current state. Clearing it here would erase the only signal a rejected frame has.
        if (!this.#binding.failed) this.#error = undefined;
      } catch (error) {
        this.#error = error;
        this.onError?.(error);
      }
    } else {
      this.#unbind();
    }
    super.updateMatrixWorld(force);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unbind();
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = [];
  }

  /**
   * The paragraph as this integration states it, materials included.
   *
   * It used to narrow to `ParagraphProperties`, the renderer-agnostic vocabulary, which silently
   * dropped the two things only this integration has -- the paragraph's material and the material on
   * each span -- and the compiler then cast them back to reach the values it had just discarded. A
   * material is how Three.js renders a run; the engine only ever sees the `materialId` this module
   * resolves it to, so the renderer-facing type belongs here rather than in the shared vocabulary.
   */
  #coreProperties(): TextProperties<Technique> {
    return {
      ...this.#desired,
      order: this.renderOrder,
      ...(this.#desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: this.#desired.rasterPixelRatio }),
    };
  }
  #markApplied(): void {
    this.#appliedRevision = this.#desiredRevision;
    this.#semanticChanges = 0;
    this.#textMutations.length = 0;
  }
  #bind(binding: ThreeTextBatchBinding, group: TextGroup | undefined): void {
    if (this.#binding !== binding) this.#unbind();
    this.#binding = binding;
    this.#textGroup = group;
    this.#appliedRevision = this.#desiredRevision;
  }
  #unbindFrom(binding: ThreeTextBatchBinding): void {
    if (this.#binding !== binding) return;
    this.#binding = undefined;
    this.#textGroup = undefined;
  }
  #unbind(): void {
    const binding = this.#binding;
    const standalone = binding !== undefined && this.#textGroup === undefined;
    this.#binding = undefined;
    this.#textGroup = undefined;
    if (standalone) binding.dispose();
    else binding?.removeText(eraseTextTechnique(this));
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('text has been disposed');
  }
}

export class TextGroup extends THREE.Object3D {
  #capacity: GlyphBufferCapacity;
  readonly #compositing: 'ordered' | 'independent';
  readonly #pixelSnapping: boolean;
  #material: ThreeTextMaterial | undefined;
  #binding: ThreeTextBatchBinding | undefined;
  readonly #transformTracker = new TextTransformTracker();
  readonly #texts: Text<AnyRasterTechnique>[] = [];
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(options: TextGroupOptions = {}) {
    super();
    this.#capacity = normalizeCapacity(options.capacity ?? { size: 4_096, policy: 'chunk' });
    this.#compositing = normalizeCompositing(options.compositing);
    this.#pixelSnapping = normalizePixelSnapping(options.pixelSnapping);
    this.#material = options.material;
    if (options.renderOrder !== undefined) this.renderOrder = options.renderOrder;
  }
  get capacity(): GlyphBufferCapacity {
    return this.#capacity;
  }
  get compositing(): 'ordered' | 'independent' {
    return this.#compositing;
  }
  get textCount(): number {
    return this.#binding?.textCount ?? 0;
  }
  get pixelSnapping(): boolean {
    return this.#pixelSnapping;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get error(): unknown {
    return this.#error;
  }
  get gpuBytes(): number {
    return this.#binding?.gpuBytes ?? 0;
  }
  get material(): ThreeTextMaterial | undefined {
    return this.#material;
  }
  set material(value: ThreeTextMaterial | undefined) {
    this.setMaterial(value);
  }
  setMaterial(value: ThreeTextMaterial | undefined): void {
    this.#material = value;
    this.#binding?.invalidateMaterial();
  }

  override add(...children: THREE.Object3D[]): this {
    this.#assertActive();
    for (const child of children) if (child instanceof Text) validateText(child as Text<AnyRasterTechnique>);
    return super.add(...children);
  }
  setCapacity(capacity: GlyphBufferCapacity): void {
    this.#assertActive();
    this.#capacity = normalizeCapacity(capacity);
    this.#binding?.setCapacity(this.#capacity);
  }
  override clone(_recursive?: boolean): never {
    throw new Error('TextGroup cannot be cloned');
  }
  override copy(_source: THREE.Object3D, _recursive?: boolean): never {
    throw new Error('TextGroup cannot be copied');
  }

  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);
    if (!this.#disposed) {
      const texts = collectTextDescendants(this, this.#texts);
      if (texts.length !== 0) {
        try {
          const runtime = reconciler.runtime(texts[0]!);
          for (const text of texts) validateBinding(runtime, text);
          this.#binding ??= new ThreeTextBatchBinding(runtime, this.#capacity, this);
          this.#binding.reconcile(texts);
          this.#transformTracker.beginFrame();
          for (const text of texts) {
            if (this.#transformTracker.pathChanged(text, this)) this.#binding.markTransformDirty(text);
          }
          this.#binding.synchronize();
          // A latched batch published nothing this frame, so the rejection `.error` already holds
          // is still the current state; clearing it would erase the only signal it has.
          if (!this.#binding.failed) this.#error = undefined;
        } catch (error) {
          this.#error = error;
          this.onError?.(error);
        }
      } else if (this.#binding !== undefined) {
        this.#binding.reconcile([]);
        try {
          this.#binding.synchronize();
          if (!this.#binding.failed) this.#error = undefined;
        } catch (error) {
          this.#error = error;
          this.onError?.(error);
        }
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#binding?.dispose();
    this.#binding = undefined;
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('TextGroup has been disposed');
  }
}

/** One paragraph of a rejected frame, in render order: what it was and which desired state it held. */
interface RetainedEngineParagraph {
  readonly id: number;
  textLength: number;
  styleCount: number;
  order: number;
  geometryRevision: number;
  created: boolean;
  stackLeases: ThreeTextEngineStackLease[];
  materialLeases: ThreeTextMaterialLease[];
}

class ThreeTextBatchBinding {
  readonly #runtime: TextRuntime;
  readonly #group: TextGroup | undefined;
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #session: TextEngineSession;
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #paragraphs = new Map<Text<AnyRasterTechnique>, RetainedEngineParagraph>();
  readonly #textsByParagraph = new Map<number, Text<AnyRasterTechnique>>();
  readonly #removed: RetainedEngineParagraph[] = [];
  readonly #measurements = new Map<Text<AnyRasterTechnique>, ParagraphLayoutSummary>();
  readonly #layoutInspections = new Map<Text<AnyRasterTechnique>, ParagraphLayoutInspection>();
  readonly #queryPlanView = new TextEngineRenderPlanView();
  readonly #freeParagraphIds: number[] = [];
  readonly #dirtyTransformIds = new Set<number>();
  readonly #desiredTexts = new Set<Text<AnyRasterTechnique>>();
  #nextParagraphId = 1;
  #engineRevision = 0;
  #planRevision = 0;
  #acknowledgedPublicationGeneration = 0;
  #lastPublication: TextEnginePublication | undefined;
  #requestCapacity: number;
  #resultCapacity: number;
  #textCapacity = 0;
  #capacity: GlyphBufferCapacity;
  #materialInvalidated = false;
  #rejection: unknown;
  #capacityExceeded: { readonly required: number; readonly size: number } | undefined;
  #disposed = false;

  constructor(runtime: TextRuntime, capacity: GlyphBufferCapacity, group: TextGroup | undefined) {
    this.#runtime = runtime;
    this.#group = group;
    this.#coordinator = threeTextEngineCoordinator(runtime);
    this.#requestCapacity = Math.max(64 * 1024, capacity.size * 32);
    this.#resultCapacity = Math.max(256 * 1024, capacity.size * 160);
    this.#capacity = capacity;
    this.#session = this.#coordinator.createSession({
      requestCapacity: this.#requestCapacity,
      resultCapacity: this.#resultCapacity,
    });
    const owner = this;
    this.#target = new ThreeTextRenderPlanExecutor(this.#coordinator, {
      get drawRoot() {
        return owner.#drawRoot();
      },
      get pixelSnapping() {
        return owner.#pixelSnapping();
      },
      get renderOrderBase() {
        return owner.#renderOrderBase();
      },
      objectForTransform(transformId) {
        const text = owner.#textsByParagraph.get(transformId);
        if (text === undefined) throw new Error(`Three command buffer references unknown transform ${transformId}`);
        return text;
      },
      transformIds() {
        return owner.#textsByParagraph.keys();
      },
    });
  }
  get textCount(): number {
    return this.#paragraphs.size;
  }
  get gpuBytes(): number {
    return this.#target.gpuBytes;
  }
  get renderOrderBase(): number {
    return this.#group?.renderOrder ?? 0;
  }
  measurement(text: Text<AnyRasterTechnique>): ParagraphLayoutSummary | undefined {
    if (!this.#paragraphs.has(text)) return undefined;
    this.#assertNotLatched();
    if (this.#measureThroughParagraphQuery(text)) return this.#measurements.get(text);
    this.synchronize(textShaperAbi.engine.semanticViewMasks.measurement);
    return this.#measurements.get(text);
  }

  /**
   * Routes an explicit layout query through the paragraph-scoped synchronous engine
   * measure when the only pending work is a geometry change on the queried text: no
   * publication flip, no revision burn, no checkpoint hazard, and the next ordinary
   * frame adopts the speculative layout together with its reserved identities.
   * Anything else answers `false` and falls back to the committing synchronize path.
   */
  #measureThroughParagraphQuery(text: Text<AnyRasterTechnique>): boolean {
    if (this.#disposed || this.#lastPublication !== undefined || this.#materialInvalidated) return false;
    if (this.#removed.length !== 0) return false;
    const paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined || paragraph.created) return false;
    const changes = reconciler.semanticChanges(text);
    if ((changes & ~GEOMETRY_CHANGE) !== 0) return false;
    if (changes === 0 && this.#measurements.has(text)) return true;
    // Every other paragraph must be quiescent so the frame this query speculates
    // ahead of is exactly the frame synchronize will later commit and adopt.
    const ordered = [...this.#paragraphs.entries()].sort(
      ([leftText, left], [rightText, right]) => leftText.renderOrder - rightText.renderOrder || left.id - right.id,
    );
    for (const [order, [entry, entryParagraph]] of ordered.entries()) {
      if (entryParagraph.order !== order || entryParagraph.created) return false;
      if (entry !== text && (reconciler.semanticChanges(entry) !== 0 || reconciler.needsApply(entry))) return false;
    }
    this.#coordinator.assertFrameUpdateAllowed();
    let totalTextLength = 0;
    let maximumParagraphTextLength = 0;
    for (const entry of this.#paragraphs.keys()) {
      totalTextLength += entry.text.length;
      maximumParagraphTextLength = Math.max(maximumParagraphTextLength, entry.text.length);
    }
    const properties = reconciler.properties(text);
    const content = properties.text as string;
    const geometry = compileEngineGeometry(
      paragraph.id,
      paragraph.geometryRevision + 1,
      properties.contentBox,
      0,
      content.length,
    );
    const result = this.#session.measureParagraph(
      compileTextEngineFrameUpdate({
        sessionId: this.#session.handle,
        policyHandle: this.#coordinator.policyHandle,
        capabilitySet: 1,
        expectedEngineRevision: this.#engineRevision,
        consumedPlanRevision: this.#planRevision,
        acknowledgedPublicationGeneration: this.#acknowledgedPublicationGeneration,
        compositingIndependent: this.#group?.compositing === 'independent',
        semanticViewMask: textShaperAbi.engine.semanticViewMasks.measurement,
        limits: engineLimits(
          this.#paragraphs.size,
          totalTextLength,
          maximumParagraphTextLength,
          Math.max(geometry.regions.length, this.#paragraphs.size),
          MAX_TEXT_ENGINE_OUTPUT_BYTES,
        ),
        paragraphMutations: [{ opcode: 'upsert', paragraphId: paragraph.id, order: paragraph.order }],
        constraints: [geometry.constraint],
        regions: geometry.regions,
      }),
      paragraph.id,
    );
    this.#retainSemanticViews(result, textShaperAbi.engine.semanticViewMasks.measurement);
    return true;
  }
  layoutInspection(text: Text<AnyRasterTechnique>): ParagraphLayoutInspection | undefined {
    if (!this.#paragraphs.has(text)) return undefined;
    this.#assertNotLatched();
    this.synchronize(textShaperAbi.engine.semanticViewMasks.layoutInspection);
    return this.#layoutInspections.get(text);
  }
  glyphPlacements(text: Text<AnyRasterTechnique>): GlyphPlacements | undefined {
    const layout = this.layoutInspection(text);
    if (layout === undefined) return undefined;
    const drawn = this.#target.snapshotGlyphOrigins(layout.glyphStableIds, layout.x, layout.y);
    return createGlyphPlacements(layout, text.text, drawn.drawnX, drawn.drawnY, drawn.incomplete);
  }
  applyGlyphPlacements(text: Text<AnyRasterTechnique>, placements: GlyphPlacements): GlyphApplication {
    const layout = this.layoutInspection(text);
    if (layout === undefined || placements.layout !== layout) {
      throw new TypeError('glyph placements do not match the committed layout inspection');
    }
    const glyphs = placements.glyphs;
    if (glyphs.length !== layout.glyphCount) {
      throw new RangeError('glyph placements do not match the inspected glyph count');
    }
    const x = new Float32Array(glyphs.length);
    const y = new Float32Array(glyphs.length);
    for (let index = 0; index < glyphs.length; index += 1) {
      x[index] = glyphs[index]!.x;
      y[index] = glyphs[index]!.y;
    }
    const unapplied = this.#target.setGlyphOriginOverrides(layout.glyphStableIds, layout.x, layout.y, x, y);
    return Object.freeze({
      requested: glyphs.length,
      applied: glyphs.length - unapplied.length,
      unapplied: Object.freeze(unapplied),
    });
  }
  clearGlyphOrigins(text: Text<AnyRasterTechnique>): void {
    const layout = this.#layoutInspections.get(text);
    if (layout !== undefined) this.#target.clearGlyphOriginOverrides(layout.glyphStableIds);
  }
  reconcile(texts: readonly Text<AnyRasterTechnique>[]): void {
    this.#desiredTexts.clear();
    for (const text of texts) this.#desiredTexts.add(text);
    for (const text of this.#paragraphs.keys()) if (!this.#desiredTexts.has(text)) this.removeText(text);
    for (const text of texts) this.#ensureText(text, this.#group);
  }
  reconcileStandalone(text: Text<AnyRasterTechnique>): void {
    this.#ensureText(text, undefined);
  }
  markTransformDirty(text: Text<AnyRasterTechnique>): void {
    const paragraph = this.#paragraphs.get(text);
    if (paragraph !== undefined) this.#dirtyTransformIds.add(paragraph.id);
  }
  /**
   * A caller-invoked query cannot answer from a latched batch, and must not answer `undefined` as if
   * the paragraph merely had no layout yet. It raises the rejection the frame path is holding, which
   * is what the query threw before the latch existed.
   */
  #assertNotLatched(): void {
    if (this.#rejection !== undefined) throw this.#rejection;
  }
  /**
   * True once a frame was refused, which means this package broke one of its own invariants.
   *
   * Shaping, layout, and measurement cannot fail with the data they need, and every input a caller
   * controls -- span ranges and nesting, feature ranges, surrogate pairing, cluster alignment -- is
   * refused at `set()` before it reaches the engine. A refusal here is therefore a defect to report,
   * not a condition to recover from, and there is deliberately nothing that clears it: the batch
   * reports once and stops compiling instead of failing silently at frame rate behind the last good
   * picture.
   */
  /** What a fixed budget could not hold, while it cannot hold it. Cleared when the content fits again. */
  get capacityExceeded(): { readonly required: number; readonly size: number } | undefined {
    return this.#capacityExceeded;
  }
  get failed(): boolean {
    return this.#rejection !== undefined;
  }
  synchronize(semanticViewMask = 0): void {
    if (this.#disposed) return;
    this.#coordinator.assertFrameUpdateAllowed();
    if (this.#lastPublication !== undefined) this.retry();
    const ordered = [...this.#paragraphs.entries()].sort(
      ([leftText, left], [rightText, right]) => leftText.renderOrder - rightText.renderOrder || left.id - right.id,
    );
    if (this.#rejection !== undefined) {
      // A rejection is a defect in this package, not a state to recover from: shaping and layout
      // cannot fail once the data they need is present, and every input a caller controls is
      // refused at `set()` before it reaches here. So there is nothing to try again for, and the
      // batch stops compiling for good rather than deciding when the input has moved enough.
      //
      // Transforms still run. They are applied to the last accepted publication and never entered
      // the frame the engine refused, so withholding them would turn one broken paragraph into a
      // whole group that stops responding to the camera.
      this.#target.syncTransforms(this.#dirtyTransformIds, this.#group !== undefined);
      this.#dirtyTransformIds.clear();
      return;
    }
    const changed = ordered.flatMap(([text, paragraph], order) => {
      const semanticChanges =
        (paragraph.created ? ALL_SEMANTIC_CHANGES : reconciler.semanticChanges(text)) |
        (this.#materialInvalidated ? STYLE_CHANGE : 0);
      return semanticChanges !== 0 || reconciler.needsApply(text) || paragraph.order !== order
        ? [{ text, paragraph, order, semanticChanges }]
        : [];
    });
    if (changed.length === 0 && this.#removed.length === 0) {
      this.#target.syncTransforms(this.#dirtyTransformIds, this.#group !== undefined);
      this.#dirtyTransformIds.clear();
      if (semanticViewMask !== 0 && !this.#hasSemanticViews(semanticViewMask)) {
        this.#retainSemanticViews(this.#querySemanticViews(semanticViewMask), semanticViewMask);
      }
      return;
    }
    const paragraphMutations = [
      ...this.#removed.map((paragraph) => ({ opcode: 'remove' as const, paragraphId: paragraph.id })),
      ...changed.map(({ paragraph, order }) => ({
        opcode: 'upsert' as const,
        paragraphId: paragraph.id,
        order,
      })),
    ];
    const textMutations: TextEngineTextMutation[] = [];
    const styleMutations: TextEngineStyleMutation[] = [];
    const constraints: TextEngineConstraint[] = [];
    const regions: TextEngineRegion[] = [];
    const pendingLeases = new Map<RetainedEngineParagraph, ThreeTextEngineStackLease[]>();
    const pendingMaterials = new Map<RetainedEngineParagraph, ThreeTextMaterialLease[]>();
    const pendingChanges = new Map<RetainedEngineParagraph, number>();
    let committed = false;
    try {
      for (const { text, paragraph, semanticChanges } of changed) {
        pendingChanges.set(paragraph, semanticChanges);
        const properties = reconciler.properties(text);
        const content = properties.text as string;
        if (semanticChanges & TEXT_CHANGE) {
          const pending = paragraph.created
            ? [{ start: 0, deleteCount: 0, insert: content }]
            : reconciler.textMutations(text);
          for (const mutation of pending) {
            if (mutation.deleteCount === 0 && mutation.insert.length === 0) continue;
            textMutations.push({ paragraphId: paragraph.id, ...mutation });
          }
        }
        if (semanticChanges & STYLE_CHANGE) {
          const leases: ThreeTextEngineStackLease[] = [];
          const materials: ThreeTextMaterialLease[] = [];
          pendingLeases.set(paragraph, leases);
          pendingMaterials.set(paragraph, materials);
          const styles = compileEngineStyles(
            this.#coordinator,
            paragraph.id,
            properties,
            this.#group?.material,
            leases,
            materials,
          );
          styleMutations.push(...styles);
          for (let styleId = styles.length + 1; styleId <= paragraph.styleCount; styleId += 1) {
            styleMutations.push({ opcode: 'remove', paragraphId: paragraph.id, styleId });
          }
        }
        if (semanticChanges & GEOMETRY_CHANGE) {
          const geometry = compileEngineGeometry(
            paragraph.id,
            paragraph.geometryRevision + 1,
            properties.contentBox,
            regions.length,
            content.length,
          );
          constraints.push(geometry.constraint);
          regions.push(...geometry.regions);
        }
      }
      let totalTextLength = 0;
      let maximumParagraphTextLength = 0;
      for (const text of this.#paragraphs.keys()) {
        totalTextLength += text.text.length;
        maximumParagraphTextLength = Math.max(maximumParagraphTextLength, text.text.length);
      }
      if (!this.#withinFixedCapacity(totalTextLength)) {
        // The caller asked for a hard cap, so honouring it is the correct outcome rather than a
        // failure: keep the last complete revision, keep the scene running, and keep transforms
        // live so the paragraph still follows the camera.
        this.#target.syncTransforms(this.#dirtyTransformIds, this.#group !== undefined);
        this.#dirtyTransformIds.clear();
        return;
      }
      this.#ensureCapacity(totalTextLength, maximumParagraphTextLength);
      const limits = engineLimits(
        Math.max(this.#paragraphs.size, paragraphMutations.length),
        totalTextLength,
        maximumParagraphTextLength,
        Math.max(regions.length, this.#paragraphs.size),
        MAX_TEXT_ENGINE_OUTPUT_BYTES,
        Math.max(textMutations.length, styleMutations.length),
      );
      const frame = compileTextEngineFrameUpdate({
        sessionId: this.#session.handle,
        policyHandle: this.#coordinator.policyHandle,
        capabilitySet: 1,
        expectedEngineRevision: this.#engineRevision,
        consumedPlanRevision: this.#planRevision,
        acknowledgedPublicationGeneration: this.#acknowledgedPublicationGeneration,
        compositingIndependent: this.#group?.compositing === 'independent',
        semanticViewMask,
        limits,
        paragraphMutations,
        textMutations,
        styleMutations,
        constraints,
        regions,
      });
      let publication: TextEnginePublication;
      try {
        publication = this.#session.update(frame);
      } catch (error) {
        if (error instanceof TextEngineStatusError) {
          error.message +=
            ` (paragraphs=${this.#paragraphs.size}, paragraph mutations=${paragraphMutations.length},` +
            ` text mutations=${textMutations.length}, style mutations=${styleMutations.length},` +
            ` constraints=${constraints.length}, regions=${regions.length}, text units=${totalTextLength},` +
            ` limits=${JSON.stringify(limits)})`;
        }
        throw error;
      }
      this.#engineRevision = publication.engineRevision;
      for (const removed of this.#removed) releaseStackLeases(removed.stackLeases);
      for (const removed of this.#removed) releaseMaterialLeases(removed.materialLeases);
      for (const removed of this.#removed) this.#freeParagraphIds.push(removed.id);
      this.#removed.length = 0;
      for (const [order, [text, paragraph]] of ordered.entries()) {
        const semanticChanges = pendingChanges.get(paragraph) ?? 0;
        if (semanticChanges === 0 && paragraph.order === order) continue;
        const nextLeases = pendingLeases.get(paragraph);
        if (nextLeases !== undefined) {
          releaseStackLeases(paragraph.stackLeases);
          releaseMaterialLeases(paragraph.materialLeases);
          paragraph.stackLeases = nextLeases;
          paragraph.materialLeases = pendingMaterials.get(paragraph) ?? [];
          paragraph.styleCount = 1 + styledSpans(text.spans).length;
        }
        if (semanticChanges & TEXT_CHANGE) paragraph.textLength = text.text.length;
        if (semanticChanges & GEOMETRY_CHANGE) paragraph.geometryRevision += 1;
        paragraph.created = false;
        reconciler.markApplied(text);
        paragraph.order = order;
      }
      this.#materialInvalidated = false;
      this.#measurements.clear();
      this.#layoutInspections.clear();
      committed = true;
      try {
        this.#target.apply(publication);
        this.#dirtyTransformIds.clear();
        this.#planRevision = publication.planRevision;
        this.#lastPublication = undefined;
      } catch (error) {
        this.#lastPublication = ownPublication(publication);
        throw error;
      }
      this.#acknowledgedPublicationGeneration = publication.publicationGeneration;
      this.#retainSemanticViews(publication, semanticViewMask);
    } catch (error) {
      const rejected = textFrameError(error, (fault) => this.#faultSubject(fault));
      if (!committed) {
        for (const leases of pendingLeases.values()) releaseStackLeases(leases);
        for (const leases of pendingMaterials.values()) releaseMaterialLeases(leases);
        // A committed frame whose GPU application failed is retried from `#lastPublication` on the
        // next frame, so latching it would suppress the retry that is meant to recover it. Only an
        // uncommitted frame -- one the engine or the compiler refused -- is latched.
        this.#rejection = rejected;
      }
      throw rejected;
    }
  }
  /**
   * Resolves an engine fault onto the objects the caller wrote.
   *
   * `compileEngineStyles` numbers the root style 1 and then the COMPILED spans from 2. A collapsed
   * span is not compiled, so the authored index is recovered by walking the same filter rather than
   * by subtracting a constant.
   */
  #faultSubject(fault: TextEngineFault): TextFrameSubject {
    const text = this.#textsByParagraph.get(fault.paragraphId);
    if (text === undefined) return { kind: 'unattributed' };
    if (fault.styleId < 2) return { kind: 'paragraph', text };
    let styleId = 1;
    for (const [index, span] of text.spans.entries()) {
      if (span.start === span.end) continue;
      styleId += 1;
      if (styleId === fault.styleId) return { kind: 'span', text, index, span };
    }
    return { kind: 'paragraph', text };
  }
  setCapacity(value: GlyphBufferCapacity): void {
    this.#capacity = value;
    this.#requestCapacity = Math.max(this.#requestCapacity, value.size * 32);
    this.#resultCapacity = Math.max(this.#resultCapacity, value.size * 160);
    this.#session.reserve(this.#requestCapacity, this.#resultCapacity);
  }
  /**
   * Whether a fixed budget can hold what the paragraphs now need.
   *
   * `fixed` is a caller declaring a hard glyph budget, which is a real thing to want in a
   * memory-constrained scene, so exceeding it is neither a defect nor an error: it is the policy
   * doing what it was asked to do. The defined behaviour is that the update does not apply and the
   * last complete revision stays on screen. The requirement is a text-length upper bound computed
   * before shaping, so the answer never depends on work the budget was supposed to bound.
   *
   * It self-heals: shortening the text or raising the capacity clears it on the next frame, because
   * the comparison is recomputed rather than latched.
   */
  #withinFixedCapacity(required: number): boolean {
    if (this.#capacity.policy !== 'fixed' || required <= this.#capacity.size) {
      this.#capacityExceeded = undefined;
      return true;
    }
    const exceeded = { required, size: this.#capacity.size };
    const changed = this.#capacityExceeded?.required !== required || this.#capacityExceeded.size !== exceeded.size;
    this.#capacityExceeded = exceeded;
    if (changed && DEV) {
      console.warn(
        `[@pmndrs/glyph] fixed capacity ${exceeded.size} cannot hold ${required} glyph slots; the last complete ` +
          `revision stays visible and this update is not applied. Raise the capacity, shorten the text, or use ` +
          `the 'grow' or 'chunk' policy.`,
      );
    }
    return false;
  }
  #ensureCapacity(required: number, requiredParagraphText: number): void {
    const target =
      this.#capacity.policy === 'chunk' ? Math.ceil(required / this.#capacity.size) * this.#capacity.size : required;
    const requestCapacity = Math.max(this.#requestCapacity, target * 32);
    const resultCapacity = Math.max(this.#resultCapacity, target * 160);
    const textCapacity = Math.max(this.#textCapacity, requiredParagraphText);
    if (
      requestCapacity === this.#requestCapacity &&
      resultCapacity === this.#resultCapacity &&
      textCapacity === this.#textCapacity
    ) {
      return;
    }
    this.#requestCapacity = requestCapacity;
    this.#resultCapacity = resultCapacity;
    this.#textCapacity = textCapacity;
    // Glyph capacity is aggregate batch storage, while Rust's text reservation sizes one paragraph scratch arena.
    // Reserving the longest paragraph keeps sustained edits hot without multiplying the batch's total text by every
    // scratch field.
    this.#session.reserve(this.#requestCapacity, this.#resultCapacity, this.#textCapacity);
  }
  invalidateMaterial(): void {
    this.#materialInvalidated = true;
  }
  retry(): void {
    const publication = this.#lastPublication;
    if (publication === undefined) return;
    this.#target.apply(publication);
    this.#planRevision = publication.planRevision;
    this.#acknowledgedPublicationGeneration = publication.publicationGeneration;
    this.#lastPublication = undefined;
  }
  removeText(text: Text<AnyRasterTechnique>): void {
    const paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined) return;
    this.#paragraphs.delete(text);
    this.#textsByParagraph.delete(paragraph.id);
    this.#dirtyTransformIds.delete(paragraph.id);
    this.#removed.push(paragraph);
    reconciler.unbindFrom(text, this);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const text of this.#paragraphs.keys()) reconciler.unbindFrom(text, this);
    this.#target.dispose();
    this.#session.dispose();
    for (const paragraph of this.#paragraphs.values()) releaseStackLeases(paragraph.stackLeases);
    for (const paragraph of this.#removed) releaseStackLeases(paragraph.stackLeases);
    for (const paragraph of this.#paragraphs.values()) releaseMaterialLeases(paragraph.materialLeases);
    for (const paragraph of this.#removed) releaseMaterialLeases(paragraph.materialLeases);
    this.#paragraphs.clear();
    this.#textsByParagraph.clear();
    this.#measurements.clear();
    this.#layoutInspections.clear();
    this.#removed.length = 0;
    this.#freeParagraphIds.length = 0;
    this.#dirtyTransformIds.clear();
    this.#desiredTexts.clear();
  }
  #ensureText(text: Text<AnyRasterTechnique>, group: TextGroup | undefined): void {
    validateBinding(this.#runtime, text);
    let paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined) {
      const id = this.#freeParagraphIds.pop() ?? this.#nextParagraphId++;
      paragraph = {
        id,
        textLength: 0,
        styleCount: 0,
        order: -1,
        geometryRevision: 0,
        created: true,
        stackLeases: [],
        materialLeases: [],
      };
      this.#paragraphs.set(text, paragraph);
      this.#textsByParagraph.set(id, text);
      reconciler.bind(text, this, group);
    }
  }

  #drawRoot(): THREE.Object3D {
    if (this.#group !== undefined) return this.#group;
    const text = this.#paragraphs.keys().next().value;
    if (text === undefined) throw new Error('standalone text command buffer has no draw root');
    return text;
  }

  #renderOrderBase(): number {
    if (this.#group !== undefined) return this.#group.renderOrder;
    return this.#paragraphs.keys().next().value?.renderOrder ?? 0;
  }

  #pixelSnapping(): boolean {
    if (this.#group !== undefined) return this.#group.pixelSnapping;
    return this.#paragraphs.keys().next().value?.pixelSnapping ?? false;
  }

  #querySemanticViews(semanticViewMask: number): TextEnginePublication {
    let totalTextLength = 0;
    let maximumParagraphTextLength = 0;
    for (const entry of this.#paragraphs.keys()) {
      totalTextLength += entry.text.length;
      maximumParagraphTextLength = Math.max(maximumParagraphTextLength, entry.text.length);
    }
    const publication = this.#session.update(
      compileTextEngineFrameUpdate({
        sessionId: this.#session.handle,
        policyHandle: this.#coordinator.policyHandle,
        capabilitySet: 1,
        expectedEngineRevision: this.#engineRevision,
        consumedPlanRevision: this.#planRevision,
        acknowledgedPublicationGeneration: this.#acknowledgedPublicationGeneration,
        compositingIndependent: this.#group?.compositing === 'independent',
        semanticViewMask,
        limits: engineLimits(
          this.#paragraphs.size,
          totalTextLength,
          maximumParagraphTextLength,
          this.#paragraphs.size,
          MAX_TEXT_ENGINE_OUTPUT_BYTES,
        ),
      }),
    );
    this.#engineRevision = publication.engineRevision;
    const plan = this.#queryPlanView.bind(publication);
    for (const table of ['resources', 'buffers', 'patches', 'primitives', 'draws', 'retirements'] as const) {
      if (plan.table(table).count !== 0) {
        this.#lastPublication = ownPublication(publication);
        throw new Error('a semantic-only text query unexpectedly published render work');
      }
    }
    this.#planRevision = publication.planRevision;
    return publication;
  }

  #hasSemanticViews(semanticViewMask: number): boolean {
    if (semanticViewMask === textShaperAbi.engine.semanticViewMasks.measurement) {
      return this.#measurements.size === this.#paragraphs.size;
    }
    if (semanticViewMask === textShaperAbi.engine.semanticViewMasks.layoutInspection) {
      return this.#layoutInspections.size === this.#paragraphs.size;
    }
    return false;
  }

  #retainSemanticViews(publication: TextEnginePublication, semanticViewMask: number): void {
    if (semanticViewMask === 0) return;
    if (semanticViewMask === textShaperAbi.engine.semanticViewMasks.measurement) {
      for (const [paragraphId, measurement] of readTextEngineMeasurements(publication)) {
        const measuredText = this.#textsByParagraph.get(paragraphId);
        if (measuredText === undefined) throw new Error(`text engine measured unknown paragraph ${paragraphId}`);
        this.#measurements.set(measuredText, measurement);
      }
    } else if (semanticViewMask === textShaperAbi.engine.semanticViewMasks.layoutInspection) {
      for (const [paragraphId, layout] of readTextEngineLayouts(publication)) {
        const inspectedText = this.#textsByParagraph.get(paragraphId);
        if (inspectedText === undefined) throw new Error(`text engine inspected unknown paragraph ${paragraphId}`);
        this.#measurements.set(inspectedText, layout);
        this.#layoutInspections.set(inspectedText, layout);
      }
    } else {
      throw new RangeError(`unsupported semantic view mask ${semanticViewMask}`);
    }
    this.#acknowledgedPublicationGeneration = publication.publicationGeneration;
  }
}

function compileEngineStyles<Technique extends AnyRasterTechnique>(
  coordinator: ThreeTextEngineCoordinator,
  paragraphId: number,
  properties: TextProperties<Technique>,
  groupMaterial: ThreeTextMaterial | undefined,
  leases: ThreeTextEngineStackLease[],
  materialLeases: ThreeTextMaterialLease[],
): TextEngineStyleMutation[] {
  const text = properties.text as string;
  const rootStack = acquireEngineStack(coordinator, properties.font, leases);
  const rootMaterial = properties.material ?? groupMaterial;
  const rootMaterialId = acquireEngineMaterial(coordinator, rootMaterial, materialLeases);
  const styles: TextEngineStyleMutation[] = [
    {
      opcode: 'upsert',
      paragraphId,
      styleId: 1,
      cascadeOrder: 0,
      start: 0,
      end: text.length,
      root: true,
      value: engineStyleValue(properties.style ?? {}, properties.paint, 0, text.length, {
        fontStackHandle: rootStack,
        ...(rootMaterialId === undefined ? {} : { materialId: rootMaterialId }),
        fontSize: properties.style?.fontSize ?? 16,
        rasterPixelRatio: properties.rasterPixelRatio ?? 1,
      }),
    },
  ];
  for (const [index, span] of styledSpans(properties.spans).entries()) {
    const fontStackHandle = span.font === undefined ? undefined : acquireEngineStack(coordinator, span.font, leases);
    const materialId = acquireEngineMaterial(coordinator, span.material, materialLeases);
    styles.push({
      opcode: 'upsert',
      paragraphId,
      styleId: index + 2,
      cascadeOrder: index + 1,
      start: span.start,
      end: span.end,
      value: engineStyleValue(span.style ?? {}, span.paint, span.start, span.end, {
        ...(fontStackHandle === undefined ? {} : { fontStackHandle }),
        ...(materialId === undefined ? {} : { materialId }),
      }),
    });
  }
  return styles;
}

function acquireEngineMaterial(
  coordinator: ThreeTextEngineCoordinator,
  material: ThreeTextMaterial | undefined,
  leases: ThreeTextMaterialLease[],
): number | undefined {
  if (material === undefined) return undefined;
  const lease = coordinator.acquireMaterial(material);
  leases.push(lease);
  return lease.id;
}

function acquireEngineStack<Technique extends AnyRasterTechnique>(
  coordinator: ThreeTextEngineCoordinator,
  selection: FontSelection<Technique>,
  leases: ThreeTextEngineStackLease[],
): number {
  const fonts = concreteFonts(selection) as readonly [
    LoadedFont<AnyRasterTechnique>,
    ...LoadedFont<AnyRasterTechnique>[],
  ];
  const lease = coordinator.acquireFontStack(fonts);
  leases.push(lease);
  return lease.handle;
}

function releaseStackLeases(leases: readonly ThreeTextEngineStackLease[]): void {
  for (const lease of leases) lease.release();
}

function releaseMaterialLeases(leases: readonly ThreeTextMaterialLease[]): void {
  for (const lease of leases) lease.release();
}

function ownPublication(publication: TextEnginePublication): TextEnginePublication {
  const bytes = publication.bytes.slice();
  return { ...publication, bytes, memoryBuffer: bytes.buffer, memoryGrew: false };
}

function classifySemanticChanges<Technique extends AnyRasterTechnique>(update: TextUpdate<Technique>): number {
  let changes = 0;
  if (Object.hasOwn(update, 'text')) changes |= TEXT_CHANGE | STYLE_CHANGE | GEOMETRY_CHANGE;
  if (
    Object.hasOwn(update, 'font') ||
    Object.hasOwn(update, 'spans') ||
    Object.hasOwn(update, 'style') ||
    Object.hasOwn(update, 'paint') ||
    Object.hasOwn(update, 'rasterPixelRatio') ||
    Object.hasOwn(update, 'material')
  ) {
    changes |= STYLE_CHANGE;
  }
  if (Object.hasOwn(update, 'contentBox')) changes |= GEOMETRY_CHANGE;
  return changes;
}

/**
 * The single place span offsets are resolved onto the cluster grid, and the only place they are
 * segmented.
 *
 * `previous` is the state this one supersedes, when there is one. Its `text` and `spans` are
 * already resolved, so when the update carries neither of them forward by a new identity the grid
 * cannot have moved and no segmentation is performed: a `set({ paint })` on a styled paragraph
 * costs nothing. `set()` merges over `#desired`, so an unstated `spans` arrives as the very array
 * stored on `previous` and this comparison is exact rather than approximate.
 */
function normalizeDesired<Technique extends AnyRasterTechnique>(
  properties: TextProperties<Technique>,
  previous?: DesiredTextState<Technique>,
): DesiredTextState<Technique> {
  if (properties === undefined) throw new TypeError('Text properties are required');
  // Column geometry is validated here so an impossible combination fails at
  // construction or set() instead of surfacing later as a bind-time error.
  normalizedColumns(properties.contentBox);
  const formatted = typeof properties.text === 'string' ? undefined : (properties.text as FormattedText<Technique>);
  const text = formatted?.text ?? (properties.text as string);
  const stated = (formatted?.spans as readonly TextSpan<Technique>[]) ?? properties.spans ?? [];
  const resolved =
    previous !== undefined && previous.text === text && previous.spans === stated
      ? stated
      : alignSpansToClusters(text, assertSpanRanges(text, stated));
  // Each retained span is frozen, not just the array holding them. `Text.spans` hands these
  // objects to the caller, and the identity short-circuit above trusts that an unchanged array
  // still describes cluster-aligned ranges; a mutable span record would let `spans[0].end = 1`
  // skip alignment and reinstate the split this resolution exists to prevent.
  const spans =
    resolved === previous?.spans ? previous.spans : Object.freeze(resolved.map((span) => Object.freeze({ ...span })));
  return Object.freeze({
    font: properties.font,
    text,
    spans,
    contentBox: Object.freeze({ ...(properties.contentBox ?? {}) }),
    style: Object.freeze({ ...(properties.style ?? {}) }),
    paint: Object.freeze({ ...(properties.paint ?? {}) }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
    ...(properties.material === undefined ? {} : { material: properties.material }),
  });
}
/**
 * The two span invariants the caller owns, checked where the stack still points at the caller.
 *
 * A span carries four invariants and they are NOT alike:
 *
 * - INVERTED and OUT-OF-RANGE offsets are arithmetic errors. Nothing can repair them -- there is no
 *   range the caller meant -- and forwarding one only produced a rejected frame with a numeric
 *   status naming nothing, recompiled every frame. They throw here for the same reason
 *   `normalizedColumns` and `normalizeCapacity` throw here: `set()` is where the caller is.
 * - CLUSTER ALIGNMENT is not an error at all. A boundary inside an extended grapheme cluster has a
 *   correct answer -- the cluster takes the style of its base, CSSOM View's normative rule -- so it
 *   resolves silently through `alignSpansToClusters` (D-265).
 * - COLLAPSED spans stay in the array and are dropped where styles are COMPILED (`styledSpans`).
 *   Dropping them here would renumber every later span behind the caller's back, and `Text.spans`
 *   would stop reporting a span the caller wrote.
 * - DISJOINT-OR-NESTED is not checked here. It is a relation over the whole array rather than one
 *   span's own arithmetic, and the engine already answers it exactly, now as a named rejection
 *   (`styleNestingInvalid`) that resolves back to the offending span.
 *
 * The argument array is returned by identity so the caller-side fast path in `normalizeDesired` is
 * unaffected: an unchanged `spans` identity skips this walk entirely.
 */
/**
 * Rejects, at the call site, every span shape the engine would refuse a whole frame for.
 *
 * The engine's rejections are meant to be invariants this package broke, not caller mistakes. Each
 * check below closes a path a caller could otherwise reach: the offending value is named here, with
 * the caller still on the stack, instead of surfacing a frame later as a status with no subject.
 */
function assertSpanRanges<Technique extends AnyRasterTechnique>(
  text: string,
  spans: readonly ParagraphSpan<Technique>[],
): readonly ParagraphSpan<Technique>[] {
  assertPairedSurrogates(text);
  for (const [index, span] of spans.entries()) {
    assertRange(`span ${index}`, span.start, span.end, text.length);
    assertFeatureRanges(`span ${index}`, span.style?.features, text.length);
  }
  assertSpansNest(spans);
  return spans;
}

/**
 * A feature range is optional and defaults to the span it rides, so only a stated one is checked.
 * Before this, the outer span range was validated and the feature range inside it was copied
 * through, so a malformed one was refused by the engine naming neither the span nor the feature.
 */
function assertFeatureRanges(subject: string, features: readonly FontFeature[] | undefined, length: number): void {
  for (const [position, feature] of (features ?? []).entries()) {
    if (feature.start === undefined && feature.end === undefined) continue;
    assertRange(`${subject} feature ${position} (${feature.tag})`, feature.start ?? 0, feature.end ?? length, length);
  }
}

function assertRange(subject: string, start: number, end: number, length: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new RangeError(`${subject} offsets must be integers, received (${start}, ${end})`);
  }
  if (start > end) throw new RangeError(`${subject} is inverted: start ${start} is after end ${end}`);
  if (start < 0 || end > length) {
    throw new RangeError(`${subject} covers [${start}, ${end}) outside text of length ${length}`);
  }
}

/**
 * A style scope is a stack, so two spans must nest or be disjoint; a partial overlap has no
 * well-defined resolution and the engine refuses the frame for it (`style_state.rs`, `resolve`).
 *
 * Overlapping ranges are a natural way to author rich text, and refusing them is a real limitation
 * rather than a virtue -- resolving them per cluster by cascade order would be the better surface.
 * Until that exists, the refusal belongs here, where both offending spans can be named, rather than
 * arriving as a frame status that identifies neither.
 */
function assertSpansNest<Technique extends AnyRasterTechnique>(spans: readonly ParagraphSpan<Technique>[]): void {
  const order = spans
    .map((span, index) => ({ span, index }))
    .filter((entry) => entry.span.start !== entry.span.end)
    .sort((left, right) => left.span.start - right.span.start || right.span.end - left.span.end);
  const open: { end: number; index: number }[] = [];
  for (const { span, index } of order) {
    while (open.length !== 0 && span.start >= open[open.length - 1]!.end) open.pop();
    const enclosing = open[open.length - 1];
    if (enclosing !== undefined && span.end > enclosing.end) {
      throw new RangeError(
        `span ${index} [${span.start}, ${span.end}) partially overlaps span ${enclosing.index}: ` +
          `spans must nest or be disjoint, so end it at or before ${enclosing.end}, or start it at or after it`,
      );
    }
    open.push({ end: span.end, index });
  }
  const seen = new Map<string, number>();
  for (const [index, span] of spans.entries()) {
    if (span.start === span.end) continue;
    // Cascade order is the authored array index, so an identical range at a different index is a
    // legitimate re-statement; only a genuine duplicate of both is refused.
    const key = `${span.start}:${span.end}`;
    const first = seen.get(key);
    if (first !== undefined) {
      throw new RangeError(
        `span ${index} duplicates span ${first}: two spans over [${span.start}, ${span.end}) cannot both be resolved`,
      );
    }
    seen.set(key, index);
  }
}

/**
 * A lone surrogate is not a character, and shaping refuses the frame that carries one. It was
 * deliberately left for the engine; naming the offset here is what a caller can act on.
 */
function assertPairedSurrogates(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const isHigh = unit <= 0xdbff;
    const next = isHigh ? text.charCodeAt(index + 1) : Number.NaN;
    if (isHigh && next >= 0xdc00 && next <= 0xdfff) {
      index += 1;
      continue;
    }
    throw new RangeError(
      `text offset ${index} is an unpaired ${isHigh ? 'high' : 'low'} surrogate (0x${unit.toString(16)})`,
    );
  }
}
function selectedFonts<Technique extends AnyRasterTechnique>(
  state: DesiredTextState<Technique>,
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
function normalizeCapacity(value: GlyphBufferCapacity): GlyphBufferCapacity {
  if (!Number.isSafeInteger(value.size) || value.size <= 0)
    throw new RangeError('glyph capacity size must be positive');
  if (value.policy !== 'grow' && value.policy !== 'chunk' && value.policy !== 'fixed') {
    throw new TypeError('glyph capacity policy is invalid');
  }
  return Object.freeze({ size: value.size, policy: value.policy });
}
function normalizeCompositing(value: TextGroupOptions['compositing']): 'ordered' | 'independent' {
  if (value === undefined || value === 'ordered') return 'ordered';
  if (value === 'independent') return value;
  throw new TypeError('text group compositing mode is invalid');
}
function normalizePixelSnapping(value: boolean | undefined): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new TypeError('pixel snapping must be a boolean');
}
function nearestTextGroup(object: THREE.Object3D): TextGroup | undefined {
  let parent = object.parent;
  while (parent !== null) {
    if (parent instanceof TextGroup) return parent;
    parent = parent.parent;
  }
  return undefined;
}
function eraseTextTechnique<Technique extends AnyRasterTechnique>(text: Text<Technique>): Text<AnyRasterTechnique> {
  return text as unknown as Text<AnyRasterTechnique>;
}
function collectTextDescendants(group: TextGroup, texts: Text<AnyRasterTechnique>[]): Text<AnyRasterTechnique>[] {
  texts.length = 0;
  for (const child of group.children) collect(child, texts);
  return texts;
  function collect(object: THREE.Object3D, result: Text<AnyRasterTechnique>[]): void {
    if (object instanceof TextGroup) return;
    if (object instanceof Text && !object.disposed) result.push(object as Text<AnyRasterTechnique>);
    for (const child of object.children) collect(child, result);
  }
}

interface ObservedTextTransform {
  readonly matrix: Float64Array;
  parent: THREE.Object3D | null;
  visible: boolean;
  frame: number;
  changed: boolean;
}

class TextTransformTracker {
  readonly #observed = new WeakMap<THREE.Object3D, ObservedTextTransform>();
  #frame = 0;

  beginFrame(): void {
    this.#frame += 1;
  }

  pathChanged(text: Text<AnyRasterTechnique>, boundary: TextGroup): boolean {
    let changed = false;
    let object: THREE.Object3D | null = text;
    while (object !== null && object !== boundary) {
      if (this.#objectChanged(object)) changed = true;
      object = object.parent;
    }
    return object !== boundary || changed;
  }

  #objectChanged(object: THREE.Object3D): boolean {
    const existing = this.#observed.get(object);
    if (existing?.frame === this.#frame) return existing.changed;
    const elements = object.matrix.elements;
    let changed = existing === undefined || existing.parent !== object.parent || existing.visible !== object.visible;
    if (existing === undefined) {
      const matrix = new Float64Array(elements);
      this.#observed.set(object, {
        matrix,
        parent: object.parent,
        visible: object.visible,
        frame: this.#frame,
        changed: true,
      });
      return true;
    }
    for (let index = 0; index < 16; index += 1) {
      if (existing.matrix[index] === elements[index]) continue;
      existing.matrix[index] = elements[index]!;
      changed = true;
    }
    existing.parent = object.parent;
    existing.visible = object.visible;
    existing.frame = this.#frame;
    existing.changed = changed;
    return changed;
  }
}
function validateText(text: Text<AnyRasterTechnique>): void {
  validateBinding(reconciler.runtime(text), text);
}
function validateBinding(runtime: TextRuntime, text: Text<AnyRasterTechnique>): void {
  if (text.disposed) throw new TypeError('disposed text cannot be attached');
  const own = reconciler.runtime(text);
  if (own !== runtime) throw new TypeError('text belongs to another Three font-cache domain');
  assertFontSelectionForRuntime(text.font, own);
}
