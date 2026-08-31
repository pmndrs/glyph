import * as THREE from 'three/webgpu';

import { alignSpansToClusters, type FormattedText, type ParagraphSpan, type TextInput } from '../formatted-text.js';
import { createGlyphPlacements, type GlyphCaret, type GlyphPlacements } from '../glyph-placement.js';
import {
  copyGlyphLayoutInspection,
  type LayoutBox,
  type GlyphLayoutInspection,
  type ParagraphLayoutSummary,
} from '../layout.js';
import { immutableFontSelectionFonts, type FontSelection } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { mergePropertyList } from '../property-list.js';
import type {
  GlyphBufferCapacity,
  ParagraphBaseProperties,
  Constraints,
  ParagraphLayout,
  PropertyList,
  TextStyle,
} from '../text-properties.js';
import {
  assertConstraints,
  assertParagraphLayout,
  assertTextStyle,
  assertTextStyleFeatureRanges,
} from '../text-properties.js';
import { assertTextEffectsSupported, normalizedColumns, replacedContent } from '../engine-encoding.js';
import type {
  BackendFontStackBinding,
  BackendTransformBinding,
  RenderPlanner,
  PlanTarget,
  RetainedFormattedText,
  RetainedText,
  RetainedTextOptions,
} from '../core.js';
import { ThreeTextRenderPlanExecutor } from './engine-plan-target.js';
import { type ThreeMaterialBindingLease, type ThreeTextEngineCoordinator } from './engine-coordinator.js';
import type { ThreeTextMaterial } from './material.js';
import { acquireThreeTextDomain, type ThreeEngineDomainLease } from './engine-domain.js';
import {
  measureGlyphPlacements,
  type ThreeGlyphGeometrySource,
  type ThreeGlyphMeasurement,
} from './glyph-measurement.js';
import { createGlyphs, type Glyphs } from './glyphs.js';
import { createDecorations, type Decorations } from './decorations.js';

const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_UNITS = 65_536;
const MAX_PARAGRAPHS = 4_096;
const MAX_REGIONS = MAX_PARAGRAPHS * 16;
const PLAN_REQUEST_BYTES = 64 * 1024;
const PLAN_RESULT_BYTES = 256 * 1024;
const MIN_PLAN_TEXT_UNITS = 256;

const THREE_TEXT_LIMITS = Object.freeze({
  maxParagraphs: MAX_PARAGRAPHS,
  maxClusters: MAX_TEXT_UNITS,
  maxLines: MAX_TEXT_UNITS,
  maxRegions: MAX_REGIONS,
  maxExclusions: 1,
  maxInlineObjects: 1,
  maxSlotsPerBand: 8,
  maxOutputBytes: MAX_TEXT_ENGINE_OUTPUT_BYTES,
});

/** One inline Three text run with optional font fallback and material override. */
export type TextSpan<Technique extends AnyRasterTechnique> = Omit<ParagraphSpan<Technique>, 'font'> &
  Readonly<{ font?: FontSelection<Technique>; material?: ThreeTextMaterial }>;

type TextBaseProperties<Technique extends AnyRasterTechnique> = Omit<ParagraphBaseProperties<Technique>, 'font'> &
  Readonly<{ font: FontSelection<Technique> }>;

type TextContentProperties<Technique extends AnyRasterTechnique> =
  | Readonly<{ text: string; spans?: readonly TextSpan<Technique>[] }>
  | Readonly<{ text: FormattedText<Technique>; spans?: never }>;

/** Complete desired state for one Three text paragraph. */
export type TextProperties<Technique extends AnyRasterTechnique> = TextBaseProperties<Technique> &
  TextContentProperties<Technique> &
  Readonly<{ material?: ThreeTextMaterial }>;

/** Standalone Three text state plus optional retained-capacity and pixel-snap controls. */
export type StandaloneTextProperties<Technique extends AnyRasterTechnique> = TextProperties<Technique> &
  Readonly<{ capacity?: GlyphBufferCapacity; pixelSnapping?: boolean }>;

/** Partial desired-state replacement accepted by {@link Text.set}. */
export type TextUpdate<Technique extends AnyRasterTechnique> =
  | (Partial<TextBaseProperties<Technique>> &
      Readonly<{ text?: string; spans?: readonly TextSpan<Technique>[]; material?: ThreeTextMaterial }>)
  | (Partial<TextBaseProperties<Technique>> &
      Readonly<{ text: FormattedText<Technique>; spans?: never; material?: ThreeTextMaterial }>);

/** Construction options for one Three retained text batching boundary. */
export interface TextGroupOptions {
  readonly capacity?: GlyphBufferCapacity;
  /** Allows Rust to reorder compatible draws when descendants do not require compositing order. */
  readonly compositing?: 'ordered' | 'independent';
  readonly renderOrder?: number;
  readonly material?: ThreeTextMaterial;
  /** Snap Bitmap vertices to physical pixels. */
  readonly pixelSnapping?: boolean;
}

/** Observable publication state of one Three text instance. */
export type TextCommitState =
  | Readonly<{ status: 'unbound' }>
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'committed'; revision: number }>
  | Readonly<{ status: 'failed'; error: unknown }>;

