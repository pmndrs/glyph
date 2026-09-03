import * as THREE from 'three/webgpu';

import { alignSpansToClusters, type FormattedText, type ParagraphSpan, type TextInput } from '../formatted-text.js';
import type { Font } from '../font.js';
import {
  isFontFaceSelection,
  resolveFontFace,
  type AnyFontFaceSelection,
  type FontFaceRasterOf,
} from '../font-face.js';
import { createGlyphPlacements, type GlyphCaret, type GlyphPlacements } from '../glyph-placement.js';
import {
  copyGlyphLayoutInspection,
  type LayoutBox,
  type GlyphLayoutInspection,
  type ParagraphLayoutSummary,
} from '../layout.js';
import { immutableFontSelectionFonts, type FontSelection } from '../loaded-font.js';
import { FontLoadError } from '../loader.js';
import { glyph } from '../glyph.js';
import type { AnyRasterFormat } from '../config/raster-format.js';
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
import type { GlyphCopy, GlyphRoot, GlyphRootServices, GlyphTextController } from '../config/glyph.js';
import { ThreeTextRenderPlanExecutor } from './engine-plan-target.js';
import type { ThreeRootContext, ThreeTextMaterial } from './material.js';
import type { ThreeBindings, ThreeMaterialBinding, ThreeRootBinding } from './handle.js';
import type { ThreeRendererResources } from './renderer-resources.js';
import {
  measureGlyphPlacements,
  type ThreeGlyphGeometrySource,
  type ThreeGlyphMeasurement,
} from './glyph-measurement.js';
import { createGlyphs, setGlyphDrawOrder, type Glyphs } from './glyphs.js';
import { createDecorations, decorationDraws, type Decorations } from './decorations.js';

/** Package-private construction capability used by the Three handle and R3F adapter. */
export const threeTextConstructionToken: unique symbol = Symbol('pmndrs.glyph.three.construct');

/** One inline Three text run with optional font fallback and material override. */
export type TextSpan<Technique extends AnyRasterFormat> = Omit<ParagraphSpan<Technique>, 'font'> &
  Readonly<{ font?: FontSelection<Technique>; material?: ThreeTextMaterial }>;

type TextBaseProperties<Technique extends AnyRasterFormat> = Omit<ParagraphBaseProperties<Technique>, 'font'> &
  Readonly<{ font: FontSelection<Technique> }>;

type TextContentProperties<Technique extends AnyRasterFormat> = Readonly<{ text: TextInput<Technique> }>;

/** Complete desired state for one Three text paragraph. */
export type TextProperties<Technique extends AnyRasterFormat> = TextBaseProperties<Technique> &
  TextContentProperties<Technique> &
  Readonly<{ material?: ThreeTextMaterial }>;

/** Standalone Three text state plus an optional pixel-snap control. */
export type StandaloneTextProperties<Technique extends AnyRasterFormat> = TextProperties<Technique> &
  Readonly<{ pixelSnapping?: boolean }>;

/** Partial desired-state replacement accepted by {@link Text.set}. */
export type TextUpdate<Technique extends AnyRasterFormat> = Partial<TextBaseProperties<Technique>> &
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

interface DesiredTextState<Technique extends AnyRasterFormat> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly TextSpan<Technique>[];
  readonly style: TextStyle;
  readonly layout: ParagraphLayout;
  readonly constraints: Constraints;
  readonly rasterPixelRatio?: number;
  readonly material?: ThreeTextMaterial;
}

interface TextReconciler {
  desired<Technique extends AnyRasterFormat>(text: Text<Technique>): DesiredTextState<Technique>;
  desiredRevision(text: Text<AnyRasterFormat>): number;
  root(text: Text<AnyRasterFormat>): ThreeRoot;
  markCommitted(text: Text<AnyRasterFormat>): void;
  publishMeasurement(text: Text<AnyRasterFormat>, measurement: ParagraphLayoutSummary): void;
  bind(text: Text<AnyRasterFormat>, binding: ThreeRootPublication, group: TextGroup | undefined): void;
  unbindFrom(text: Text<AnyRasterFormat>, binding: ThreeRootPublication): void;
  reportError(text: Text<AnyRasterFormat>, error: unknown): void;
  clearError(text: Text<AnyRasterFormat>): void;
}

