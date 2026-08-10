import * as THREE from 'three/webgpu';

import type { FormattedText, GlyphPaintInput, ParagraphSpan, TextInput } from '../formatted-text.js';
import {
  acquireFontSelectionForRuntime,
  assertFontSelectionForRuntime,
  concreteFonts,
  releaseFontSelection,
  type FontSelection,
  type LoadedFont,
} from '../loaded-font.js';
import type {
  GlyphBufferCapacity,
  ParagraphBaseProperties,
  ParagraphContentBox,
  ParagraphProperties,
  ParagraphStyle,
} from '../text-properties.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import {
  compileTextEngineFrameUpdate,
  type TextEngineConstraint,
  type TextEngineFrameLimits,
  type TextEngineRegion,
  type TextEngineStyleMutation,
  type TextEngineStyleValue,
  type TextEngineTextMutation,
} from '../internal/engine-frame-wire.js';
import {
  TextEngineStatusError,
  type TextEnginePublication,
  type TextEngineSession,
} from '../internal/text-engine-host.js';
import { readTextEngineLayouts, readTextEngineMeasurements } from '../internal/layout-query-view.js';
import type { ParagraphLayoutInspection, ParagraphLayoutSummary } from '../layout.js';
import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { ThreeTextRenderPlanExecutor } from './engine-plan-target.js';
import {
  threeTextEngineCoordinator,
  type ThreeTextMaterialLease,
  type ThreeTextEngineCoordinator,
  type ThreeTextEngineStackLease,
} from './engine-runtime.js';
import type { ThreeTextMaterial } from './material.js';

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
  Readonly<{ capacity?: GlyphBufferCapacity }>;

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
}

export interface TextGlyphOriginSnapshot {
  readonly layout: ParagraphLayoutInspection;
  readonly shapedX: Float32Array;
  readonly shapedY: Float32Array;
  readonly displayedX: Float32Array;
  readonly displayedY: Float32Array;
}

export interface TextGlyphOriginUpdate {
  readonly layout: ParagraphLayoutInspection;
  readonly x: Float32Array;
  readonly y: Float32Array;
}

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