interface DesiredTextState<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly TextSpan<Technique>[];
  readonly style: TextStyle;
  readonly layout: ParagraphLayout;
  readonly constraints: Constraints;
  readonly rasterPixelRatio?: number;
  readonly material?: ThreeTextMaterial;
}

interface TextFontBindings {
  readonly root: BackendFontStackBinding;
  readonly spans: ReadonlyMap<number, BackendFontStackBinding>;
}

interface TextReconciler {
  coordinator(text: Text<AnyRasterTechnique>): ThreeTextEngineCoordinator;
  acquireDomain(text: Text<AnyRasterTechnique>): ThreeEngineDomainLease;
  transform(text: Text<AnyRasterTechnique>): BackendTransformBinding;
  desired<Technique extends AnyRasterTechnique>(text: Text<Technique>): DesiredTextState<Technique>;
  fontBindings(text: Text<AnyRasterTechnique>): TextFontBindings;
  desiredRevision(text: Text<AnyRasterTechnique>): number;
  markCommitted(text: Text<AnyRasterTechnique>): void;
  publishMeasurement(text: Text<AnyRasterTechnique>, measurement: ParagraphLayoutSummary): void;
  bind(text: Text<AnyRasterTechnique>, binding: ThreeTextBatchBinding, group: TextGroup | undefined): void;
  unbindFrom(text: Text<AnyRasterTechnique>, binding: ThreeTextBatchBinding): void;
}

let reconciler!: TextReconciler;

interface TextGroupReconciler {
  measurement(group: TextGroup, text: Text<AnyRasterTechnique>): ParagraphLayoutSummary;
  inspection(group: TextGroup, text: Text<AnyRasterTechnique>): GlyphLayoutInspection;
}

let groupReconciler!: TextGroupReconciler;