let reconciler!: TextReconciler;

interface TextGroupErrorReconciler {
  reportError(group: TextGroup, error: unknown): void;
  clearError(group: TextGroup): void;
}

let textGroupErrors!: TextGroupErrorReconciler;

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
export class ThreeRoot implements GlyphRoot {
  readonly name: string | undefined;
  readonly #fonts: import('../config/glyph.js').GlyphHandleFonts;
  readonly #services: GlyphRootServices<ThreeBindings, void, ThreeRootBinding>;
  readonly #resources: ThreeRendererResources;
  readonly #renderer: ThreeTextRenderPlanExecutor;
  readonly #texts = new Set<Text<AnyRasterFormat>>();
  readonly #textOrders = new WeakMap<Text<AnyRasterFormat>, number>();
  readonly #drawRoot: ThreeRootDrawObject;
  #publicRoot: ThreeRoot | undefined;
  #scene: THREE.Scene | undefined;
  #binding: ThreeRootPublication | undefined;
  #needsInitialTransformSync = false;
  readonly #renderMemberScratch: Text<AnyRasterFormat>[] = [];
  #capacity: GlyphBufferCapacity;
  #compositing: 'ordered' | 'independent';
  #material: ThreeTextMaterial | undefined;
  #nextTextOrder = 0;
  #disposed = false;