export class Text<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  readonly #runtime: TextRuntime;
  #desired: DesiredTextState<Technique>;
  #leasedFonts: readonly LoadedFont<Technique>[];
  #standaloneCapacity: GlyphBufferCapacity;
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
  }

  get textGroup(): TextGroup | undefined {
    return this.#textGroup;
  }
  get bound(): boolean {
    return this.#binding !== undefined;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get error(): unknown {
    return this.#error ?? this.#binding?.error;
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
    const next = normalizeDesired({ ...this.#desired, ...normalizedUpdate } as TextProperties<Technique>);
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

  insertText(offset: number, value: string): void {
    this.replaceText(offset, offset, value);
  }

  deleteText(start: number, end: number): void {
    this.replaceText(start, end, '');
  }

  replaceText(start: number, end: number, value: string): void {
    this.#assertActive();
    assertTextRange(this.#desired.text, start, end);
    if (typeof value !== 'string') throw new TypeError('replacement text must be a string');
    if (start === end && value.length === 0) return;
    const text = this.#desired.text.slice(0, start) + value + this.#desired.text.slice(end);
    const spans = editSpans(this.#desired.spans, start, end, value.length);
    this.set({ text, spans } as TextUpdate<Technique>);
  }

  setSpan(index: number, span: TextSpan<Technique>): void {
    const spans = [...this.spans];
    if (!Number.isSafeInteger(index) || index < 0 || index >= spans.length)
      throw new RangeError('span index is outside the text');
    spans[index] = span;
    this.spans = spans;
  }

  removeSpan(index: number): void {
    const spans = [...this.spans];
    if (!Number.isSafeInteger(index) || index < 0 || index >= spans.length)
      throw new RangeError('span index is outside the text');
    spans.splice(index, 1);
    this.spans = spans;
  }

  setCapacity(capacity: GlyphBufferCapacity): void {
    this.#assertActive();
    this.#standaloneCapacity = normalizeCapacity(capacity);
    if (this.#textGroup === undefined) this.#binding?.setCapacity(this.#standaloneCapacity);
  }
  retry(): void {
    this.#assertActive();
    this.#binding?.retry();
  }
  /** Performs one explicit Rust query when this committed layout has not already been measured. */
  measureLayout(): ParagraphLayoutSummary | undefined {
    this.#assertActive();
    return this.#binding?.measurement(eraseTextTechnique(this));
  }
  /** Copies the committed per-line and per-glyph Rust layout only when explicitly requested. */
  inspectLayout(): ParagraphLayoutInspection | undefined {
    this.#assertActive();
    return this.#binding?.layoutInspection(eraseTextTechnique(this));
  }
  snapshotGlyphOrigins(): TextGlyphOriginSnapshot | undefined {
    this.#assertActive();
    return this.#binding?.glyphOriginSnapshot(eraseTextTechnique(this));
  }
  setGlyphOrigins(update: TextGlyphOriginUpdate): void {
    this.#assertActive();
    if (this.#binding === undefined) throw new Error('glyph origins require a bound Text');
    this.#binding.setGlyphOrigins(eraseTextTechnique(this), update);
  }
  clearGlyphOriginOverrides(): void {
    this.#assertActive();
    this.#binding?.clearGlyphOrigins(eraseTextTechnique(this));
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
      boundary.bindText(eraseTextTechnique(this));
    } else if (this.parent !== null) {
      if (this.#binding === undefined || this.#textGroup !== undefined) {
        this.#unbind();
        this.#binding = new ThreeTextBatchBinding(this.#runtime, this.#standaloneCapacity, undefined);
      }
      this.#binding.reconcileStandalone(eraseTextTechnique(this));
      try {
        this.#binding.synchronize();
        this.#error = undefined;
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

  coreProperties(): ParagraphProperties<Technique> {
    return {
      ...this.#desired,
      order: this.renderOrder,
      ...(this.#desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: this.#desired.rasterPixelRatio }),
    };
  }
  needsApply(): boolean {
    return this.#desiredRevision !== this.#appliedRevision;
  }
  semanticChanges(): number {
    return this.#semanticChanges;
  }
  textMutations(): readonly PendingTextMutation[] {
    return this.#textMutations;
  }
  markApplied(): void {
    this.#appliedRevision = this.#desiredRevision;
    this.#semanticChanges = 0;
    this.#textMutations.length = 0;
  }
  bind(binding: ThreeTextBatchBinding, group: TextGroup | undefined): void {
    if (this.#binding !== binding) this.#unbind();
    this.#binding = binding;
    this.#textGroup = group;
    this.#appliedRevision = this.#desiredRevision;
  }
  unbindFrom(binding: ThreeTextBatchBinding): void {
    if (this.#binding !== binding) return;
    this.#binding = undefined;
    this.#textGroup = undefined;
  }
  get runtime(): TextRuntime {
    return this.#runtime;
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
  #material: ThreeTextMaterial | undefined;
  #binding: ThreeTextBatchBinding | undefined;
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(options: TextGroupOptions = {}) {
    super();
    this.#capacity = normalizeCapacity(options.capacity ?? { size: 4_096, policy: 'chunk' });
    this.#compositing = normalizeCompositing(options.compositing);
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
  get disposed(): boolean {
    return this.#disposed;
  }
  get error(): unknown {
    return this.#error ?? this.#binding?.error;
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
  retry(): void {
    this.#assertActive();
    this.#binding?.retry();
  }
  override clone(_recursive?: boolean): never {
    throw new Error('TextGroup cannot be cloned');
  }
  override copy(_source: THREE.Object3D, _recursive?: boolean): never {
    throw new Error('TextGroup cannot be copied');
  }

  override updateMatrixWorld(force?: boolean): void {
    if (!this.#disposed) {
      const texts = collectTextDescendants(this);
      if (texts.length !== 0) {
        const first = texts[0]!;
        validateText(first);
        this.#binding ??= new ThreeTextBatchBinding(first.runtime, this.#capacity, this);
        this.#binding.reconcile(texts);
        try {
          this.#binding.synchronize();
          this.#error = undefined;
        } catch (error) {
          this.#error = error;
          this.onError?.(error);
        }
      } else if (this.#binding !== undefined) {
        this.#binding.reconcile([]);
        try {
          this.#binding.synchronize();
          this.#error = undefined;
        } catch (error) {
          this.#error = error;
          this.onError?.(error);
        }
      }
    }
    super.updateMatrixWorld(force);
  }

  bindText(text: Text<AnyRasterTechnique>): void {
    if (this.#disposed) return;
    validateText(text);
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
  #nextParagraphId = 1;
  #engineRevision = 0;
  #planRevision = 0;
  #acknowledgedPublicationGeneration = 0;
  #lastPublication: TextEnginePublication | undefined;
  #requestCapacity: number;
  #resultCapacity: number;
  #textCapacity: number;
  #materialInvalidated = false;
  #disposed = false;

  constructor(runtime: TextRuntime, capacity: GlyphBufferCapacity, group: TextGroup | undefined) {
    this.#runtime = runtime;
    this.#group = group;
    this.#coordinator = threeTextEngineCoordinator(runtime);
    this.#requestCapacity = Math.max(64 * 1024, capacity.size * 32);
    this.#resultCapacity = Math.max(256 * 1024, capacity.size * 160);
    this.#textCapacity = capacity.size;
    this.#session = this.#coordinator.createSession({
      requestCapacity: this.#requestCapacity,
      resultCapacity: this.#resultCapacity,
      textCapacity: this.#textCapacity,
    });
    const owner = this;
    this.#target = new ThreeTextRenderPlanExecutor(this.#coordinator, {
      get drawRoot() {
        return owner.#drawRoot();
      },
      get renderOrderBase() {
        return owner.#renderOrderBase();
      },
      objectForTransform(transformId) {
        const text = owner.#textsByParagraph.get(transformId);
        if (text === undefined) throw new Error(`Three command buffer references unknown transform ${transformId}`);
        return text;
      },
    });
  }
  get textCount(): number {
    return this.#paragraphs.size;
  }
  get error(): unknown {
    return undefined;
  }
  get gpuBytes(): number {
    return this.#target.gpuBytes;
  }
  get renderOrderBase(): number {
    return this.#group?.renderOrder ?? 0;
  }
  measurement(text: Text<AnyRasterTechnique>): ParagraphLayoutSummary | undefined {
    if (!this.#paragraphs.has(text)) return undefined;
    this.synchronize(textShaperAbi.engine.semanticViewMasks.measurement);
    return this.#measurements.get(text);
  }
  layoutInspection(text: Text<AnyRasterTechnique>): ParagraphLayoutInspection | undefined {
    if (!this.#paragraphs.has(text)) return undefined;
    this.synchronize(textShaperAbi.engine.semanticViewMasks.layoutInspection);
    return this.#layoutInspections.get(text);
  }
  glyphOriginSnapshot(text: Text<AnyRasterTechnique>): TextGlyphOriginSnapshot | undefined {
    const layout = this.layoutInspection(text);
    if (layout === undefined) return undefined;
    return { layout, ...this.#target.snapshotGlyphOrigins(layout.glyphStableIds, layout.x, layout.y) };
  }
  setGlyphOrigins(text: Text<AnyRasterTechnique>, update: TextGlyphOriginUpdate): void {
    const layout = this.layoutInspection(text);
    if (layout === undefined || update.layout !== layout) {
      throw new TypeError('glyph origins do not match the committed layout inspection');
    }
    if (update.x.length !== layout.glyphStableIds.length || update.y.length !== layout.glyphStableIds.length) {
      throw new RangeError('glyph origin arrays do not match the inspected glyph count');
    }
    this.#target.setGlyphOriginOverrides(layout.glyphStableIds, update.x, update.y);
  }
  clearGlyphOrigins(text: Text<AnyRasterTechnique>): void {
    const layout = this.#layoutInspections.get(text);
    if (layout !== undefined) this.#target.clearGlyphOriginOverrides(layout.glyphStableIds);
  }
  reconcile(texts: readonly Text<AnyRasterTechnique>[]): void {
    const desired = new Set(texts);
    for (const text of [...this.#paragraphs.keys()]) if (!desired.has(text)) this.removeText(text);
    for (const text of texts) this.#ensureText(text, this.#group);
  }
  reconcileStandalone(text: Text<AnyRasterTechnique>): void {
    this.#ensureText(text, undefined);
  }
  synchronize(semanticViewMask = 0): void {
    if (this.#disposed) return;
    const ordered = [...this.#paragraphs.entries()].sort(
      ([leftText, left], [rightText, right]) => leftText.renderOrder - rightText.renderOrder || left.id - right.id,
    );
    const changed = ordered.flatMap(([text, paragraph], order) => {
      const semanticChanges =
        (paragraph.created ? ALL_SEMANTIC_CHANGES : text.semanticChanges()) |
        (this.#materialInvalidated ? STYLE_CHANGE : 0);
      return semanticChanges !== 0 || text.needsApply() || paragraph.order !== order
        ? [{ text, paragraph, order, semanticChanges }]
        : [];
    });
    if (changed.length === 0 && this.#removed.length === 0) {
      this.#target.syncTransforms();
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
        const properties = text.coreProperties();
        const content = properties.text as string;
        if (semanticChanges & TEXT_CHANGE) {
          const pending = paragraph.created ? [{ start: 0, deleteCount: 0, insert: content }] : text.textMutations();
          for (const mutation of pending) textMutations.push({ paragraphId: paragraph.id, ...mutation });
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
          const geometry = compileEngineGeometry(paragraph, properties.contentBox, regions.length, content.length);
          constraints.push(geometry.constraint);
          regions.push(geometry.region);
        }
      }
      const totalTextLength = [...this.#paragraphs.keys()].reduce((total, text) => total + text.text.length, 0);
      const limits = engineLimits(
        Math.max(this.#paragraphs.size, paragraphMutations.length),
        totalTextLength,
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
      this.#planRevision = publication.planRevision;
      for (const removed of this.#removed) releaseStackLeases(removed.stackLeases);
      for (const removed of this.#removed) releaseMaterialLeases(removed.materialLeases);
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
          paragraph.styleCount = 1 + text.spans.length;
        }
        if (semanticChanges & TEXT_CHANGE) paragraph.textLength = text.text.length;
        if (semanticChanges & GEOMETRY_CHANGE) paragraph.geometryRevision += 1;
        paragraph.created = false;
        text.markApplied();
        paragraph.order = order;
      }
      this.#materialInvalidated = false;
      this.#measurements.clear();
      this.#layoutInspections.clear();
      committed = true;
      try {
        this.#target.apply(publication);
        this.#lastPublication = undefined;
      } catch (error) {
        this.#lastPublication = ownPublication(publication);
        throw error;
      }
      this.#acknowledgedPublicationGeneration = publication.publicationGeneration;
      this.#retainSemanticViews(publication, semanticViewMask);
    } catch (error) {
      if (!committed) {
        for (const leases of pendingLeases.values()) releaseStackLeases(leases);
        for (const leases of pendingMaterials.values()) releaseMaterialLeases(leases);
      }
      throw error;
    }
  }
  setCapacity(value: GlyphBufferCapacity): void {
    this.#requestCapacity = Math.max(this.#requestCapacity, value.size * 32);
    this.#resultCapacity = Math.max(this.#resultCapacity, value.size * 160);
    this.#textCapacity = Math.max(this.#textCapacity, value.size);
    this.#session.reserve(this.#requestCapacity, this.#resultCapacity, this.#textCapacity);
  }
  invalidateMaterial(): void {
    this.#materialInvalidated = true;
  }
  retry(): void {
    const publication = this.#lastPublication;
    if (publication === undefined) return;
    this.#target.apply(publication);
    this.#acknowledgedPublicationGeneration = publication.publicationGeneration;
    this.#lastPublication = undefined;
  }
  removeText(text: Text<AnyRasterTechnique>): void {
    const paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined) return;
    this.#paragraphs.delete(text);
    this.#textsByParagraph.delete(paragraph.id);
    this.#removed.push(paragraph);
    text.unbindFrom(this);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const text of this.#paragraphs.keys()) text.unbindFrom(this);
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
  }
  #ensureText(text: Text<AnyRasterTechnique>, group: TextGroup | undefined): void {
    validateBinding(this.#runtime, text);
    let paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined) {
      const id = this.#nextParagraphId++;
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
      text.bind(this, group);
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

  #querySemanticViews(semanticViewMask: number): TextEnginePublication {
    const totalTextLength = [...this.#paragraphs.keys()].reduce((total, entry) => total + entry.text.length, 0);
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
          this.#paragraphs.size,
          MAX_TEXT_ENGINE_OUTPUT_BYTES,
        ),
      }),
    );
    this.#engineRevision = publication.engineRevision;
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
  properties: ParagraphProperties<Technique>,
  groupMaterial: ThreeTextMaterial | undefined,
  leases: ThreeTextEngineStackLease[],
  materialLeases: ThreeTextMaterialLease[],
): TextEngineStyleMutation[] {
  const text = properties.text as string;
  const rootStack = acquireEngineStack(coordinator, properties.font, leases);
  const rootMaterial = (properties as TextProperties<Technique>).material ?? groupMaterial;
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
  for (const [index, span] of (properties.spans ?? []).entries()) {
    const fontStackHandle = span.font === undefined ? undefined : acquireEngineStack(coordinator, span.font, leases);
    const materialId = acquireEngineMaterial(coordinator, (span as TextSpan<Technique>).material, materialLeases);
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

function engineStyleValue(
  style: ParagraphStyle,
  paint: GlyphPaintInput | undefined,
  start: number,
  end: number,
  base: TextEngineStyleValue,
): TextEngineStyleValue {
  return {
    ...base,
    ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize }),
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
    ...(style.letterSpacing === undefined ? {} : { letterSpacing: style.letterSpacing }),
    ...(style.language === undefined ? {} : { language: style.language }),
    ...(style.direction === undefined ? {} : { direction: style.direction }),
    ...(style.features === undefined
      ? {}
      : {
          features: style.features.map((feature) => ({
            tag: feature.tag,
            value: feature.value ?? 1,
            start: feature.start ?? start,
            end: feature.end ?? end,
          })),
        }),
    ...(paint === undefined ? {} : { foregroundRgba: packedForeground(paint) }),
  };
}

function compileEngineGeometry(
  paragraph: RetainedEngineParagraph,
  contentBox: ParagraphContentBox | undefined,
  regionStart: number,
  textLength: number,
): { readonly constraint: TextEngineConstraint; readonly region: TextEngineRegion } {
  const width = axis(contentBox?.width);
  const height = axis(contentBox?.height);
  const inlineEnd = width.mode === 'unconstrained' ? 0x01_00_00_00 : width.size;
  const blockEnd = height.mode === 'unconstrained' ? 0x01_00_00_00 : height.size;
  const maxLines = contentBox?.maxLines ?? Math.max(1, textLength);
  const geometryRevision = paragraph.geometryRevision + 1;
  return {
    constraint: {
      paragraphId: paragraph.id,
      flowThreadId: paragraph.id,
      geometryRevision,
      width: width.size,
      height: height.size,
      viewportBlockStart: 0,
      viewportBlockEnd: blockEnd,
      resumeBlockOffset: 0,
      maxLines,
      regionStart,
      resumeCluster: 0,
      regionCount: 1,
      resumeRegion: 0,
      widthMode: width.mode,
      heightMode: height.mode,
      wrap: contentBox?.wrap ?? 'word',
      align: contentBox?.align ?? 'start',
      overflow: contentBox?.overflow ?? 'visible',
      blockAlign: 'start',
    },
    region: {
      id: paragraph.id,
      geometryRevision,
      transformIndex: paragraph.id,
      shape: 'rectangle',
      exclusionStart: 0,
      exclusionCount: 0,
      writingMode: 'horizontal-tb',
      textOrientation: 'mixed',
      inlineStart: 0,
      blockStart: 0,
      inlineEnd,
      blockEnd,
      clipInlineStart: 0,
      clipBlockStart: 0,
      clipInlineEnd: inlineEnd,
      clipBlockEnd: blockEnd,
    },
  };
}

function axis(value: ParagraphContentBox['width'] | undefined): {
  readonly mode: 'unconstrained' | 'at-most' | 'exact';
  readonly size: number;
} {
  if (value === undefined || value.mode === 'unconstrained') return { mode: 'unconstrained', size: 0 };
  return { mode: value.mode, size: value.size };
}

function engineLimits(
  paragraphCount: number,
  textLength: number,
  regionCount: number,
  maxOutputBytes: number,
  mutationRecordCount = 0,
): TextEngineFrameLimits {
  return {
    maxParagraphs: Math.max(1, paragraphCount),
    maxClusters: Math.max(1, textLength * 2, mutationRecordCount),
    maxLines: Math.max(1, textLength),
    maxRegions: Math.max(1, regionCount),
    maxExclusions: 1,
    maxInlineObjects: 1,
    maxSlotsPerBand: 8,
    maxOutputBytes,
  };
}

function packedForeground(paint: GlyphPaintInput): number {
  const opacity = paint.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError('opacity must be in [0, 1]');
  }
  const input = paint.color ?? '#ffffff';
  const rgba = typeof input === 'string' ? parseHexColorBytes(input) : linearColorBytes(input);
  const alpha = Math.round(rgba[3] * opacity);
  return (rgba[0] | (rgba[1] << 8) | (rgba[2] << 16) | (alpha << 24)) >>> 0;
}

function parseHexColorBytes(value: string): readonly [number, number, number, number] {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value);
  if (match === null) throw new TypeError('colors must be #rrggbb, #rrggbbaa, or linear RGBA');
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6), 16) : 255,
  ];
}

function linearColorBytes(color: readonly number[]): readonly [number, number, number, number] {
  if (color.length !== 4 || color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('linear RGBA colors must contain four finite channels in [0, 1]');
  }
  const srgbByte = (value: number): number => {
    const srgb = value <= 0.003_130_8 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };
  return [srgbByte(color[0]!), srgbByte(color[1]!), srgbByte(color[2]!), Math.round(color[3]! * 255)];
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

/**
 * Replacement text carries its own formatting: a literal brings its spans and a
 * plain string brings none. Retaining the previous spans would reinterpret them
 * against unrelated text, so an update that replaces text without stating spans
 * clears the ones it replaced.
 */
function replacedContent<Technique extends AnyRasterTechnique>(update: TextUpdate<Technique>): TextUpdate<Technique> {
  if (!('text' in update) || 'spans' in update) return update;
  return { ...update, spans: [] } as TextUpdate<Technique>;
}

function minimalTextMutation(previous: string, next: string): PendingTextMutation | undefined {
  if (previous === next) return undefined;
  const shared = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shared) {
    const previousCodePoint = previous.codePointAt(start)!;
    if (previousCodePoint !== next.codePointAt(start)) break;
    start += previousCodePoint > 0xffff ? 2 : 1;
  }
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start) {
    const previousStart = previousScalarStart(previous, previousEnd);
    const nextStart = previousScalarStart(next, nextEnd);
    if (previous.codePointAt(previousStart) !== next.codePointAt(nextStart)) break;
    previousEnd = previousStart;
    nextEnd = nextStart;
  }
  return {
    start,
    deleteCount: previousEnd - start,
    insert: next.slice(start, nextEnd),
  };
}

function previousScalarStart(value: string, end: number): number {
  const last = end - 1;
  const unit = value.charCodeAt(last);
  const previous = value.charCodeAt(last - 1);
  return unit >= 0xdc00 && unit <= 0xdfff && last > 0 && previous >= 0xd800 && previous <= 0xdbff ? last - 1 : last;
}

function assertTextRange(text: string, start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > text.length) {
    throw new RangeError('text edit range is outside the text');
  }
  if (splitsSurrogatePair(text, start) || splitsSurrogatePair(text, end)) {
    throw new RangeError('text edit range must not split a Unicode scalar');
  }
}

function splitsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function editSpans<Technique extends AnyRasterTechnique>(
  spans: readonly TextSpan<Technique>[],
  start: number,
  end: number,
  insertLength: number,
): readonly TextSpan<Technique>[] {
  const delta = insertLength - (end - start);
  return spans.flatMap((span) => {
    if (span.end <= start) return [span];
    if (span.start >= end) return [{ ...span, start: span.start + delta, end: span.end + delta }];
    const retainsLeft = span.start < start;
    const retainsRight = span.end > end;
    if (retainsLeft && retainsRight) return [{ ...span, end: span.end + delta }];
    if (retainsLeft) return [{ ...span, end: start }];
    if (retainsRight) {
      return [{ ...span, start: start + insertLength, end: span.end + delta }];
    }
    return [];
  });
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

function normalizeDesired<Technique extends AnyRasterTechnique>(
  properties: TextProperties<Technique>,
): DesiredTextState<Technique> {
  if (properties === undefined) throw new TypeError('Text properties are required');
  const formatted = typeof properties.text === 'string' ? undefined : (properties.text as FormattedText<Technique>);
  return Object.freeze({
    font: properties.font,
    text: formatted?.text ?? (properties.text as string),
    spans: Object.freeze([...((formatted?.spans as readonly TextSpan<Technique>[]) ?? properties.spans ?? [])]),
    contentBox: Object.freeze({ ...(properties.contentBox ?? {}) }),
    style: Object.freeze({ ...(properties.style ?? {}) }),
    paint: Object.freeze({ ...(properties.paint ?? {}) }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
    ...(properties.material === undefined ? {} : { material: properties.material }),
  });
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
  if (value.policy !== 'grow' && value.policy !== 'chunk' && value.policy !== 'fixed')
    throw new TypeError('glyph capacity policy is invalid');
  return Object.freeze({ size: value.size, policy: value.policy });
}
function normalizeCompositing(value: TextGroupOptions['compositing']): 'ordered' | 'independent' {
  if (value === undefined || value === 'ordered') return 'ordered';
  if (value === 'independent') return value;
  throw new TypeError('text group compositing mode is invalid');
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
function collectTextDescendants(group: TextGroup): Text<AnyRasterTechnique>[] {
  const texts: Text<AnyRasterTechnique>[] = [];
  for (const child of group.children) collect(child, texts);
  return texts;
  function collect(object: THREE.Object3D, result: Text<AnyRasterTechnique>[]): void {
    if (object instanceof TextGroup) return;
    if (object instanceof Text) result.push(object as Text<AnyRasterTechnique>);
    for (const child of object.children) collect(child, result);
  }
}
function validateText(text: Text<AnyRasterTechnique>): void {
  validateBinding(text.runtime, text);
}
function validateBinding(runtime: TextRuntime, text: Text<AnyRasterTechnique>): void {
  if (text.disposed) throw new TypeError('disposed text cannot be attached');
  if (text.runtime !== runtime) throw new TypeError('text belongs to another Three font-cache domain');
  assertFontSelectionForRuntime(text.font, text.runtime);
}