export class Text<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  static {
    reconciler = {
      coordinator: (text) => text.#domain.coordinator,
      acquireDomain: (text) => text.#acquireDomain(),
      transform: (text) => text.#transform,
      desired: (text) => text.#desired,
      fontBindings: (text) => text.#fontBindings,
      desiredRevision: (text) => text.#desiredRevision,
      markCommitted: (text) => text.#markCommitted(),
      publishMeasurement: (text, measurement) => text.#setBoundingBox(measurement),
      bind: (text, binding, group) => text.#bind(binding, group),
      unbindFrom: (text, binding) => text.#unbindFrom(binding),
    };
  }

  readonly #domain: ThreeEngineDomainLease;
  readonly #transform: BackendTransformBinding;
  readonly #boundingBox = new THREE.Box3();
  #desired: DesiredTextState<Technique>;
  #fontBindings: TextFontBindings;
  #standaloneCapacity: GlyphBufferCapacity;
  readonly #pixelSnapping: boolean;
  #binding: ThreeTextBatchBinding | undefined;
  #textGroup: TextGroup | undefined;
  #desiredRevision = 0;
  #committedRevision = -1;
  #boundingBoxCurrent = false;
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(properties: StandaloneTextProperties<Technique>) {
    super();
    const desired = normalizeDesired(properties);
    const domain = acquireThreeTextDomain(fontSelections(desired));
    let transform: BackendTransformBinding | undefined;
    let fontBindings: TextFontBindings | undefined;
    try {
      transform = domain.coordinator.bindTransform(this);
      fontBindings = bindFonts(domain.coordinator, desired);
    } catch (error) {
      transform?.dispose();
      domain.dispose();
      throw error;
    }
    this.#domain = domain;
    this.#transform = transform;
    this.#fontBindings = fontBindings;
    this.#desired = desired;
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
  get boundingBox(): THREE.Box3 {
    return this.computeBoundingBox();
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
  /** Text shaping and presentation properties inherited by inline spans. */
  get style(): TextStyle {
    return this.#desired.style;
  }
  set style(value: PropertyList<TextStyle>) {
    this.set({ style: value });
  }
  /** Paragraph flow properties such as wrapping, alignment, and line limits. */
  get layout(): ParagraphLayout {
    return this.#desired.layout;
  }
  set layout(value: PropertyList<ParagraphLayout>) {
    this.set({ layout: value });
  }
  get constraints(): Constraints {
    return this.#desired.constraints;
  }
  set constraints(value: PropertyList<Constraints>) {
    this.set({ constraints: value });
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
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('Text update must be an object');
    }
    const normalizedUpdate = replacedContent(update);
    if (Reflect.ownKeys(normalizedUpdate).length === 0) return;
    const next = normalizeDesired(
      { ...this.#desired, ...normalizedUpdate } as TextProperties<Technique>,
      this.#desired,
    );
    const fontsChanged = next.font !== this.#desired.font || next.spans !== this.#desired.spans;
    const nextFontBindings = fontsChanged ? bindFonts(this.#domain.coordinator, next) : this.#fontBindings;
    const nextRevision = checkedNextRevision(this.#desiredRevision);
    try {
      this.#binding?.stageUpdate(
        eraseTextTechnique(this),
        next as DesiredTextState<AnyRasterTechnique>,
        nextFontBindings,
        nextRevision,
      );
    } catch (error) {
      if (fontsChanged) disposeFontBindings(nextFontBindings);
      throw error;
    }
    const previousBindings = this.#fontBindings;
    this.#desired = next;
    this.#fontBindings = nextFontBindings;
    this.#desiredRevision = nextRevision;
    this.#boundingBox.makeEmpty();
    this.#boundingBoxCurrent = false;
    if (fontsChanged) disposeFontBindings(previousBindings);
  }

  setCapacity(capacity: GlyphBufferCapacity): void {
    this.#assertActive();
    this.#standaloneCapacity = normalizeCapacity(capacity);
    if (this.#textGroup === undefined) this.#binding?.setCapacity(this.#standaloneCapacity);
  }

  /**
   * Measure current desired text without scene attachment or matrix traversal.
   * A cache miss may synchronously incur font and measure lookup work in the text engine.
   */
  measure(): ParagraphLayoutSummary {
    this.#assertActive();
    const text = eraseTextTechnique(this);
    const boundary = nearestTextGroup(this);
    const measurement =
      boundary === undefined
        ? this.#standaloneBinding().measurement(text)
        : groupReconciler.measurement(boundary, text);
    this.#setBoundingBox(measurement);
    return measurement;
  }

  /**
   * Return caller-owned positioned glyph and line columns without requiring a rendered frame.
   * A cache miss may synchronously incur glyph lookup and positioning work; every call copies the columns.
   */
  glyphs(): GlyphLayoutInspection {
    this.#assertActive();
    const text = eraseTextTechnique(this);
    const boundary = nearestTextGroup(this);
    const inspection =
      boundary === undefined ? this.#standaloneBinding().inspection(text) : groupReconciler.inspection(boundary, text);
    this.#setBoundingBox(inspection);
    return inspection;
  }

  commitState(): TextCommitState {
    if (this.#disposed || this.parent === null) return { status: 'unbound' };
    const error = this.error;
    if (error !== undefined) return { status: 'failed', error };
    if (this.#binding === undefined || this.#committedRevision !== this.#desiredRevision) {
      return { status: 'pending' };
    }
    return { status: 'committed', revision: this.#committedRevision };
  }

  computeBoundingBox(): THREE.Box3 {
    if (!this.#boundingBoxCurrent) this.#setBoundingBox(this.glyphs());
    return this.#boundingBox;
  }

  #glyphPlacements(): GlyphPlacements | undefined {
    this.#assertActive();
    return this.#binding?.glyphPlacements(eraseTextTechnique(this));
  }

  /** Measures each currently displayed glyph in Text-local and world space. */
  measureGlyphs(): readonly ThreeGlyphMeasurement[] | undefined {
    const placements = this.#glyphPlacements();
    if (placements === undefined) return undefined;
    this.updateWorldMatrix(true, false);
    return measureGlyphPlacements(placements, this.matrixWorld, this.#glyphGeometry(placements));
  }

  /** Copies the committed glyphs and optional decorations into independently rendered Three objects. */
  breakApart(): readonly [glyphs: Glyphs, decorations: Decorations | undefined] {
    this.#assertActive();
    this.#assertDetachedCopyAvailable('break apart');
    const placements = this.#glyphPlacements();
    if (placements === undefined) throw new Error('cannot break apart text before a committed layout is available');
    const binding = this.#binding;
    if (binding === undefined) throw new Error('cannot break apart an unbound text paragraph');
    const incomplete = new Set(placements.incomplete);
    const drawable = placements.glyphs.filter((placement) => !incomplete.has(placement.index));
    const stableIds = new Uint32Array(drawable.length);
    for (const [index, placement] of drawable.entries()) {
      const stableId = placements.layout.glyphStableIds[placement.index];
      if (stableId === undefined) throw new Error(`drawable glyph ${placement.index} has no stable id`);
      stableIds[index] = stableId;
    }
    if (stableIds.length === 0) throw new Error('cannot break apart text with no drawable glyphs');
    this.updateWorldMatrix(true, false, true);
    const source = this as unknown as Text<AnyRasterTechnique>;
    const glyphs = createGlyphs({
      source,
      placements,
      matrixWorld: this.matrixWorld,
      geometry: this.#glyphGeometry(placements),
      domain: this.#acquireDomain(),
      copy: (target) => binding.copyGlyphs(eraseTextTechnique(this), stableIds, target),
    });
    try {
      const decorations = createDecorations({
        source,
        domain: this.#acquireDomain(),
        copy: (target) => binding.copyDecorations(eraseTextTechnique(this), target),
      });
      return Object.freeze([glyphs, decorations] as const);
    } catch (error) {
      glyphs.dispose();
      throw error;
    }
  }

  #assertDetachedCopyAvailable(operation: string): void {
    const state = this.commitState();
    if (state.status === 'committed') return;
    if (state.status === 'failed')
      throw new Error(`cannot ${operation} text after renderer realization failed`, { cause: state.error });
    throw new Error(`cannot ${operation} text before its renderer state is committed`);
  }

  #glyphGeometry(placements: GlyphPlacements): ReadonlyMap<number, ThreeGlyphGeometrySource> {
    const sourceByStableId = this.#binding?.glyphGeometry(placements.layout.glyphStableIds);
    if (sourceByStableId === undefined) return new Map();
    const sourceByIndex = new Map<number, ThreeGlyphGeometrySource>();
    for (let index = 0; index < placements.glyphs.length; index += 1) {
      const stableId = placements.layout.glyphStableIds[index];
      const source = stableId === undefined ? undefined : sourceByStableId.get(stableId);
      if (source !== undefined) sourceByIndex.set(index, source);
    }
    return sourceByIndex;
  }

  caretAt(x: number, y: number): GlyphCaret | undefined {
    return this.#glyphPlacements()?.caretAt(x, y);
  }

  selectionRects(start: number, end: number): readonly LayoutBox[] | undefined {
    return this.#glyphPlacements()?.selectionRects(start, end);
  }

  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);
    if (this.#disposed) return;
    const boundary = nearestTextGroup(this);
    if (boundary?.disposed) {
      this.#unbind();
      return;
    }
    if (boundary !== undefined) return;
    if (this.parent === null) {
      this.#unbind();
      return;
    }
    const binding = this.#standaloneBinding();
    binding.reconcile([eraseTextTechnique(this)]);
    try {
      binding.synchronize(true);
      if (!binding.hasRejectedRendererUpdate) this.#error = undefined;
    } catch (error) {
      this.#error = error;
      this.onError?.(error);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unbind();
    disposeFontBindings(this.#fontBindings);
    this.#transform.dispose();
    this.#domain.dispose();
  }

  #standaloneBinding(): ThreeTextBatchBinding {
    if (this.#binding === undefined || this.#textGroup !== undefined) {
      this.#unbind();
      this.#binding = new ThreeTextBatchBinding(eraseTextTechnique(this), this.#standaloneCapacity, undefined);
    }
    this.#binding.reconcile([eraseTextTechnique(this)]);
    return this.#binding;
  }

  #acquireDomain(): ThreeEngineDomainLease {
    return this.#domain.retain();
  }

  #markCommitted(): void {
    this.#committedRevision = this.#desiredRevision;
  }

  #setBoundingBox(measurement: ParagraphLayoutSummary): void {
    const bounds = measurement.inkBounds;
    if (bounds === undefined) {
      this.#boundingBox.makeEmpty();
      this.#boundingBoxCurrent = false;
      return;
    }
    this.#boundingBox.min.set(bounds.x, -(bounds.y + bounds.height), 0);
    this.#boundingBox.max.set(bounds.x + bounds.width, -bounds.y, 0);
    this.#boundingBoxCurrent = true;
  }

  #bind(binding: ThreeTextBatchBinding, group: TextGroup | undefined): void {
    if (this.#binding !== binding) this.#unbind();
    this.#binding = binding;
    this.#textGroup = group;
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
    if (this.#disposed) throw new Error('Text has been disposed');
  }
}

export class TextGroup extends THREE.Object3D {
  static {
    groupReconciler = {
      measurement: (group, text) => group.#measurement(text),
      inspection: (group, text) => group.#inspection(text),
    };
  }

  #capacity: GlyphBufferCapacity;
  readonly #compositing: 'ordered' | 'independent';
  readonly #pixelSnapping: boolean;
  #material: ThreeTextMaterial | undefined;
  #binding: ThreeTextBatchBinding | undefined;
  readonly #texts: Text<AnyRasterTechnique>[] = [];
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(options: TextGroupOptions = {}) {
    super();
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('TextGroup options must be an object');
    }
    this.#capacity = normalizeCapacity(options.capacity ?? { size: 4_096, policy: 'chunk' });
    this.#compositing = normalizeCompositing(options.compositing);
    this.#pixelSnapping = normalizePixelSnapping(options.pixelSnapping);
    this.#material = options.material;
    if (options.renderOrder !== undefined) {
      if (!Number.isFinite(options.renderOrder)) throw new RangeError('TextGroup renderOrder must be finite');
      this.renderOrder = options.renderOrder;
    }
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
    this.#assertActive();
    this.#material = value;
    this.#binding?.invalidateMaterial();
  }

  override add(...children: THREE.Object3D[]): this {
    this.#assertActive();
    const existing = collectTextDescendants(this, []);
    const incoming: Text<AnyRasterTechnique>[] = [];
    for (const child of children) collectTextTree(child, incoming);
    validateTextDomains([...existing, ...incoming]);
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
    if (this.#disposed) return;
    const texts = collectTextDescendants(this, this.#texts);
    try {
      if (texts.length === 0) {
        if (this.#binding !== undefined) {
          this.#binding.reconcile([]);
          this.#binding.synchronize(true);
        }
      } else {
        validateTextDomains(texts);
        this.#binding ??= new ThreeTextBatchBinding(texts[0]!, this.#capacity, this);
        this.#binding.reconcile(texts);
        this.#binding.synchronize(true);
      }
      if (!this.#binding?.hasRejectedRendererUpdate) this.#error = undefined;
    } catch (error) {
      this.#error = error;
      this.onError?.(error);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#binding?.dispose();
    this.#binding = undefined;
  }

  #measurement(text: Text<AnyRasterTechnique>): ParagraphLayoutSummary {
    this.#assertActive();
    const texts = collectTextDescendants(this, this.#texts);
    if (!texts.includes(text)) throw new Error('Text must remain attached to its TextGroup for measurement');
    validateTextDomains(texts);
    this.#binding ??= new ThreeTextBatchBinding(texts[0]!, this.#capacity, this);
    this.#binding.reconcile(texts);
    return this.#binding.measurement(text);
  }

  #inspection(text: Text<AnyRasterTechnique>): GlyphLayoutInspection {
    this.#assertActive();
    const texts = collectTextDescendants(this, this.#texts);
    if (!texts.includes(text)) throw new Error('Text must remain attached to its TextGroup for inspection');
    validateTextDomains(texts);
    this.#binding ??= new ThreeTextBatchBinding(texts[0]!, this.#capacity, this);
    this.#binding.reconcile(texts);
    return this.#binding.inspection(text);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('TextGroup has been disposed');
  }
}

interface BoundTextEntry {
  readonly handle: RetainedText;
  readonly transform: BackendTransformBinding;
  materialLeases: readonly ThreeMaterialBindingLease[];
  stagedRevision: number;
  stagedOrder: number;
  committedRevision: number;
}

interface CanonicalInspection {
  readonly revision: number;
  readonly value: GlyphLayoutInspection;
}

class ThreeTextBatchBinding {
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #domain: ThreeEngineDomainLease;
  readonly #group: TextGroup | undefined;
  readonly #planner: RenderPlanner;
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #entries = new Map<Text<AnyRasterTechnique>, BoundTextEntry>();
  readonly #inspections = new Map<Text<AnyRasterTechnique>, CanonicalInspection>();
  #capacity: GlyphBufferCapacity;
  #pendingPublication = false;
  #rendererUpdateRejected = false;
  #capacityExceeded: { readonly required: number; readonly size: number } | undefined;
  #materialInvalidated = false;
  #disposed = false;

  constructor(seed: Text<AnyRasterTechnique>, capacity: GlyphBufferCapacity, group: TextGroup | undefined) {
    this.#coordinator = reconciler.coordinator(seed);
    this.#domain = reconciler.acquireDomain(seed);
    this.#group = group;
    this.#capacity = capacity;
    const drawRoot = group ?? seed;
    const owner = {
      drawRoot,
      pixelSnapping: group?.pixelSnapping ?? seed.pixelSnapping,
      get renderOrderBase(): number {
        return group?.renderOrder ?? seed.renderOrder;
      },
    };
    let target: ThreeTextRenderPlanExecutor | undefined;
    try {
      this.#planner = this.#coordinator.backend.createPlanner({
        policy: this.#coordinator.policy,
        capabilitySet: this.#coordinator.capabilitySet,
        target: () => {
          target = new ThreeTextRenderPlanExecutor(this.#coordinator, owner);
          return target;
        },
        limits: THREE_TEXT_LIMITS,
        requestCapacity: PLAN_REQUEST_BYTES,
        resultCapacity: PLAN_RESULT_BYTES,
        textCapacity: MIN_PLAN_TEXT_UNITS,
      });
      if (target === undefined) throw new Error('Three render planner did not construct its plan target');
      this.#target = target;
    } catch (error) {
      this.#domain.dispose();
      throw error;
    }
  }

  get textCount(): number {
    return this.#entries.size;
  }
  get coordinator(): ThreeTextEngineCoordinator {
    return this.#coordinator;
  }
  get gpuBytes(): number {
    return this.#target.gpuBytes;
  }
  get hasRejectedRendererUpdate(): boolean {
    return this.#rendererUpdateRejected;
  }
  get capacityExceeded(): { readonly required: number; readonly size: number } | undefined {
    return this.#capacityExceeded;
  }

  setCapacity(capacity: GlyphBufferCapacity): void {
    this.#assertActive();
    this.#capacity = capacity;
    if (this.#capacityExceeded !== undefined) this.#pendingPublication = true;
  }

  invalidateMaterial(): void {
    this.#assertActive();
    this.#materialInvalidated = true;
  }

  reconcile(texts: readonly Text<AnyRasterTechnique>[]): void {
    this.#assertActive();
    const ordered = orderedTexts(texts);
    const desired = new Set(ordered);
    for (const text of [...this.#entries.keys()]) {
      if (!desired.has(text)) this.removeText(text);
    }
    for (const [order, text] of ordered.entries()) {
      const entry = this.#entries.get(text);
      const revision = reconciler.desiredRevision(text);
      if (
        entry === undefined ||
        entry.stagedRevision !== revision ||
        entry.stagedOrder !== order ||
        this.#materialInvalidated
      ) {
        this.#stage(text, reconciler.desired(text), reconciler.fontBindings(text), revision, order);
      }
      reconciler.bind(text, this, this.#group);
    }
    this.#materialInvalidated = false;
  }

  stageUpdate(
    text: Text<AnyRasterTechnique>,
    desired: DesiredTextState<AnyRasterTechnique>,
    fontBindings: TextFontBindings,
    revision: number,
  ): void {
    this.#assertActive();
    const entry = this.#entries.get(text);
    if (entry === undefined) return;
    this.#stage(text, desired, fontBindings, revision, entry.stagedOrder);
  }

  removeText(text: Text<AnyRasterTechnique>): void {
    const entry = this.#entries.get(text);
    if (entry === undefined) {
      reconciler.unbindFrom(text, this);
      return;
    }
    entry.handle.dispose();
    for (const lease of entry.materialLeases) lease.dispose();
    this.#entries.delete(text);
    this.#inspections.delete(text);
    this.#pendingPublication = true;
    reconciler.unbindFrom(text, this);
  }

  measurement(text: Text<AnyRasterTechnique>): ParagraphLayoutSummary {
    this.#assertActive();
    this.#coordinator.assertFrameUpdateAllowed();
    this.reconcile(this.#group === undefined ? [text] : collectTextDescendants(this.#group, []));
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('Text is not retained by this batch');
    const measurement = entry.handle.measure();
    reconciler.publishMeasurement(text, measurement);
    return measurement;
  }

  inspection(text: Text<AnyRasterTechnique>): GlyphLayoutInspection {
    this.#assertActive();
    this.#coordinator.assertFrameUpdateAllowed();
    this.reconcile(this.#group === undefined ? [text] : collectTextDescendants(this.#group, []));
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('Text is not retained by this batch');
    const inspection = entry.handle.glyphs();
    reconciler.publishMeasurement(text, inspection);
    return inspection;
  }

  glyphPlacements(text: Text<AnyRasterTechnique>): GlyphPlacements | undefined {
    const layout = this.#canonicalInspection(text);
    if (layout === undefined) return undefined;
    const drawn = this.#target.snapshotGlyphOrigins(layout.glyphStableIds, layout.x, layout.y);
    const placements = createGlyphPlacements(
      copyGlyphLayoutInspection(layout),
      text.text,
      drawn.drawnX,
      drawn.drawnY,
      drawn.incomplete,
    );
    return placements;
  }

  glyphGeometry(stableIds: Uint32Array): ReadonlyMap<number, ThreeGlyphGeometrySource> {
    return this.#target.glyphGeometry(stableIds);
  }

  copyGlyphs(text: Text<AnyRasterTechnique>, stableIds: Uint32Array, target: PlanTarget) {
    this.#assertActive();
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('cannot copy an unbound text paragraph');
    return entry.handle.copyGlyphs(stableIds, target);
  }

  copyDecorations(text: Text<AnyRasterTechnique>, target: PlanTarget) {
    this.#assertActive();
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('cannot copy decorations from an unbound text paragraph');
    return entry.handle.copyDecorations(target);
  }

  synchronize(worldMatricesCurrent: boolean): void {
    this.#assertActive();
    this.#coordinator.assertFrameUpdateAllowed();
    const required = [...this.#entries.keys()].reduce((total, text) => total + text.text.length, 0);
    if (this.#capacity.policy === 'fixed' && required > this.#capacity.size) {
      this.#capacityExceeded = Object.freeze({ required, size: this.#capacity.size });
      this.#target.syncTransforms(undefined, worldMatricesCurrent);
      return;
    }
    this.#capacityExceeded = undefined;
    if (!this.#pendingPublication) {
      this.#target.syncTransforms(undefined, worldMatricesCurrent);
      return;
    }
    const result = this.#planner.publish({
      semanticViews: 'measurement',
      compositing: this.#group?.compositing ?? 'ordered',
    });
    this.#pendingPublication = false;
    if (!result.accepted) {
      this.#rendererUpdateRejected = true;
      throw result.error;
    }
    this.#rendererUpdateRejected = false;
    this.#inspections.clear();
    for (const [text, entry] of this.#entries) {
      entry.committedRevision = entry.stagedRevision;
      reconciler.markCommitted(text);
      reconciler.publishMeasurement(text, entry.handle.measure());
    }
    this.#target.syncTransforms(undefined, worldMatricesCurrent);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const [text, entry] of this.#entries) {
      try {
        entry.handle.dispose();
      } catch (error) {
        failure ??= error;
      }
      for (const lease of entry.materialLeases) {
        try {
          lease.dispose();
        } catch (error) {
          failure ??= error;
        }
      }
      reconciler.unbindFrom(text, this);
    }
    this.#entries.clear();
    try {
      this.#planner.dispose();
    } catch (error) {
      failure ??= error;
    }
    try {
      this.#domain.dispose();
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) throw failure;
  }

  #stage(
    text: Text<AnyRasterTechnique>,
    desired: DesiredTextState<AnyRasterTechnique>,
    fontBindings: TextFontBindings,
    revision: number,
    order: number,
  ): void {
    const previous = this.#entries.get(text);
    const materialLeases: ThreeMaterialBindingLease[] = [];
    try {
      const options = coreTextOptions(
        desired,
        fontBindings,
        previous?.transform ?? reconciler.transform(text),
        this.#group?.material,
        order,
        this.#coordinator,
        materialLeases,
      );
      if (previous === undefined) {
        const transform = options.transform!;
        const handle = this.#planner.createText(options);
        this.#entries.set(text, {
          handle,
          transform,
          materialLeases,
          stagedRevision: revision,
          stagedOrder: order,
          committedRevision: -1,
        });
      } else {
        previous.handle.update(options);
        for (const lease of previous.materialLeases) lease.dispose();
        previous.materialLeases = materialLeases;
        previous.stagedRevision = revision;
        previous.stagedOrder = order;
      }
    } catch (error) {
      for (const lease of materialLeases) lease.dispose();
      throw error;
    }
    this.#inspections.delete(text);
    this.#pendingPublication = true;
  }

  #canonicalInspection(text: Text<AnyRasterTechnique>): GlyphLayoutInspection | undefined {
    const entry = this.#entries.get(text);
    if (
      entry === undefined ||
      this.#rendererUpdateRejected ||
      entry.committedRevision !== reconciler.desiredRevision(text)
    ) {
      return undefined;
    }
    const cached = this.#inspections.get(text);
    if (cached?.revision === entry.committedRevision) return cached.value;
    this.#coordinator.assertFrameUpdateAllowed();
    const inspection = entry.handle.glyphs();
    this.#inspections.set(text, { revision: entry.committedRevision, value: inspection });
    return inspection;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three text batch has been disposed');
  }
}

function coreTextOptions(
  desired: DesiredTextState<AnyRasterTechnique>,
  bindings: TextFontBindings,
  transform: BackendTransformBinding,
  groupMaterial: ThreeTextMaterial | undefined,
  order: number,
  coordinator: ThreeTextEngineCoordinator,
  leases: ThreeMaterialBindingLease[],
): RetainedTextOptions {
  const rootMaterial = bindMaterial(coordinator, desired.material ?? groupMaterial, leases);
  const spans = desired.spans.map((span, index) => {
    const font = bindings.spans.get(index);
    const material = bindMaterial(coordinator, span.material, leases);
    return Object.freeze({
      start: span.start,
      end: span.end,
      ...(font === undefined ? {} : { font }),
      ...(material === undefined ? {} : { material }),
      ...(span.style === undefined ? {} : { style: span.style }),
    });
  });
  const text: RetainedFormattedText = Object.freeze({ text: desired.text, spans: Object.freeze(spans) });
  return {
    font: bindings.root,
    text,
    transform,
    order,
    ...(rootMaterial === undefined ? {} : { material: rootMaterial }),
    ...(desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: desired.rasterPixelRatio }),
    style: desired.style,
    layout: desired.layout,
    constraints: desired.constraints,
  };
}

function bindMaterial(
  coordinator: ThreeTextEngineCoordinator,
  material: ThreeTextMaterial | undefined,
  leases: ThreeMaterialBindingLease[],
) {
  if (material === undefined) return undefined;
  const lease = coordinator.acquireMaterial(material);
  leases.push(lease);
  return lease.binding;
}

function bindFonts(
  coordinator: ThreeTextEngineCoordinator,
  desired: DesiredTextState<AnyRasterTechnique>,
): TextFontBindings {
  const root = coordinator.bindFontStack(desired.font);
  const spans = new Map<number, BackendFontStackBinding>();
  try {
    for (const [index, span] of desired.spans.entries()) {
      if (span.font !== undefined) spans.set(index, coordinator.bindFontStack(span.font));
    }
    return Object.freeze({ root, spans });
  } catch (error) {
    for (const binding of spans.values()) binding.dispose();
    root.dispose();
    throw error;
  }
}

function disposeFontBindings(bindings: TextFontBindings): void {
  for (const binding of bindings.spans.values()) binding.dispose();
  bindings.root.dispose();
}

function fontSelections(desired: DesiredTextState<AnyRasterTechnique>): readonly FontSelection<AnyRasterTechnique>[] {
  return [desired.font, ...desired.spans.flatMap((span) => (span.font === undefined ? [] : [span.font]))];
}

function normalizeDesired<Technique extends AnyRasterTechnique>(
  properties: TextProperties<Technique>,
  previous?: DesiredTextState<Technique>,
): DesiredTextState<Technique> {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new TypeError('Text properties are required');
  }
  const style = mergePropertyList(properties.style, 'Text style');
  const layout = mergePropertyList(properties.layout, 'Text layout');
  const constraints = mergePropertyList(properties.constraints, 'Text constraints');
  assertTextStyle(style, 'Text style');
  assertParagraphLayout(layout, 'Text layout');
  assertConstraints(constraints, 'Text constraints');
  normalizedColumns(layout, constraints);
  const formatted = typeof properties.text === 'string' ? undefined : properties.text;
  if (formatted !== undefined && !isFormattedText(formatted)) throw new TypeError('Text content is invalid');
  const text = formatted?.text ?? (properties.text as string);
  if (typeof text !== 'string') throw new TypeError('Text content must be a string or formatted text');
  assertTextStyleFeatureRanges(style, 0, text.length, 'Text style');
  const stated = (formatted?.spans as readonly TextSpan<Technique>[] | undefined) ?? properties.spans ?? [];
  if (!Array.isArray(stated)) throw new TypeError('Text spans must be an array');
  const resolved =
    previous !== undefined && previous.text === text && previous.spans === stated
      ? stated
      : alignSpansToClusters(text, assertSpanRanges(text, stated));
  const spans =
    resolved === previous?.spans ? previous.spans : Object.freeze(resolved.map((span) => Object.freeze({ ...span })));
  const rootTechniques = immutableFontSelectionFonts(properties.font).map((font) => font.technique);
  const inheritedTechniques = [
    ...rootTechniques,
    ...spans.flatMap((span) =>
      span.font === undefined ? [] : immutableFontSelectionFonts(span.font).map((font) => font.technique),
    ),
  ];
  assertTextEffectsSupported(style, inheritedTechniques, 'Text style');
  for (const [index, span] of spans.entries()) {
    if (span.style === undefined) continue;
    assertTextEffectsSupported(
      span.style,
      span.font === undefined ? rootTechniques : immutableFontSelectionFonts(span.font).map((font) => font.technique),
      `Text span ${index} style`,
    );
  }
  const rasterPixelRatio = properties.rasterPixelRatio;
  if (rasterPixelRatio !== undefined && (!Number.isFinite(rasterPixelRatio) || rasterPixelRatio <= 0)) {
    throw new RangeError('Text rasterPixelRatio must be positive and finite');
  }
  return Object.freeze({
    font: properties.font,
    text,
    spans,
    style: Object.freeze(style),
    layout: Object.freeze(layout),
    constraints: Object.freeze(constraints),
    ...(rasterPixelRatio === undefined ? {} : { rasterPixelRatio }),
    ...(properties.material === undefined ? {} : { material: properties.material }),
  });
}

function isFormattedText(value: unknown): value is FormattedText<AnyRasterTechnique> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { text?: unknown }).text === 'string' &&
    Array.isArray((value as { spans?: unknown }).spans)
  );
}

