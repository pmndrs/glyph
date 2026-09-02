import * as THREE from 'three/webgpu';

import { alignSpansToClusters, type FormattedText, type ParagraphSpan, type TextInput } from '../formatted-text.js';
import type { Font } from '../font.js';
import type { AnyFontFaceSelection, FontFaceTechniqueOf } from '../font-face.js';
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
  normalizeGlyphBufferCapacity,
} from '../text-properties.js';
import { assertTextEffectsSupported, normalizedColumns, replacedContent } from '../engine-encoding.js';
import type {
  BackendFontStackBinding,
  BackendTransformBinding,
  GlyphRoot,
  RenderPlanner,
  PlanTarget,
  RetainedFormattedText,
  RetainedText,
  RetainedTextOptions,
} from '../core.js';
import { ThreeTextRenderPlanExecutor } from './engine-plan-target.js';
import { type ThreeMaterialBindingLease, type ThreeTextEngineCoordinator } from './engine-coordinator.js';
import type { ThreeRootContext, ThreeTextMaterial } from './material.js';
import { type ThreeEngineDomainLease, type ThreeEngineDomainProvider } from './engine-domain.js';
import {
  measureGlyphPlacements,
  type ThreeGlyphGeometrySource,
  type ThreeGlyphMeasurement,
} from './glyph-measurement.js';
import { createGlyphs, setGlyphDrawOrder, type Glyphs } from './glyphs.js';
import { createDecorations, decorationDraws, type Decorations } from './decorations.js';

const MAX_TEXT_ENGINE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_UNITS = 65_536;
const MAX_PARAGRAPHS = 4_096;
const MAX_REGIONS = MAX_PARAGRAPHS * 16;
const PLAN_REQUEST_BYTES = 64 * 1024;
const PLAN_RESULT_BYTES = 256 * 1024;
const MIN_PLAN_TEXT_UNITS = 256;

/** Package-private construction capability used by the Three handle and R3F adapter. */
export const threeTextConstructionToken: unique symbol = Symbol('pmndrs.glyph.three.construct');

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

type TextContentProperties<Technique extends AnyRasterTechnique> = Readonly<{ text: TextInput<Technique> }>;

/** Complete desired state for one Three text paragraph. */
export type TextProperties<Technique extends AnyRasterTechnique> = TextBaseProperties<Technique> &
  TextContentProperties<Technique> &
  Readonly<{ material?: ThreeTextMaterial }>;

/** Standalone Three text state plus an optional pixel-snap control. */
export type StandaloneTextProperties<Technique extends AnyRasterTechnique> = TextProperties<Technique> &
  Readonly<{ pixelSnapping?: boolean }>;

/** Partial desired-state replacement accepted by {@link Text.set}. */
export type TextUpdate<Technique extends AnyRasterTechnique> = Partial<TextBaseProperties<Technique>> &
  Readonly<{ text?: TextInput<Technique>; material?: ThreeTextMaterial }>;

/** Publication controls owned by every anonymous or named Three root. */
export interface ThreeRootOptions {
  readonly capacity?: GlyphBufferCapacity;
  /** Allows Rust to reorder compatible draws when the root does not require compositing order. */
  readonly compositing?: 'ordered' | 'independent';
}

/** Construction options for one Three scene-hierarchy parent. */
export interface TextGroupOptions {
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
  root(text: Text<AnyRasterTechnique>): ThreeRoot;
  markCommitted(text: Text<AnyRasterTechnique>): void;
  publishMeasurement(text: Text<AnyRasterTechnique>, measurement: ParagraphLayoutSummary): void;
  bind(text: Text<AnyRasterTechnique>, binding: ThreeRootPublication, group: TextGroup | undefined): void;
  unbindFrom(text: Text<AnyRasterTechnique>, binding: ThreeRootPublication): void;
  reportError(text: Text<AnyRasterTechnique>, error: unknown): void;
  clearError(text: Text<AnyRasterTechnique>): void;
}

let reconciler!: TextReconciler;

interface TextGroupErrorReconciler {
  reportError(group: TextGroup, error: unknown): void;
  clearError(group: TextGroup): void;
}

let textGroupErrors!: TextGroupErrorReconciler;

/** @internal Handle-owned construction operations required by one Three root. */
export interface ThreeRootDomainProvider extends ThreeEngineDomainProvider {
  createTextForRoot<Technique extends AnyRasterTechnique>(
    root: ThreeRoot,
    properties:
      | StandaloneTextProperties<Technique>
      | (Omit<StandaloneTextProperties<Technique>, 'font'> & { readonly font: AnyFontFaceSelection | string }),
  ): Text<Technique>;
}