  get handle(): import('./handle.js').ThreeHandle {
    if (this.#publicRoot === undefined) throw new Error('Three root public identity has not been bound');
    return this.#publicRoot.handle;
  }

  /** Ordinary applications obtain roots by calling a Three handle. */
  constructor(
    token: typeof threeTextConstructionToken,
    name: string | undefined,
    fonts: import('../config/glyph.js').GlyphHandleFonts,
    services: GlyphRootServices<ThreeBindings, void, ThreeRootBinding>,
    resources: ThreeRendererResources,
    options: ThreeRootOptions,
  ) {
    if (token !== threeTextConstructionToken) {
      throw new TypeError('Three roots must be selected from a Glyph Three handle');
    }
    this.name = name;
    this.#fonts = fonts;
    this.#services = services;
    this.#resources = resources;
    this.#capacity = normalizeGlyphBufferCapacity(
      options.capacity ?? { size: 4_096, policy: 'chunk' },
      'Three root capacity',
    );
    this.#compositing = normalizeThreeRootCompositing(options.compositing, 'Three root compositing');
    this.#drawRoot = new ThreeRootDrawObject((worldMatricesCurrent) => this.#commitTraversal(worldMatricesCurrent));
    this.#drawRoot.name = name === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${name}`;
    this.#drawRoot.matrixAutoUpdate = false;
    this.#renderer = new ThreeTextRenderPlanExecutor(resources, {
      drawRoot: this.#drawRoot,
      root: this,
      visibleObject: (object) => this.visible(object),
    });
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

  createText<Technique extends AnyRasterFormat>(properties: StandaloneTextProperties<Technique>): Text<Technique>;
  createText<const Selection extends AnyFontFaceSelection | string>(
    properties: Omit<StandaloneTextProperties<FontFaceRasterOf<Selection>>, 'font'> & { readonly font: Selection },
  ): Text<FontFaceRasterOf<Selection>>;
  createText<Technique extends AnyRasterFormat>(
    properties:
      | StandaloneTextProperties<Technique>
      | (Omit<StandaloneTextProperties<Technique>, 'font'> & { readonly font: AnyFontFaceSelection | string }),
  ): Text<Technique> {
    this.#assertActive();
    const selection = this.#resolveFontSelection(properties.font);
    if (!isFontFaceSelection(selection)) {
      return new Text(threeTextConstructionToken, properties as StandaloneTextProperties<Technique>, [], this);
    }
    const font = this.#fonts.acquire(selection);
    try {
      return new Text(
        threeTextConstructionToken,
        { ...properties, font } as StandaloneTextProperties<Technique>,
        [font],
        this,
      );
    } catch (error) {
      font.dispose();
      throw error;
    }
  }

  createTextGroup(options: TextGroupOptions = {}): TextGroup {
    this.#assertActive();
    return new TextGroup(threeTextConstructionToken, options, this);
  }

  /** @internal Host cleanup invoked after core stops publication for this root. */
  disposeHost(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#binding?.dispose();
      this.#binding = undefined;
    } finally {
      this.#drawRoot.removeFromParent();
      this.#scene = undefined;
    }
  }

  dispose(): void {
    this.disposeHost();
  }

  /** @internal Core services and renderer used by this root recipe. */
  get services(): GlyphRootServices<ThreeBindings, void, ThreeRootBinding> {
    return this.#services;
  }

  /** @internal Built-in Three decoder installed by the root recipe. */
  get renderer(): ThreeTextRenderPlanExecutor {
    return this.#renderer;
  }

  /** @internal Renderer resources shared by detached copies from this handle. */
  get rendererResources(): ThreeRendererResources {
    return this.#resources;
  }

  /** @internal Acquire one mounted immutable Font from this handle's loaded FontFace cache. */
  acquireFont<const Selection extends AnyFontFaceSelection>(selection: Selection): Font<FontFaceRasterOf<Selection>> {
    return this.#fonts.acquire(selection);
  }

  /** @internal Borrow the store-owned immutable source for a React render snapshot. */
  fontSource<const Selection extends AnyFontFaceSelection>(selection: Selection): Font<FontFaceRasterOf<Selection>> {
    return this.#fonts.peek(selection);
  }

  /** @internal Read readiness for React without observing or creating a Promise. */
  isFontLoaded(selection: AnyFontFaceSelection): boolean {
    return this.#fonts.isLoaded(selection);
  }

  /** @internal Load the exact technique selected by this root's owning handle. */
  loadFont(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection> {
    return this.#fonts.load(selection);
  }

  /** @internal Config schema boundary for this publication root. */
  boundary(material: ThreeTextMaterial | undefined): ThreeRootBinding {
    const implementation = this;
    return Object.freeze({
      drawRoot: this.#drawRoot,
      get root() {
        return implementation.#publicRoot ?? implementation;
      },
      material,
    });
  }

  /** @internal Connect renderer-facing root metadata to the public lifecycle proxy. */
  bindPublicRoot(root: ThreeRoot): void {
    if (this.#publicRoot !== undefined && this.#publicRoot !== root) {
      throw new Error('Three root public identity was already bound');
    }
    this.#publicRoot = root;
  }

  /** @internal Register one retained leaf with this publication root. */
  register(text: Text<AnyRasterFormat>): void {
    this.#assertActive();
    if (!this.#textOrders.has(text)) {
      if (this.#nextTextOrder > 0xffff_ffff) throw new RangeError('Three root text orders are exhausted');
      this.#textOrders.set(text, this.#nextTextOrder);
      this.#nextTextOrder += 1;
    }
    this.#texts.add(text);
    try {
      this.#rootBinding().reconcile(this.members());
    } catch (error) {
      this.#texts.delete(text);
      if (this.#texts.size === 0) {
        this.#binding?.dispose();
        this.#binding = undefined;
      }
      throw error;
    }
  }

  /** @internal Remove one retained leaf from this publication root. */
  unregister(text: Text<AnyRasterFormat>): void {
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
  publicationOrder(text: Text<AnyRasterFormat>): number {
    const order = this.#textOrders.get(text);
    if (order === undefined) throw new Error('Text does not belong to this Three root');
    return order;
  }

  /** @internal Invalidate inherited material state after a TextGroup change. */
  invalidateMaterial(): void {
    this.#binding?.invalidateMaterial();
  }

  /** @internal Measure one root member through the root-owned planner. */
  measurement(text: Text<AnyRasterFormat>): ParagraphLayoutSummary {
    this.#assertMember(text);
    return this.#rootBinding().measurement(text);
  }

  /** @internal Inspect one root member through the root-owned planner. */
  inspection(text: Text<AnyRasterFormat>): GlyphLayoutInspection {
    this.#assertMember(text);
    return this.#rootBinding().inspection(text);
  }

  /** @internal Cheap host-tree observation; semantic publication waits for the root draw traversal. */
  observeHostTree(text: THREE.Object3D): void {
    if (this.#disposed) return;
    const scene = nearestScene(text);
    if (scene === this.#scene && (scene === undefined || this.#drawRoot.parent === scene)) return;
    this.#services.invalidate();
    const texts = this.#renderMembers();
    if (this.#bindScene(texts)) this.#commitTraversal(false);
  }

  /** @internal Stable root membership snapshot used by measurement reconciliation. */
  members(): readonly Text<AnyRasterFormat>[] {
    return [...this.#texts].filter((text) => !text.disposed);
  }

  /** @internal Reconcile this root before the engine stages its contribution to `glyph.shape()`. */
  prepareShape(): import('../config/glyph.js').GlyphShapeOptions | false {
    this.#assertActive();
    const texts = this.#renderMembers();
    this.#needsInitialTransformSync ||= this.#bindScene(texts);
    if (texts.length === 0) {
      if (this.#binding === undefined) return false;
      this.#binding.reconcile([]);
    } else {
      validateTextDomains(texts);
      this.#rootBinding().reconcile(texts);
    }
    return this.#binding?.prepareShape() ?? false;
  }

  /** @internal Apply adapter bookkeeping after this root's renderer accepts its command buffer. */
  acceptShape(): void {
    this.#binding?.acceptShape();
    const texts = this.#renderMembers();
    this.#clearErrors(texts);
    if (this.#needsInitialTransformSync) {
      this.#needsInitialTransformSync = false;
      this.#syncTransforms(false, texts);
    }
  }

  /** @internal Preserve the last accepted draw state and attribute this root's rejected shape. */
  rejectShape(error: unknown): void {
    this.#binding?.rejectShape();
    this.#reportError(error, this.#renderMembers());
  }

  #syncTransforms(
    worldMatricesCurrent: boolean,
    texts: readonly Text<AnyRasterFormat>[] = this.#renderMembers(),
  ): void {
    if (!worldMatricesCurrent) {
      for (const text of texts) text.updateWorldMatrix(true, false);
    }
    this.#drawRoot.updateMatrixWorldWithoutCommit(true);
    this.#binding?.syncTransforms(worldMatricesCurrent);
  }

  #commitTraversal(worldMatricesCurrent: boolean): void {
    if (this.#disposed) return;
    const texts = this.#renderMembers();
    if (this.#binding?.needsReconcile(texts) === true) this.#services.invalidate();
    try {
      glyph.shape();
    } catch {
      // Every participating root received its attributed error before the global call threw.
    }
    try {
      this.#syncTransforms(worldMatricesCurrent, texts);
    } catch (error) {
      this.#reportError(error, texts);
    }
  }

  #reportError(error: unknown, texts: readonly Text<AnyRasterFormat>[]): void {
    const groups = new Set<TextGroup>();
    for (const text of texts) {
      reconciler.reportError(text, error);
      for (let parent = text.parent; parent !== null; parent = parent.parent) {
        if (parent instanceof TextGroup) groups.add(parent);
      }
    }
    for (const group of groups) textGroupErrors.reportError(group, error);
  }

  #clearErrors(texts: readonly Text<AnyRasterFormat>[]): void {
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
    this.#binding ??= new ThreeRootPublication(this.#capacity, this.#compositing, this);
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

  #bindScene(texts: readonly Text<AnyRasterFormat>[]): boolean {
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
    if (scene === this.#scene && (scene === undefined || this.#drawRoot.parent === scene)) return false;
    this.#drawRoot.removeFromParent();
    this.#scene = scene;
    if (scene !== undefined) {
      scene.add(this.#drawRoot);
    }
    return scene !== undefined;
  }

  #renderMembers(): readonly Text<AnyRasterFormat>[] {
    const members = this.#renderMemberScratch;
    members.length = 0;
    for (const text of this.#texts) {
      if (!text.disposed && nearestScene(text) !== undefined) members.push(text);
    }
    return members;
  }

  #assertMember(text: Text<AnyRasterFormat>): void {
    this.#assertActive();
    if (!this.#texts.has(text)) throw new Error('Text does not belong to this Three root');
  }

  #resolveFontSelection(
    selection: FontSelection<AnyRasterFormat> | AnyFontFaceSelection | string,
  ): FontSelection<AnyRasterFormat> | AnyFontFaceSelection {
    if (typeof selection !== 'string') return selection;
    const face = resolveFontFace(selection);
    if (face === undefined) {
      throw new FontLoadError('FONT_FACE_NOT_FOUND', `FontFace ${JSON.stringify(selection)} is not defined`);
    }
    return face;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error(`Three root ${JSON.stringify(this.name)} has been disposed`);
  }
}

export class Text<Technique extends AnyRasterFormat> extends THREE.Object3D {
  static {
    reconciler = {
      desired: (text) => text.#desired,
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

  readonly #ownedFonts: readonly Font<AnyRasterFormat>[];
  readonly #boundingBox = new THREE.Box3();
  #desired: DesiredTextState<Technique>;
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
    ownedFonts: readonly Font<AnyRasterFormat>[],
    root: ThreeRoot,
  ) {
    super();
    if (token !== threeTextConstructionToken) {
      throw new TypeError('Three Text must be created with handle.createText() or an R3F Text component');
    }
    if (root === undefined) {
      throw new TypeError('Three Text must be created by a Glyph Three root');
    }
    assertNoRawSpans(properties, 'Text properties');
    const desired = normalizeDesired(properties);
    this.#ownedFonts = ownedFonts;
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
    const nextRevision = checkedNextRevision(this.#desiredRevision);
    this.#binding?.stageUpdate(eraseTextTechnique(this), next as DesiredTextState<AnyRasterFormat>, nextRevision);
    this.#desired = next;
    this.#desiredRevision = nextRevision;
    this.#boundingBox.makeEmpty();
    this.#boundingBoxCurrent = false;
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
    const source = this as unknown as Text<AnyRasterFormat>;
    const glyphRenderOrderBase = binding.glyphRenderOrderBase(source, stableIds);
    const glyphs = createGlyphs({
      source,
      placements,
      geometry: this.#glyphGeometry(placements),
      resources: this.#root.rendererResources,
      renderOrderBase: glyphRenderOrderBase,
      copy: (renderer, boundary) => binding.copyGlyphs(eraseTextTechnique(this), stableIds, renderer, boundary),
    });
    let decorations: Decorations | undefined;
    try {
      decorations = createDecorations({
        source,
        resources: this.#root.rendererResources,
        renderOrderBase: glyphRenderOrderBase,
        copy: (renderer, boundary) => binding.copyDecorations(eraseTextTechnique(this), renderer, boundary),
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
    this.#root.observeHostTree(this);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unbind();
    this.#root.unregister(eraseTextTechnique(this));
    for (const font of this.#ownedFonts) font.dispose();
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
const textPresentations = new WeakMap<Text<AnyRasterFormat>, TextPresentation>();

export class TextGroup extends THREE.Object3D {
  static {
    textGroupErrors = {
      reportError: (group, error) => group.#reportError(error),
      clearError: (group) => group.#clearError(),
    };
  }
  readonly #pixelSnapping: boolean | undefined;
  readonly #root: ThreeRoot;
  #material: ThreeTextMaterial | undefined;
  readonly #texts: Text<AnyRasterFormat>[] = [];
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  /** Ordinary applications construct TextGroup through `handle.createTextGroup()`. */
  constructor(token: typeof threeTextConstructionToken, options: TextGroupOptions, root: ThreeRoot) {
    super();
    if (token !== threeTextConstructionToken) {
      throw new TypeError(
        'Three TextGroup must be created with handle.createTextGroup() or an R3F TextGroup component',
      );
    }
    if (root === undefined) {
      throw new TypeError('Three TextGroup must be created by a Glyph Three root');
    }
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('TextGroup options must be an object');
    }
    this.#pixelSnapping =
      options.pixelSnapping === undefined ? undefined : normalizePixelSnapping(options.pixelSnapping);
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
    const incoming: Text<AnyRasterFormat>[] = [];
    for (const child of children) collectTextTree(child, incoming);
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

  #assertRoot(texts: readonly Text<AnyRasterFormat>[]): void {
    for (const text of texts) {
      if (reconciler.root(text) !== this.#root) {
        throw new TypeError('one Three TextGroup cannot contain Text objects from different Glyph roots');
      }
    }
  }
}

interface BoundTextEntry {
  readonly handle: GlyphTextController<AnyRasterFormat, ThreeMaterialBinding, THREE.Object3D>;
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
  readonly #services: GlyphRootServices<ThreeBindings, void, ThreeRootBinding>;
  readonly #root: ThreeRoot;
  readonly #target: ThreeTextRenderPlanExecutor;
  readonly #entries = new Map<Text<AnyRasterFormat>, BoundTextEntry>();
  readonly #inspections = new Map<Text<AnyRasterFormat>, CanonicalInspection>();
  readonly #materialBindings = new ThreeMaterialBindingCache();
  #capacity: GlyphBufferCapacity;
  #compositing: 'ordered' | 'independent';
  #rendererUpdateRejected = false;
  #capacityExceeded: { readonly required: number; readonly size: number } | undefined;
  #materialInvalidated = false;
  #disposed = false;

  constructor(capacity: GlyphBufferCapacity, compositing: 'ordered' | 'independent', root: ThreeRoot) {
    this.#services = root.services;
    this.#root = root;
    this.#capacity = capacity;
    this.#compositing = compositing;
    this.#target = root.renderer;
  }

  get textCount(): number {
    return this.#entries.size;
  }
  get gpuBytes(): number {
    return this.#target.gpuBytes;
  }
  get capacityExceeded(): { readonly required: number; readonly size: number } | undefined {
    return this.#capacityExceeded;
  }

  invalidateMaterial(): void {
    this.#assertActive();
    this.#materialInvalidated = true;
    this.#services.invalidate();
  }

  reconcile(texts: readonly Text<AnyRasterFormat>[]): void {
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
        this.#stage(text, reconciler.desired(text), revision, order, presentation);
      }
      reconciler.bind(text, this, presentation.group);
    }
    this.#materialInvalidated = false;
  }

  needsReconcile(texts: readonly Text<AnyRasterFormat>[]): boolean {
    this.#assertActive();
    if (this.#materialInvalidated || texts.length !== this.#entries.size) return true;
    for (const text of texts) {
      const entry = this.#entries.get(text);
      if (
        entry === undefined ||
        entry.stagedRevision !== reconciler.desiredRevision(text) ||
        entry.stagedOrder !== this.#root.publicationOrder(text) ||
        !sameTextPresentation(entry.stagedPresentation, resolveTextPresentation(text))
      ) {
        return true;
      }
    }
    return false;
  }

  stageUpdate(text: Text<AnyRasterFormat>, desired: DesiredTextState<AnyRasterFormat>, revision: number): void {
    this.#assertActive();
    const entry = this.#entries.get(text);
    if (entry === undefined) return;
    this.#stage(text, desired, revision, entry.stagedOrder, resolveTextPresentation(text));
  }

  removeText(text: Text<AnyRasterFormat>): void {
    const entry = this.#entries.get(text);
    if (entry === undefined) {
      reconciler.unbindFrom(text, this);
      return;
    }
    entry.handle.dispose();
    this.#entries.delete(text);
    this.#inspections.delete(text);
    reconciler.unbindFrom(text, this);
  }

  measurement(text: Text<AnyRasterFormat>): ParagraphLayoutSummary {
    this.#assertActive();
    this.reconcile(this.#root.members());
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('Text is not retained by this batch');
    const measurement = entry.handle.measure();
    reconciler.publishMeasurement(text, measurement);
    return measurement;
  }

  inspection(text: Text<AnyRasterFormat>): GlyphLayoutInspection {
    this.#assertActive();
    this.reconcile(this.#root.members());
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('Text is not retained by this batch');
    const inspection = entry.handle.inspect();
    reconciler.publishMeasurement(text, inspection);
    return inspection;
  }

  glyphPlacements(text: Text<AnyRasterFormat>): GlyphPlacements | undefined {
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

  glyphRenderOrderBase(text: Text<AnyRasterFormat>, stableIds: Uint32Array): number {
    this.#assertActive();
    if (!this.#entries.has(text)) throw new Error('cannot inspect draw order for an unbound text paragraph');
    return this.#target.renderOrderBaseForGlyphs(stableIds) ?? text.renderOrder;
  }

  copyGlyphs(
    text: Text<AnyRasterFormat>,
    stableIds: Uint32Array,
    renderer: ThreeTextRenderPlanExecutor,
    boundary: ThreeRootBinding,
  ): GlyphCopy<void> {
    this.#assertActive();
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('cannot copy an unbound text paragraph');
    return this.#services.copy(entry.handle, { kind: 'glyphs', stableIds }, { boundary, renderer });
  }

  copyDecorations(
    text: Text<AnyRasterFormat>,
    renderer: ThreeTextRenderPlanExecutor,
    boundary: ThreeRootBinding,
  ): GlyphCopy<void> {
    this.#assertActive();
    const entry = this.#entries.get(text);
    if (entry === undefined) throw new Error('cannot copy decorations from an unbound text paragraph');
    return this.#services.copy(entry.handle, { kind: 'decorations' }, { boundary, renderer });
  }

  prepareShape(): import('../config/glyph.js').GlyphShapeOptions | false {
    this.#assertActive();
    let required = 0;
    for (const text of this.#entries.keys()) required += text.text.length;
    if (this.#capacity.policy === 'fixed' && required > this.#capacity.size) {
      this.#capacityExceeded = Object.freeze({ required, size: this.#capacity.size });
      return false;
    }
    this.#capacityExceeded = undefined;
    return Object.freeze({ semanticViews: 'measurement', compositing: this.#compositing });
  }

  acceptShape(): void {
    this.#assertActive();
    this.#rendererUpdateRejected = false;
    this.#inspections.clear();
    for (const [text, entry] of this.#entries) {
      entry.committedRevision = entry.stagedRevision;
      reconciler.markCommitted(text);
      reconciler.publishMeasurement(text, entry.handle.measure());
    }
  }

  rejectShape(): void {
    this.#assertActive();
    this.#rendererUpdateRejected = true;
  }

  syncTransforms(worldMatricesCurrent: boolean): void {
    this.#assertActive();
    this.#target.synchronizeTransforms(worldMatricesCurrent, () => this.#services.syncTransforms());
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
      reconciler.unbindFrom(text, this);
    }
    this.#entries.clear();
    if (failure !== undefined) throw failure;
  }

  #stage(
    text: Text<AnyRasterFormat>,
    desired: DesiredTextState<AnyRasterFormat>,
    revision: number,
    order: number,
    presentation: TextPresentation,
  ): void {
    const previous = this.#entries.get(text);
    const state = coreTextState(
      desired,
      text,
      presentation,
      this.#root,
      order,
      (material, pixelSnapping, renderOrder) => this.#materialBindings.get(material, pixelSnapping, renderOrder),
    );
    if (previous === undefined) {
      const handle = this.#services.createText(state);
      this.#entries.set(text, {
        handle,
        stagedRevision: revision,
        stagedOrder: order,
        stagedPresentation: presentation,
        committedRevision: -1,
      });
    } else {
      previous.handle.update(state);
      previous.stagedRevision = revision;
      previous.stagedOrder = order;
      previous.stagedPresentation = presentation;
    }
    this.#inspections.delete(text);
  }

  #canonicalInspection(text: Text<AnyRasterFormat>): GlyphLayoutInspection | undefined {
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
    const inspection = entry.handle.inspect();
    this.#inspections.set(text, { revision: entry.committedRevision, value: inspection });
    return inspection;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three text batch has been disposed');
  }
}

function coreTextState(
  desired: DesiredTextState<AnyRasterFormat>,
  transform: THREE.Object3D,
  presentation: TextPresentation,
  root: ThreeRoot,
  order: number,
  materialBinding: (
    material: ThreeTextMaterial | undefined,
    pixelSnapping: boolean,
    renderOrder: number,
  ) => ThreeMaterialBinding,
) {
  const { pixelSnapping, renderOrder } = presentation;
  const material = materialBinding(
    desired.material ?? presentation.material ?? root.material,
    pixelSnapping,
    renderOrder,
  );
  const spans = desired.spans.map((span) => {
    const spanMaterial: ThreeMaterialBinding | undefined =
      span.material === undefined ? undefined : materialBinding(span.material, pixelSnapping, renderOrder);
    return Object.freeze({
      start: span.start,
      end: span.end,
      ...(span.font === undefined ? {} : { font: span.font }),
      ...(spanMaterial === undefined ? {} : { material: spanMaterial }),
      ...(span.style === undefined ? {} : { style: span.style }),
    });
  });
  return {
    font: desired.font,
    text: Object.freeze({ text: desired.text, spans: Object.freeze(spans) }),
    transform,
    order,
    material,
    ...(desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: desired.rasterPixelRatio }),
    style: desired.style,
    layout: desired.layout,
    constraints: desired.constraints,
  };
}

class ThreeMaterialBindingCache {
  readonly #default = new Map<string, ThreeMaterialBinding>();
  readonly #custom = new WeakMap<ThreeTextMaterial, Map<string, ThreeMaterialBinding>>();

  get(material: ThreeTextMaterial | undefined, pixelSnapping: boolean, renderOrder: number): ThreeMaterialBinding {
    let variants: Map<string, ThreeMaterialBinding>;
    if (material === undefined) {
      variants = this.#default;
    } else {
      variants = this.#custom.get(material) ?? new Map();
      this.#custom.set(material, variants);
    }
    const key = `${pixelSnapping ? 1 : 0}:${String(renderOrder)}`;
    let binding = variants.get(key);
    if (binding === undefined) {
      binding = Object.freeze({ material, pixelSnapping, renderOrder });
      variants.set(key, binding);
    }
    return binding;
  }
}

function normalizeDesired<Technique extends AnyRasterFormat>(
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
  const rootTechniques = immutableFontSelectionFonts(properties.font).map((font) => font.raster);
  const inheritedTechniques = [
    ...rootTechniques,
    ...spans.flatMap((span) =>
      span.font === undefined ? [] : immutableFontSelectionFonts(span.font).map((font) => font.raster),
    ),
  ];
  assertTextEffectsSupported(style, inheritedTechniques, 'Text style');
  for (const [index, span] of spans.entries()) {
    if (span.style === undefined) continue;
    assertTextEffectsSupported(
      span.style,
      span.font === undefined ? rootTechniques : immutableFontSelectionFonts(span.font).map((font) => font.raster),
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

function isFormattedText(value: unknown): value is FormattedText<AnyRasterFormat> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { text?: unknown }).text === 'string' &&
    Array.isArray((value as { spans?: unknown }).spans)
  );
}

function assertSpanRanges<Technique extends AnyRasterFormat>(
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

function assertSpansNest<Technique extends AnyRasterFormat>(spans: readonly TextSpan<Technique>[]): void {
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

function eraseTextTechnique<Technique extends AnyRasterFormat>(text: Text<Technique>): Text<AnyRasterFormat> {
  return text as unknown as Text<AnyRasterFormat>;
}

function collectTextDescendants(group: TextGroup, result: Text<AnyRasterFormat>[]): Text<AnyRasterFormat>[] {
  result.length = 0;
  for (const child of group.children) collectTextTree(child, result);
  return result;
}

function collectTextTree(object: THREE.Object3D, result: Text<AnyRasterFormat>[]): void {
  if (object instanceof Text && !object.disposed) result.push(object as Text<AnyRasterFormat>);
  for (const child of object.children) collectTextTree(child, result);
}

function orderedTexts(
  texts: readonly Text<AnyRasterFormat>[],
  root: ThreeRoot,
): readonly Readonly<{ order: number; text: Text<AnyRasterFormat>; presentation: TextPresentation }>[] {
  return texts.map((text) => ({
    order: root.publicationOrder(text),
    text,
    presentation: resolveTextPresentation(text),
  }));
}

function resolveTextPresentation(text: Text<AnyRasterFormat>): TextPresentation {
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

function validateTextDomains(texts: readonly Text<AnyRasterFormat>[]): void {
  let root: ThreeRoot | undefined;
  for (const text of texts) {
    if (text.disposed) throw new TypeError('disposed Text cannot be attached');
    const candidate = reconciler.root(text);
    if (root !== undefined && candidate !== root) {
      throw new TypeError('one TextGroup cannot span different Glyph roots');
    }
    root = candidate;
  }
}

function checkedNextRevision(current: number): number {
  const next = current + 1;
  if (!Number.isSafeInteger(next)) throw new RangeError('Text revisions are exhausted');
  return next;
}