function assertSpanRanges<Technique extends AnyRasterTechnique>(
  text: string,
  spans: readonly TextSpan<Technique>[],
): readonly TextSpan<Technique>[] {
  assertPairedSurrogates(text);
  for (const [index, span] of spans.entries()) {
    if (typeof span !== 'object' || span === null || Array.isArray(span)) {
      throw new TypeError(`Text span ${index} must be an object`);
    }
    assertRange(`span ${index}`, span.start, span.end, text.length);
    if (span.style !== undefined) {
      assertTextStyle(span.style, `Text span ${index} style`);
      assertTextStyleFeatureRanges(span.style, span.start, span.end, `Text span ${index} style`);
    }
  }
  assertSpansNest(spans);
  return spans;
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

function assertSpansNest<Technique extends AnyRasterTechnique>(spans: readonly TextSpan<Technique>[]): void {
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
        `span ${index} [${span.start}, ${span.end}) partially overlaps span ${enclosing.index}; spans must nest or be disjoint`,
      );
    }
    open.push({ end: span.end, index });
  }
  const seen = new Map<string, number>();
  for (const [index, span] of spans.entries()) {
    if (span.start === span.end) continue;
    const key = `${span.start}:${span.end}`;
    const first = seen.get(key);
    if (first !== undefined) throw new RangeError(`span ${index} duplicates span ${first} over [${key})`);
    seen.set(key, index);
  }
}