class ThreeRootDrawObject extends THREE.Object3D {
  readonly #commit: (worldMatricesCurrent: boolean) => void;

  constructor(commit: (worldMatricesCurrent: boolean) => void) {
    super();
    this.#commit = commit;
  }

  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);
    this.#commit(true);
  }

  updateMatrixWorldWithoutCommit(force?: boolean): void {
    super.updateMatrixWorld(force);
  }
}

/** One handle-owned publication root. A name is customization metadata, not a Three Scene identity. */
export class ThreeRoot implements GlyphRoot, ThreeRootContext {
  readonly name: string | undefined;
  readonly #domain: ThreeRootDomainProvider;
  readonly #release: () => void;
  readonly #texts = new Set<Text<AnyRasterTechnique>>();
  readonly #textOrders = new WeakMap<Text<AnyRasterTechnique>, number>();
  readonly #drawRoot: ThreeRootDrawObject;
  #scene: THREE.Scene | undefined;
  #binding: ThreeRootPublication | undefined;
  #capacity: GlyphBufferCapacity;
  #compositing: 'ordered' | 'independent';
  #material: ThreeTextMaterial | undefined;
  #nextTextOrder = 0;
  #disposed = false;

  /** Ordinary applications obtain roots by calling a Three handle. */
  constructor(
    token: typeof threeTextConstructionToken,
    name: string | undefined,
    domain: ThreeRootDomainProvider,
    release: () => void,
    options: ThreeRootOptions,
  ) {
    if (token !== threeTextConstructionToken) {
      throw new TypeError('Three roots must be selected from a Glyph Three handle');
    }
    this.name = name;
    this.#domain = domain;
    this.#release = release;
    this.#capacity = normalizeGlyphBufferCapacity(
      options.capacity ?? { size: 4_096, policy: 'chunk' },
      'Three root capacity',
    );
    this.#compositing = normalizeThreeRootCompositing(options.compositing, 'Three root compositing');
    this.#drawRoot = new ThreeRootDrawObject((worldMatricesCurrent) => this.#commitTraversal(worldMatricesCurrent));
    this.#drawRoot.name = name === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${name}`;
    this.#drawRoot.matrixAutoUpdate = false;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get textCount(): number {
    return this.#texts.size;
  }

  get gpuBytes(): number {
    return this.#binding?.gpuBytes ?? 0;
  }

  get capacity(): GlyphBufferCapacity {
    return this.#capacity;
  }

  get compositing(): 'ordered' | 'independent' {
    return this.#compositing;
  }

  get material(): ThreeTextMaterial | undefined {
    return this.#material;
  }
  set material(value: ThreeTextMaterial | undefined) {
    this.setMaterial(value);
  }

  setMaterial(value: ThreeTextMaterial | undefined): void {
    this.#assertActive();
    if (this.#material === value) return;
    this.#material = value;
    this.#binding?.invalidateMaterial();
  }

  setCapacity(value: GlyphBufferCapacity): void {
    this.#assertActive();
    const capacity = normalizeGlyphBufferCapacity(value, 'Three root capacity');
    if (sameCapacity(this.#capacity, capacity)) return;
    this.#capacity = capacity;
    this.#binding?.setCapacity(capacity);
  }

  setCompositing(value: 'ordered' | 'independent'): void {
    this.#assertActive();
    const compositing = normalizeThreeRootCompositing(value, 'Three root compositing');
    if (this.#compositing === compositing) return;
    this.#compositing = compositing;
    this.#binding?.setCompositing(compositing);
  }

  createText<Technique extends AnyRasterTechnique>(properties: StandaloneTextProperties<Technique>): Text<Technique>;
  createText<const Selection extends AnyFontFaceSelection | string>(
    properties: Omit<StandaloneTextProperties<FontFaceTechniqueOf<Selection>>, 'font'> & { readonly font: Selection },
  ): Text<FontFaceTechniqueOf<Selection>>;
  createText<Technique extends AnyRasterTechnique>(
    properties:
      | StandaloneTextProperties<Technique>
      | (Omit<StandaloneTextProperties<Technique>, 'font'> & { readonly font: AnyFontFaceSelection | string }),
  ): Text<Technique> {
    this.#assertActive();
    return this.#domain.createTextForRoot(this, properties);
  }

  createTextGroup(options: TextGroupOptions = {}): TextGroup {
    this.#assertActive();
    return new TextGroup(threeTextConstructionToken, options, this.#domain, this);
  }

  /** Publishes all retained descendants and synchronizes their current Three transforms. */
  shape(): void {
    this.#assertActive();
    try {
      this.#synchronize(false);
    } catch (error) {
      this.#reportError(error, this.#renderMembers());
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#binding?.dispose();
      this.#binding = undefined;
    } finally {
      this.#drawRoot.removeFromParent();
      this.#scene = undefined;
      this.#release();
    }
  }

  /** @internal Register one retained leaf with this publication root. */
  register(text: Text<AnyRasterTechnique>): void {
    this.#assertActive();
    if (!this.#textOrders.has(text)) {
      if (this.#nextTextOrder > 0xffff_ffff) throw new RangeError('Three root text orders are exhausted');
      this.#textOrders.set(text, this.#nextTextOrder);
      this.#nextTextOrder += 1;
    }
    this.#texts.add(text);
  }

  /** @internal Remove one retained leaf from this publication root. */
  unregister(text: Text<AnyRasterTechnique>): void {
    this.#texts.delete(text);
    if (this.#texts.size !== 0 || this.#binding === undefined) return;
    const binding = this.#binding;
    this.#binding = undefined;
    try {
      binding.dispose();
    } finally {
      this.#drawRoot.removeFromParent();
      this.#scene = undefined;
    }
  }

  /** @internal Stable semantic order assigned once for one Text lifetime. */
  publicationOrder(text: Text<AnyRasterTechnique>): number {
    const order = this.#textOrders.get(text);
    if (order === undefined) throw new Error('Text does not belong to this Three root');
    return order;
  }

  /** @internal Invalidate inherited material state after a TextGroup change. */
  invalidateMaterial(): void {
    this.#binding?.invalidateMaterial();
  }

  /** @internal Measure one root member through the root-owned planner. */
  measurement(text: Text<AnyRasterTechnique>): ParagraphLayoutSummary {
    this.#assertMember(text);
    return this.#rootBinding().measurement(text);
  }

  /** @internal Inspect one root member through the root-owned planner. */
  inspection(text: Text<AnyRasterTechnique>): GlyphLayoutInspection {
    this.#assertMember(text);
    return this.#rootBinding().inspection(text);
  }

  /** @internal Cheap host-tree observation; semantic publication waits for the root draw traversal. */
  observeHostTree(): void {
    if (this.#disposed) return;
    this.#bindScene(this.#renderMembers());
  }

  /** @internal Stable root membership snapshot used by measurement reconciliation. */
  members(): readonly Text<AnyRasterTechnique>[] {
    return [...this.#texts].filter((text) => !text.disposed);
  }

  #synchronize(worldMatricesCurrent: boolean): void {
    const texts = this.#renderMembers();
    if (!worldMatricesCurrent) {
      for (const text of texts) text.updateWorldMatrix(true, false);
    }
    this.#bindScene(texts);
    this.#drawRoot.updateMatrixWorldWithoutCommit(true);
    if (texts.length === 0) {
      if (this.#binding !== undefined) {
        this.#binding.reconcile([]);
        this.#binding.synchronize(worldMatricesCurrent);
      }
      this.#clearErrors(texts);
      return;
    }
    validateTextDomains(texts);
    const binding = this.#rootBinding();
    binding.reconcile(texts);
    binding.synchronize(worldMatricesCurrent);
    if (!binding.hasRejectedRendererUpdate) this.#clearErrors(texts);
  }

  #commitTraversal(worldMatricesCurrent: boolean): void {
    if (this.#disposed) return;
    try {
      this.#synchronize(worldMatricesCurrent);
    } catch (error) {
      this.#reportError(error, this.#renderMembers());
    }
  }

  #reportError(error: unknown, texts: readonly Text<AnyRasterTechnique>[]): void {
    const groups = new Set<TextGroup>();
    for (const text of texts) {
      reconciler.reportError(text, error);
      for (let parent = text.parent; parent !== null; parent = parent.parent) {
        if (parent instanceof TextGroup) groups.add(parent);
      }
    }
    for (const group of groups) textGroupErrors.reportError(group, error);
  }

  #clearErrors(texts: readonly Text<AnyRasterTechnique>[]): void {
    const groups = new Set<TextGroup>();
    for (const text of texts) {
      reconciler.clearError(text);
      for (let parent = text.parent; parent !== null; parent = parent.parent) {
        if (parent instanceof TextGroup) groups.add(parent);
      }
    }
    for (const group of groups) textGroupErrors.clearError(group);
  }

  #rootBinding(): ThreeRootPublication {
    this.#binding ??= new ThreeRootPublication(this.#domain, this.#capacity, this.#compositing, this);
    return this.#binding;
  }

  /** @internal Private Three parent for renderer-owned batches. */
  get drawRoot(): THREE.Object3D {
    return this.#drawRoot;
  }

  /** @internal Current host scene, discovered from retained Three objects. */
  get scene(): THREE.Scene | undefined {
    return this.#scene;
  }

  /** @internal Visibility relative to the scene currently bound to this root. */
  visible(text: THREE.Object3D): boolean {
    const scene = this.#scene;
    if (scene === undefined || nearestScene(text) !== scene) return false;
    let current: THREE.Object3D | null = text;
    while (current !== null && current !== scene) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return current === scene && scene.visible;
  }

  #bindScene(texts: readonly Text<AnyRasterTechnique>[]): void {
    let scene: THREE.Scene | undefined;
    for (const text of texts) {
      const candidate = nearestScene(text);
      if (candidate === undefined) continue;
      if (scene !== undefined && candidate !== scene) {
        throw new Error(
          `Three root ${JSON.stringify(this.name)} spans more than one Scene; select a different handle root for each Scene`,
        );
      }
      scene = candidate;
    }
    if (scene === this.#scene) return;
    this.#drawRoot.removeFromParent();
    this.#scene = scene;
    if (scene !== undefined) {
      scene.add(this.#drawRoot);
      // Three snapshots a parent's child count before traversing it. When a Text discovers its
      // Scene during that traversal, the newly attached draw root would otherwise miss the first
      // frame. Commit it once here; later frames reach the stable draw-root child normally.
      this.#commitTraversal(false);
    }
  }

  #renderMembers(): readonly Text<AnyRasterTechnique>[] {
    return [...this.#texts].filter((text) => !text.disposed && nearestScene(text) !== undefined);
  }

  #assertMember(text: Text<AnyRasterTechnique>): void {
    this.#assertActive();
    if (!this.#texts.has(text)) throw new Error('Text does not belong to this Three root');
  }

  #assertActive(): void {
    this.#domain.coordinator.assertFrameUpdateAllowed();
    if (this.#disposed) throw new Error(`Three root ${JSON.stringify(this.name)} has been disposed`);
  }
}

export class Text<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  static {
    reconciler = {
      coordinator: (text) => text.#domain.coordinator,
      acquireDomain: (text) => text.#acquireDomain(),
      transform: (text) => text.#transform,
      desired: (text) => text.#desired,
      fontBindings: (text) => text.#fontBindings,
      desiredRevision: (text) => text.#desiredRevision,
      root: (text) => text.#root,
      markCommitted: (text) => text.#markCommitted(),
      publishMeasurement: (text, measurement) => text.#setBoundingBox(measurement),
      bind: (text, binding, group) => text.#bind(binding, group),
      unbindFrom: (text, binding) => text.#unbindFrom(binding),
      reportError: (text, error) => text.#reportError(error),
      clearError: (text) => text.#clearError(),
    };
  }

  readonly #domain: ThreeEngineDomainLease;
  readonly #ownedFonts: readonly Font<AnyRasterTechnique>[];
  readonly #transform: BackendTransformBinding;
  readonly #boundingBox = new THREE.Box3();
  #desired: DesiredTextState<Technique>;
  #fontBindings: TextFontBindings;
  readonly #pixelSnapping: boolean;
  readonly #root: ThreeRoot;
  #binding: ThreeRootPublication | undefined;
  #textGroup: TextGroup | undefined;
  #desiredRevision = 0;
  #committedRevision = -1;
  #boundingBoxCurrent = false;
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  /** Ordinary applications construct Text through `handle.createText()`. */
  constructor(
    token: typeof threeTextConstructionToken,
    properties: StandaloneTextProperties<Technique>,
    domainProvider: ThreeEngineDomainProvider,
    ownedFonts: readonly Font<AnyRasterTechnique>[],
    root: ThreeRoot,
  ) {
    super();
    if (token !== threeTextConstructionToken) {
      throw new TypeError('Three Text must be created with handle.createText() or an R3F Text component');
    }
    if (root === undefined || domainProvider === undefined) {
      throw new TypeError('Three Text must be created by a Glyph Three root');
    }
    assertNoRawSpans(properties, 'Text properties');
    const desired = normalizeDesired(properties);
    const domain = domainProvider.acquire();
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
    this.#ownedFonts = ownedFonts;
    this.#transform = transform;
    this.#fontBindings = fontBindings;
    this.#desired = desired;
    this.#pixelSnapping = normalizePixelSnapping(properties.pixelSnapping);
    this.#root = root;
    root.register(eraseTextTechnique(this));
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
    assertNoRawSpans(update, 'Text update');
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

  /**
   * Measure current desired text without scene attachment or matrix traversal.
   * A cache miss may synchronously incur font and measure lookup work in the text engine.
   */
  measure(): ParagraphLayoutSummary {
    this.#assertActive();
    const text = eraseTextTechnique(this);
    const measurement = this.#root.measurement(text);
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
    const inspection = this.#root.inspection(text);
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

  /** Measures each currently displayed glyph in Text-local space. */
  measureGlyphs(): readonly ThreeGlyphMeasurement[] | undefined {
    const placements = this.#glyphPlacements();
    if (placements === undefined) return undefined;
    return measureGlyphPlacements(placements, this.#glyphGeometry(placements));
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
    const source = this as unknown as Text<AnyRasterTechnique>;
    const glyphRenderOrderBase = binding.glyphRenderOrderBase(source, stableIds);
    const glyphs = createGlyphs({
      source,
      placements,
      geometry: this.#glyphGeometry(placements),
      domain: this.#acquireDomain(),
      renderOrderBase: glyphRenderOrderBase,
      copy: (target) => binding.copyGlyphs(eraseTextTechnique(this), stableIds, target),
    });
    let decorations: Decorations | undefined;
    try {
      decorations = createDecorations({
        source,
        domain: this.#acquireDomain(),
        renderOrderBase: glyphRenderOrderBase,
        copy: (target) => binding.copyDecorations(eraseTextTechnique(this), target),
      });
      if (decorations === undefined) {
        setGlyphDrawOrder(glyphs, glyphRenderOrderBase);
      } else {
        const { under, over } = decorationDraws(decorations);
        for (const [index, draw] of under.entries()) {
          draw.renderOrder = glyphRenderOrderBase - under.length + index;
        }
        const glyphDrawCount = setGlyphDrawOrder(glyphs, glyphRenderOrderBase);
        for (const [index, draw] of over.entries()) {
          draw.renderOrder = glyphRenderOrderBase + glyphDrawCount + index;
        }
      }
      return Object.freeze([glyphs, decorations] as const);
    } catch (error) {
      try {
        decorations?.dispose();
      } finally {
        glyphs.dispose();
      }
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
    this.#root.observeHostTree();
  }

  /** Publishes pending semantic state immediately, then synchronizes current transforms. */
  shape(): void {
    this.#assertActive();
    this.#root.shape();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unbind();
    this.#root.unregister(eraseTextTechnique(this));
    disposeFontBindings(this.#fontBindings);
    for (const font of this.#ownedFonts) font.dispose();
    this.#transform.dispose();
    this.#domain.dispose();
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

  #bind(binding: ThreeRootPublication, group: TextGroup | undefined): void {
    if (this.#binding !== binding) this.#unbind();
    this.#binding = binding;
    this.#textGroup = group;
  }

  #unbindFrom(binding: ThreeRootPublication): void {
    if (this.#binding !== binding) return;
    this.#binding = undefined;
    this.#textGroup = undefined;
  }

  #unbind(): void {
    const binding = this.#binding;
    this.#binding = undefined;
    this.#textGroup = undefined;
    binding?.removeText(eraseTextTechnique(this));
  }

  #reportError(error: unknown): void {
    if (this.#error === error) return;
    this.#error = error;
    this.onError?.(error);
  }

  #clearError(): void {
    this.#error = undefined;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Text has been disposed');
  }
}

interface TextGroupRenderOrderState {
  stated: number | undefined;
  observed: number;
}

const textGroupRenderOrders = new WeakMap<TextGroup, TextGroupRenderOrderState>();
const textGroupRoots = new WeakMap<TextGroup, ThreeRoot>();
const textPresentations = new WeakMap<Text<AnyRasterTechnique>, TextPresentation>();

export class TextGroup extends THREE.Object3D {
  static {
    textGroupErrors = {
      reportError: (group, error) => group.#reportError(error),
      clearError: (group) => group.#clearError(),
    };
  }
  readonly #pixelSnapping: boolean | undefined;
  readonly #domainProvider: ThreeEngineDomainProvider;
  readonly #root: ThreeRoot;
  #material: ThreeTextMaterial | undefined;
  readonly #texts: Text<AnyRasterTechnique>[] = [];
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  /** Ordinary applications construct TextGroup through `handle.createTextGroup()`. */
  constructor(
    token: typeof threeTextConstructionToken,
    options: TextGroupOptions,
    domainProvider: ThreeEngineDomainProvider,
    root: ThreeRoot,
  ) {
    super();
    if (token !== threeTextConstructionToken) {
      throw new TypeError(
        'Three TextGroup must be created with handle.createTextGroup() or an R3F TextGroup component',
      );
    }
    if (root === undefined || domainProvider === undefined) {
      throw new TypeError('Three TextGroup must be created by a Glyph Three root');
    }
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('TextGroup options must be an object');
    }
    this.#pixelSnapping =
      options.pixelSnapping === undefined ? undefined : normalizePixelSnapping(options.pixelSnapping);
    this.#domainProvider = domainProvider;
    this.#root = root;
    this.#material = options.material;
    if (options.renderOrder !== undefined) {
      if (!Number.isFinite(options.renderOrder)) throw new RangeError('TextGroup renderOrder must be finite');
      this.renderOrder = options.renderOrder;
    }
    textGroupRenderOrders.set(this, {
      stated: options.renderOrder,
      observed: this.renderOrder,
    });
    textGroupRoots.set(this, root);
  }

  get textCount(): number {
    return collectTextDescendants(this, this.#texts).length;
  }
  get pixelSnapping(): boolean | undefined {
    return this.#pixelSnapping;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get error(): unknown {
    return this.#error;
  }
  get gpuBytes(): number {
    return this.#root.gpuBytes;
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
    this.#root.invalidateMaterial();
  }

  override add(...children: THREE.Object3D[]): this {
    this.#assertActive();
    const existing = collectTextDescendants(this, []);
    const incoming: Text<AnyRasterTechnique>[] = [];
    for (const child of children) collectTextTree(child, incoming);
    this.#assertHandle(incoming);
    this.#assertRoot(incoming);
    validateTextDomains([...existing, ...incoming]);
    return super.add(...children);
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
    this.#root.observeHostTree();
  }

  /** Publishes pending descendant semantic state immediately, then synchronizes current transforms. */
  shape(): void {
    this.#assertActive();
    this.#root.shape();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    textGroupRenderOrders.delete(this);
    textGroupRoots.delete(this);
    if (!this.#root.disposed) this.#root.invalidateMaterial();
  }

  #reportError(error: unknown): void {
    if (this.#error === error) return;
    this.#error = error;
    this.onError?.(error);
  }

  #clearError(): void {
    this.#error = undefined;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('TextGroup has been disposed');
  }

  #assertHandle(texts: readonly Text<AnyRasterTechnique>[]): void {
    const coordinator = this.#domainProvider.coordinator;
    for (const text of texts) {
      if (reconciler.coordinator(text) !== coordinator) {
        throw new TypeError('one Three TextGroup cannot contain Text objects from different Glyph handles');
      }
    }
  }

  #assertRoot(texts: readonly Text<AnyRasterTechnique>[]): void {
    for (const text of texts) {
      if (reconciler.root(text) !== this.#root) {
        throw new TypeError('one Three TextGroup cannot contain Text objects from different Glyph roots');
      }
    }
  }
}

interface BoundTextEntry {
  readonly handle: RetainedText;
  readonly transform: BackendTransformBinding;
  materialLeases: readonly ThreeMaterialBindingLease[];
  stagedRevision: number;
  stagedOrder: number;
  stagedPresentation: TextPresentation;
  committedRevision: number;
}

interface TextPresentation {
  readonly group: TextGroup | undefined;
  readonly material: ThreeTextMaterial | undefined;
  readonly pixelSnapping: boolean;
  readonly renderOrder: number;
}

interface CanonicalInspection {
  readonly revision: number;
  readonly value: GlyphLayoutInspection;
}

class ThreeRootPublication {
  readonly #coordinator: ThreeTextEngineCoordinator;
  readonly #domain: ThreeEngineDomainLease;
  readonly #root: ThreeRoot;
  readonly #planner: RenderPlanner;
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #entries = new Map<Text<AnyRasterTechnique>, BoundTextEntry>();
  readonly #inspections = new Map<Text<AnyRasterTechnique>, CanonicalInspection>();
  #capacity: GlyphBufferCapacity;
  #compositing: 'ordered' | 'independent';
  #pendingPublication = false;
  #rendererUpdateRejected = false;
  #capacityExceeded: { readonly required: number; readonly size: number } | undefined;
  #materialInvalidated = false;
  #disposed = false;

  constructor(
    source: ThreeRootDomainProvider,
    capacity: GlyphBufferCapacity,
    compositing: 'ordered' | 'independent',
    root: ThreeRoot,
  ) {
    this.#coordinator = source.coordinator;
    this.#domain = source.acquire();
    this.#root = root;
    this.#capacity = capacity;
    this.#compositing = compositing;
    const drawRoot = root.drawRoot;
    const planOwner = {
      drawRoot,
      root,
      visibleObject: (object: THREE.Object3D) => root.visible(object),
    };
    let target: ThreeTextRenderPlanExecutor | undefined;
    try {
      this.#planner = this.#coordinator.backend.createPlanner({
        policy: this.#coordinator.policy,
        capabilitySet: this.#coordinator.capabilitySet,
        target: () => {
          target = new ThreeTextRenderPlanExecutor(this.#coordinator, planOwner);
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

  setCompositing(compositing: 'ordered' | 'independent'): void {
    this.#assertActive();
    this.#compositing = compositing;
    this.#pendingPublication = true;
  }

  invalidateMaterial(): void {
    this.#assertActive();
    this.#materialInvalidated = true;
  }

  reconcile(texts: readonly Text<AnyRasterTechnique>[]): void {
    this.#assertActive();
    const ordered = orderedTexts(texts, this.#root);
    const desired = new Set(ordered.map(({ text }) => text));
    for (const text of [...this.#entries.keys()]) {
      if (!desired.has(text)) this.removeText(text);
    }
    for (const { order, text, presentation } of ordered) {
      const entry = this.#entries.get(text);
      const revision = reconciler.desiredRevision(text);
      if (
        entry === undefined ||
        entry.stagedRevision !== revision ||
        entry.stagedOrder !== order ||
        !sameTextPresentation(entry.stagedPresentation, presentation) ||
        this.#materialInvalidated
      ) {
        this.#stage(text, reconciler.desired(text), reconciler.fontBindings(text), revision, order, presentation);
      }
      reconciler.bind(text, this, presentation.group);
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
    this.#stage(text, desired, fontBindings, revision, entry.stagedOrder, resolveTextPresentation(text));
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
    this.reconcile(this.#root.members());
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('Text is not retained by this batch');
    const measurement = entry.handle.measure();
    reconciler.publishMeasurement(text, measurement);
    return measurement;
  }

  inspection(text: Text<AnyRasterTechnique>): GlyphLayoutInspection {
    this.#assertActive();
    this.#coordinator.assertFrameUpdateAllowed();
    this.reconcile(this.#root.members());
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

  glyphRenderOrderBase(text: Text<AnyRasterTechnique>, stableIds: Uint32Array): number {
    this.#assertActive();
    if (!this.#entries.has(text)) throw new Error('cannot inspect draw order for an unbound text paragraph');
    return this.#target.renderOrderBaseForGlyphs(stableIds) ?? text.renderOrder;
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
      compositing: this.#compositing,
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
    presentation: TextPresentation,
  ): void {
    const previous = this.#entries.get(text);
    const materialLeases: ThreeMaterialBindingLease[] = [];
    try {
      const options = coreTextOptions(
        desired,
        fontBindings,
        previous?.transform ?? reconciler.transform(text),
        presentation,
        this.#root,
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
          stagedPresentation: presentation,
          committedRevision: -1,
        });
      } else {
        previous.handle.update(options);
        for (const lease of previous.materialLeases) lease.dispose();
        previous.materialLeases = materialLeases;
        previous.stagedRevision = revision;
        previous.stagedOrder = order;
        previous.stagedPresentation = presentation;
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
  presentation: TextPresentation,
  root: ThreeRoot,
  order: number,
  coordinator: ThreeTextEngineCoordinator,
  leases: ThreeMaterialBindingLease[],
): RetainedTextOptions {
  const { pixelSnapping, renderOrder } = presentation;
  const rootMaterial = bindMaterial(
    coordinator,
    desired.material ?? presentation.material ?? root.material,
    pixelSnapping,
    renderOrder,
    leases,
  );
  const spans = desired.spans.map((span, index) => {
    const font = bindings.spans.get(index);
    const material =
      span.material === undefined
        ? undefined
        : bindMaterial(coordinator, span.material, pixelSnapping, renderOrder, leases);
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
    material: rootMaterial,
    ...(desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: desired.rasterPixelRatio }),
    style: desired.style,
    layout: desired.layout,
    constraints: desired.constraints,
  };
}

function bindMaterial(
  coordinator: ThreeTextEngineCoordinator,
  material: ThreeTextMaterial | undefined,
  pixelSnapping: boolean,
  renderOrder: number,
  leases: ThreeMaterialBindingLease[],
) {
  const lease = coordinator.acquireMaterial(material, pixelSnapping, renderOrder);
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
  const stated =
    (formatted?.spans as readonly TextSpan<Technique>[] | undefined) ??
    (properties as DesiredTextState<Technique>).spans ??
    [];
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

function assertNoRawSpans(value: object, subject: string): void {
  if (Object.hasOwn(value, 'spans')) {
    throw new TypeError(`${subject} cannot declare raw spans; compose formatted text with txt and span`);
  }
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

function sameCapacity(left: GlyphBufferCapacity, right: GlyphBufferCapacity): boolean {
  return left.size === right.size && left.policy === right.policy;
}

/** @internal Validate one root-owned compositing input at its user boundary. */
export function normalizeThreeRootCompositing(
  value: ThreeRootOptions['compositing'],
  label: string,
): 'ordered' | 'independent' {
  if (value === undefined || value === 'ordered') return 'ordered';
  if (value === 'independent') return value;
  throw new TypeError(`${label} must be ordered or independent`);
}

function normalizePixelSnapping(value: boolean | undefined): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new TypeError('pixelSnapping must be a boolean');
}

function nearestScene(object: THREE.Object3D): THREE.Scene | undefined {
  let current: THREE.Object3D | null = object;
  while (current !== null) {
    if ((current as THREE.Scene).isScene === true) return current as THREE.Scene;
    current = current.parent;
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
  if (object instanceof Text && !object.disposed) result.push(object as Text<AnyRasterTechnique>);
  for (const child of object.children) collectTextTree(child, result);
}

function orderedTexts(
  texts: readonly Text<AnyRasterTechnique>[],
  root: ThreeRoot,
): readonly Readonly<{ order: number; text: Text<AnyRasterTechnique>; presentation: TextPresentation }>[] {
  return texts.map((text) => ({
    order: root.publicationOrder(text),
    text,
    presentation: resolveTextPresentation(text),
  }));
}

function resolveTextPresentation(text: Text<AnyRasterTechnique>): TextPresentation {
  const root = reconciler.root(text);
  let group: TextGroup | undefined;
  let material: ThreeTextMaterial | undefined;
  let pixelSnapping: boolean | undefined;
  let renderOrder: number | undefined;
  let parent = text.parent;
  while (parent !== null) {
    if (parent instanceof TextGroup) {
      if (parent.disposed) {
        parent = parent.parent;
        continue;
      }
      if (textGroupRoots.get(parent) !== root) {
        throw new TypeError('one Three TextGroup cannot contain Text objects from different Glyph roots');
      }
      group ??= parent;
      material ??= parent.material;
      pixelSnapping ??= parent.pixelSnapping;
      renderOrder ??= statedTextGroupRenderOrder(parent);
    }
    parent = parent.parent;
  }
  const resolved: TextPresentation = {
    group,
    material,
    pixelSnapping: pixelSnapping ?? text.pixelSnapping,
    renderOrder: renderOrder ?? text.renderOrder,
  };
  const cached = textPresentations.get(text);
  if (cached !== undefined && sameTextPresentation(cached, resolved)) return cached;
  const presentation = Object.freeze(resolved);
  textPresentations.set(text, presentation);
  return presentation;
}

function statedTextGroupRenderOrder(group: TextGroup): number | undefined {
  const state = textGroupRenderOrders.get(group);
  if (state === undefined) throw new Error('TextGroup render-order state is unavailable');
  if (state.observed !== group.renderOrder) {
    if (!Number.isFinite(group.renderOrder)) throw new RangeError('TextGroup renderOrder must be finite');
    state.observed = group.renderOrder;
    state.stated = group.renderOrder;
  }
  return state.stated;
}

function sameTextPresentation(left: TextPresentation, right: TextPresentation): boolean {
  return (
    left.group === right.group &&
    left.material === right.material &&
    left.pixelSnapping === right.pixelSnapping &&
    left.renderOrder === right.renderOrder
  );
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