function assertPairedSurrogates(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const high = unit <= 0xdbff;
    const next = high ? text.charCodeAt(index + 1) : Number.NaN;
    if (high && next >= 0xdc00 && next <= 0xdfff) {
      index += 1;
      continue;
    }
    throw new RangeError(`text offset ${index} is an unpaired ${high ? 'high' : 'low'} surrogate`);
  }
}

function normalizeCapacity(value: GlyphBufferCapacity): GlyphBufferCapacity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('glyph capacity must be an object');
  }
  if (!Number.isSafeInteger(value.size) || value.size <= 0) {
    throw new RangeError('glyph capacity size must be positive');
  }
  if (value.policy !== 'grow' && value.policy !== 'chunk' && value.policy !== 'fixed') {
    throw new TypeError('glyph capacity policy is invalid');
  }
  return Object.freeze({ size: value.size, policy: value.policy });
}

function normalizeCompositing(value: TextGroupOptions['compositing']): 'ordered' | 'independent' {
  if (value === undefined || value === 'ordered') return 'ordered';
  if (value === 'independent') return value;
  throw new TypeError('TextGroup compositing mode is invalid');
}

function normalizePixelSnapping(value: boolean | undefined): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new TypeError('pixelSnapping must be a boolean');
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

function collectTextDescendants(group: TextGroup, result: Text<AnyRasterTechnique>[]): Text<AnyRasterTechnique>[] {
  result.length = 0;
  for (const child of group.children) collectTextTree(child, result);
  return result;
}

function collectTextTree(object: THREE.Object3D, result: Text<AnyRasterTechnique>[]): void {
  if (object instanceof TextGroup) return;
  if (object instanceof Text && !object.disposed) result.push(object as Text<AnyRasterTechnique>);
  for (const child of object.children) collectTextTree(child, result);
}

function orderedTexts(texts: readonly Text<AnyRasterTechnique>[]): readonly Text<AnyRasterTechnique>[] {
  return texts
    .map((text, index) => ({ text, index }))
    .sort((left, right) => left.text.renderOrder - right.text.renderOrder || left.index - right.index)
    .map(({ text }) => text);
}

function validateTextDomains(texts: readonly Text<AnyRasterTechnique>[]): void {
  let coordinator: ThreeTextEngineCoordinator | undefined;
  for (const text of texts) {
    if (text.disposed) throw new TypeError('disposed Text cannot be attached');
    const candidate = reconciler.coordinator(text);
    if (coordinator !== undefined && candidate !== coordinator) {
      throw new TypeError('one TextGroup cannot span different Three runtime domains');
    }
    coordinator = candidate;
  }
}

function checkedNextRevision(current: number): number {
  const next = current + 1;
  if (!Number.isSafeInteger(next)) throw new RangeError('Text revisions are exhausted');
  return next;
}
