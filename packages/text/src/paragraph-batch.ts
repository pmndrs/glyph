import {
  acquireFontSelection,
  assertFontSelection,
  concreteFonts,
  releaseFontSelection,
  type FontSelection,
  type LoadedFont,
} from './loaded-font.js';
import type { ParagraphLayout } from './layout.js';
import type { FontHandle } from './identity.js';
import { createParagraphEngine, type ParagraphStyle } from './paragraph.js';
import type { ResolvedPaint } from './paint.js';
import type {
  AnyRasterTechnique,
  GlyphBatchStorageOf,
  GlyphRange,
  RasterBindingOf,
  RasterGlyphInput,
  RasterGlyphSelection,
  RasterResourceId,
  RasterTechniqueId,
} from './raster-technique.js';
import type { RuntimeShaper } from './shaper.js';
import type { TextRuntime } from './text-runtime.js';
import type { FormattedText, GlyphPaintInput, ParagraphSpan, TextInput } from './formatted-text.js';
import {
  assertSpanNesting,
  resolveSpanCascade,
  statedProperties,
  type SpanCascadeSegment,
} from './internal/span-cascade.js';
import {
  attachParagraphBatch,
  type ParagraphBatchAttachment,
  type ParagraphBatchTarget,
  type ParagraphBatchTargetRevision,
} from './paragraph-batch-attachment.js';

declare const paragraphIdBrand: unique symbol;
declare const glyphTopologyBrand: unique symbol;

export type ParagraphId = number & { readonly [paragraphIdBrand]: true };
export type GlyphTopology = number & { readonly [glyphTopologyBrand]: true };

export interface GlyphBufferCapacity {
  readonly size: number;
  readonly policy: 'grow' | 'chunk' | 'fixed';
}

export type ParagraphAxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exact'; readonly size: number };

export interface ParagraphContentBox {
  readonly width?: ParagraphAxisConstraint;
  readonly height?: ParagraphAxisConstraint;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
}

export interface ParagraphBaseProperties<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly font: FontSelection<Technique>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly order?: number;
  readonly renderVariant?: Variant;
}

export type ParagraphContentProperties<Technique extends AnyRasterTechnique, Variant = undefined> =
  | Readonly<{ text: string; spans?: readonly ParagraphSpan<Technique, Variant>[] }>
  | Readonly<{ text: FormattedText<Technique>; spans?: never }>;

export type ParagraphProperties<Technique extends AnyRasterTechnique, Variant = undefined> = ParagraphBaseProperties<
  Technique,
  Variant
> &
  ParagraphContentProperties<Technique, Variant>;

export type ParagraphUpdate<Technique extends AnyRasterTechnique, Variant = undefined> =
  | (Partial<ParagraphBaseProperties<Technique, Variant>> &
      Readonly<{ text?: string; spans?: readonly ParagraphSpan<Technique, Variant>[] }>)
  | (Partial<ParagraphBaseProperties<Technique, Variant>> &
      Readonly<{ text: FormattedText<Technique>; spans?: never }>);

export interface ParagraphSnapshot<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique, Variant>[];
  readonly contentBox: ParagraphContentBox;
  readonly style: ParagraphStyle;
  readonly paint: GlyphPaintInput;
  readonly rasterPixelRatio: number;
  readonly order: number;
  readonly renderVariant: Variant | undefined;
}

export interface GlyphSnapshot {
  readonly topology: GlyphTopology;
  readonly glyphIds: Uint32Array;
  readonly clusters: Uint32Array;
  readonly fontSlots: Uint16Array;
  readonly shapedX: Float32Array;
  readonly shapedY: Float32Array;
  readonly displayedX: Float32Array;
  readonly displayedY: Float32Array;
}

export interface GlyphOriginUpdate {
  readonly topology: GlyphTopology;
  readonly x: Float32Array;
  readonly y: Float32Array;
}

export interface PreparedParagraph {
  readonly id: ParagraphId;
  readonly layout: ParagraphLayout;
  readonly topology: GlyphTopology;
}

export interface GlyphBatchKey {
  readonly technique: RasterTechniqueId;
  readonly resource: RasterResourceId;
  readonly pipelineVariant: number;
  readonly generation: number;
  readonly chunk: number;
}

export interface PreparedGlyphBatch<Technique extends AnyRasterTechnique> {
  readonly key: GlyphBatchKey;
  readonly technique: Technique;
  readonly font: LoadedFont<Technique>;
  readonly capacity: number;
  readonly instanceCount: number;
  readonly binding: RasterBindingOf<Technique>;
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}

export interface PreparedGlyphRun<Variant = undefined> {
  readonly batch: GlyphBatchKey;
  readonly paragraph: ParagraphId;
  readonly renderVariant: Variant | undefined;
  readonly start: number;
  readonly count: number;
}

export interface PreparedParagraphBatchRevision<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly paragraphBatch: ParagraphBatch<Technique, Variant>;
  readonly revision: number;
  readonly technique: Technique;
  readonly paragraphs: readonly PreparedParagraph[];
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];
  readonly glyphRuns: readonly PreparedGlyphRun<Variant>[];
}

export interface GlyphCapacityOverflow {
  readonly resourceKey: GlyphBatchKey;
  readonly required: number;
}

export type TextPreparationError =
  | {
      readonly kind: 'capacity-exceeded';
      readonly batch: ParagraphBatch<AnyRasterTechnique, unknown>;
      readonly capacity: number;
      readonly required: number;
      readonly overflows: readonly GlyphCapacityOverflow[];
    }
  | { readonly kind: 'preparation-failed'; readonly cause: unknown };

export interface ParagraphBatchOptions<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly technique: Technique;
  readonly capacity?: GlyphBufferCapacity;
  readonly rasterPixelRatio?: number;
  readonly renderVariant?: Variant;
}

export interface ParagraphBatchObserver<Technique extends AnyRasterTechnique, Variant = undefined> {
  next(revision: PreparedParagraphBatchRevision<Technique, Variant>): void;
  complete(): void;
}

export interface Paragraph<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly id: ParagraphId;
  readonly batch: ParagraphBatch<Technique, Variant>;
  readonly disposed: boolean;
  readonly committed: PreparedParagraph | undefined;
  font: FontSelection<Technique>;
  text: TextInput<Technique>;
  spans: readonly ParagraphSpan<Technique, Variant>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  rasterPixelRatio: number;
  order: number;
  renderVariant: Variant | undefined;
  set(properties: ParagraphUpdate<Technique, Variant>): void;
  setSpan(index: number, span: ParagraphSpan<Technique, Variant>): void;
  removeSpan(index: number): void;
  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;
  snapshotProperties(): ParagraphSnapshot<Technique, Variant>;
  dispose(): void;
}

export interface ParagraphBatch<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly runtime: TextRuntime;
  readonly technique: Technique;
  readonly capacity: GlyphBufferCapacity;
  readonly current: PreparedParagraphBatchRevision<Technique, Variant>;
  readonly paragraphCount: number;
  readonly hasPendingChanges: boolean;
  readonly preparationError: TextPreparationError | undefined;
  readonly disposed: boolean;
  rasterPixelRatio: number;
  renderVariant: Variant | undefined;
  add(properties: ParagraphProperties<Technique, Variant>): Paragraph<Technique, Variant>;
  setCapacity(capacity: GlyphBufferCapacity): void;
  has(paragraph: Paragraph<Technique>): boolean;
  subscribe(observer: ParagraphBatchObserver<Technique, Variant>): () => void;
  attach<TargetRevision extends ParagraphBatchTargetRevision>(
    target: ParagraphBatchTarget<Technique, Variant, TargetRevision>,
  ): ParagraphBatchAttachment<Technique, Variant, TargetRevision>;
  dispose(): void;
}

export interface ParagraphBatchHost {
  readonly runtime: TextRuntime;
  readonly shaper: RuntimeShaper;
  dirty(): void;
  remove(batch: ParagraphBatchController): void;
}

export interface ParagraphBatchController {
  readonly publicBatch: ParagraphBatch<AnyRasterTechnique, unknown>;
  readonly dirty: boolean;
  capture(): ParagraphBatchPreparation;
  prepare(
    snapshot: ParagraphBatchPreparation,
    layouts?: ReadonlyMap<ParagraphId, ParagraphLayout>,
  ): PreparedParagraphBatchCandidate;
  publish(candidate: PreparedParagraphBatchCandidate): void;
  discard(candidate: PreparedParagraphBatchCandidate): void;
  release(snapshot: ParagraphBatchPreparation): void;
}

export interface ParagraphBatchPreparation {
  readonly controller: ParagraphBatchController;
  readonly desiredRevision: number;
  readonly paragraphs: readonly CapturedParagraph<AnyRasterTechnique, unknown>[];
  readonly layouts: readonly ParagraphLayoutPreparation[];
  readonly capacity: GlyphBufferCapacity;
  readonly capacityChanged: boolean;
  readonly rasterPixelRatio: number;
  readonly renderVariant: unknown;
  readonly previous: PreparedParagraphBatchRevision<AnyRasterTechnique, unknown>;
  readonly leases: readonly LoadedFont<AnyRasterTechnique>[];
}

export interface ParagraphLayoutPreparation {
  readonly paragraph: ParagraphId;
  readonly input?: WorkerParagraphLayoutInput;
}

export interface PreparedParagraphBatchCandidate {
  readonly snapshot: ParagraphBatchPreparation;
  readonly revision: PreparedParagraphBatchRevision<AnyRasterTechnique, unknown>;
  readonly paragraphs: readonly PreparedOwnedParagraph<AnyRasterTechnique, unknown>[];
}

const DEFAULT_CAPACITY = Object.freeze({ size: 4_096, policy: 'chunk' as const });
const EMPTY_BOX = Object.freeze({});
const EMPTY_STYLE = Object.freeze({});
const EMPTY_PAINT = Object.freeze({});

export function createParagraphBatch<Technique extends AnyRasterTechnique, Variant>(
  host: ParagraphBatchHost,
  options: ParagraphBatchOptions<Technique, Variant>,
): ParagraphBatchController {
  return new ParagraphBatchImpl(host, options) as ParagraphBatchController;
}

class ParagraphBatchImpl<Technique extends AnyRasterTechnique, Variant>
  implements ParagraphBatch<Technique, Variant>, ParagraphBatchController
{
  readonly runtime: TextRuntime;
  readonly technique: Technique;
  readonly #host: ParagraphBatchHost;
  readonly #paragraphs = new Set<ParagraphImpl<Technique, Variant>>();
  readonly #observers = new Set<ParagraphBatchObserver<Technique, Variant>>();
  readonly #spareStorage = new Map<GlyphBatchKey, GlyphBatchStorageOf<Technique>>();
  #capacity: GlyphBufferCapacity;
  #rasterPixelRatio: number;
  #renderVariant: Variant | undefined;
  #revision = 0;
  #desiredRevision = 0;
  #capacityChanged = false;
  #nextParagraphId = 1;
  #dirty = false;
  #disposed = false;
  #preparationError: TextPreparationError | undefined;
  #current: PreparedParagraphBatchRevision<Technique, Variant>;

  constructor(host: ParagraphBatchHost, options: ParagraphBatchOptions<Technique, Variant>) {
    if (options === undefined || options.technique === undefined)
      throw new TypeError('paragraph batch requires a technique');
    this.#host = host;
    this.runtime = host.runtime;
    this.technique = options.technique;
    this.#capacity = normalizeCapacity(options.capacity ?? DEFAULT_CAPACITY);
    this.#rasterPixelRatio = positive(options.rasterPixelRatio ?? 1, 'rasterPixelRatio');
    this.#renderVariant = options.renderVariant;
    this.#current = Object.freeze({
      paragraphBatch: this,
      revision: 0,
      technique: this.technique,
      paragraphs: Object.freeze([]),
      glyphBatches: Object.freeze([]),
      glyphRuns: Object.freeze([]),
    });
  }

  get publicBatch(): ParagraphBatch<AnyRasterTechnique, unknown> {
    return this as ParagraphBatch<AnyRasterTechnique, unknown>;
  }
  get capacity(): GlyphBufferCapacity {
    return this.#capacity;
  }
  get current(): PreparedParagraphBatchRevision<Technique, Variant> {
    return this.#current;
  }
  get paragraphCount(): number {
    return this.#paragraphs.size;
  }
  get hasPendingChanges(): boolean {
    return this.#dirty;
  }
  get dirty(): boolean {
    return this.#dirty;
  }
  get preparationError(): TextPreparationError | undefined {
    return this.#preparationError;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get rasterPixelRatio(): number {
    return this.#rasterPixelRatio;
  }
  set rasterPixelRatio(value: number) {
    const next = positive(value, 'rasterPixelRatio');
    if (next !== this.#rasterPixelRatio) {
      this.#rasterPixelRatio = next;
      this.#markDirty();
    }
  }
  get renderVariant(): Variant | undefined {
    return this.#renderVariant;
  }
  set renderVariant(value: Variant | undefined) {
    if (!Object.is(value, this.#renderVariant)) {
      this.#renderVariant = value;
      this.#markDirty();
    }
  }

  add(properties: ParagraphProperties<Technique, Variant>): Paragraph<Technique, Variant> {
    this.#assertActive();
    const paragraph = new ParagraphImpl(this, this.#nextParagraphId++ as ParagraphId, properties);
    this.#paragraphs.add(paragraph);
    this.#markDirty();
    return paragraph;
  }

  setCapacity(value: GlyphBufferCapacity): void {
    this.#assertActive();
    const next = normalizeCapacity(value);
    if (next.size === this.#capacity.size && next.policy === this.#capacity.policy) return;
    this.#capacity = next;
    this.#capacityChanged = true;
    this.#markDirty();
  }

  has(paragraph: Paragraph<Technique>): boolean {
    return this.#paragraphs.has(paragraph as ParagraphImpl<Technique, Variant>);
  }

  subscribe(observer: ParagraphBatchObserver<Technique, Variant>): () => void {
    this.#assertActive();
    observer.next(this.#current);
    this.#observers.add(observer);
    let active = true;
    return () => {
      if (active) {
        active = false;
        this.#observers.delete(observer);
      }
    };
  }

  attach<TargetRevision extends ParagraphBatchTargetRevision>(
    target: ParagraphBatchTarget<Technique, Variant, TargetRevision>,
  ): ParagraphBatchAttachment<Technique, Variant, TargetRevision> {
    this.#assertActive();
    return attachParagraphBatch(this, target);
  }

  capture(): ParagraphBatchPreparation {
    this.#assertActive();
    const paragraphs = [...this.#paragraphs]
      .sort((a, b) => a.order - b.order || a.id - b.id)
      .map((paragraph) => paragraph.capture());
    const leases = [...new Set(paragraphs.flatMap((paragraph) => selectedFonts(paragraph.state)))];
    acquireFonts(leases, this.runtime, this.technique);
    return Object.freeze({
      controller: this,
      desiredRevision: this.#desiredRevision,
      paragraphs,
      layouts: Object.freeze(
        paragraphs.map((paragraph) =>
          Object.freeze({
            paragraph: paragraph.owner.id,
            ...(paragraph.needsShape ? { input: paragraphLayoutInput(paragraph.state) } : {}),
          }),
        ),
      ),
      capacity: this.#capacity,
      capacityChanged: this.#capacityChanged,
      rasterPixelRatio: this.#rasterPixelRatio,
      renderVariant: this.#renderVariant,
      previous: this.#current,
      leases,
    }) as ParagraphBatchPreparation;
  }

  prepare(
    snapshot: ParagraphBatchPreparation,
    layouts?: ReadonlyMap<ParagraphId, ParagraphLayout>,
  ): PreparedParagraphBatchCandidate {
    this.#assertSnapshot(snapshot);
    try {
      const paragraphs = snapshot.paragraphs as unknown as readonly CapturedParagraph<Technique, Variant>[];
      const renderVariant = snapshot.renderVariant as Variant | undefined;
      const previous = snapshot.previous as unknown as PreparedParagraphBatchRevision<Technique, Variant>;
      const prepared = paragraphs.map((paragraph) =>
        paragraph.owner.prepare(
          paragraph,
          this.#host.shaper,
          snapshot.rasterPixelRatio,
          renderVariant,
          layouts?.get(paragraph.owner.id),
        ),
      );
      const packed = pack<Technique, Variant>(this, prepared, snapshot.capacity, previous, snapshot.capacityChanged);
      const revision = Object.freeze({
        paragraphBatch: this,
        revision: this.#revision + 1,
        technique: this.technique,
        paragraphs: Object.freeze(prepared.map((entry) => entry.publicParagraph)),
        glyphBatches: Object.freeze(packed.batches),
        glyphRuns: Object.freeze(packed.runs),
      }) as PreparedParagraphBatchRevision<AnyRasterTechnique, unknown>;
      return Object.freeze({ snapshot, revision, paragraphs: prepared }) as PreparedParagraphBatchCandidate;
    } catch (cause) {
      const error =
        cause instanceof CapacityOverflow
          ? Object.freeze({
              kind: 'capacity-exceeded' as const,
              batch: this as ParagraphBatch<AnyRasterTechnique, unknown>,
              capacity: snapshot.capacity.size,
              required: cause.required,
              overflows: Object.freeze(cause.overflows),
            })
          : Object.freeze({ kind: 'preparation-failed' as const, cause });
      if (snapshot.desiredRevision === this.#desiredRevision) {
        this.#dirty = false;
        this.#preparationError = error;
      }
      throw error;
    }
  }

  publish(candidate: PreparedParagraphBatchCandidate): void {
    this.#assertSnapshot(candidate.snapshot);
    const value = candidate.revision;
    const nextKeys = new Set(value.glyphBatches.map((glyphBatch) => glyphBatch.key));
    for (const glyphBatch of this.#current.glyphBatches)
      if (nextKeys.has(glyphBatch.key)) this.#spareStorage.set(glyphBatch.key, glyphBatch.storage);
    this.#current = value as PreparedParagraphBatchRevision<Technique, Variant>;
    this.#revision = value.revision;
    this.#dirty = candidate.snapshot.desiredRevision !== this.#desiredRevision;
    this.#preparationError = undefined;
    if (!this.#dirty) this.#capacityChanged = false;
    for (const paragraph of candidate.paragraphs)
      paragraph.owner.setPrepared(paragraph as PreparedOwnedParagraph<Technique, Variant>);
    for (const observer of this.#observers) observer.next(this.#current);
  }

  discard(candidate: PreparedParagraphBatchCandidate): void {
    this.#assertSnapshot(candidate.snapshot);
    const currentKeys = new Set(this.#current.glyphBatches.map((glyphBatch) => glyphBatch.key));
    for (const glyphBatch of candidate.revision.glyphBatches)
      if (currentKeys.has(glyphBatch.key))
        this.#spareStorage.set(glyphBatch.key, glyphBatch.storage as GlyphBatchStorageOf<Technique>);
  }

  release(snapshot: ParagraphBatchPreparation): void {
    this.#assertSnapshot(snapshot);
    releaseFonts(snapshot.leases as readonly LoadedFont<Technique>[]);
  }
  storage(key: GlyphBatchKey, capacity: number): GlyphBatchStorageOf<Technique> {
    const spare = this.#spareStorage.get(key);
    if (spare !== undefined) {
      this.#spareStorage.delete(key);
      return spare;
    }
    return packingOperations(this.technique).createStorage(capacity);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const paragraph of [...this.#paragraphs]) paragraph.dispose();
    this.#paragraphs.clear();
    for (const observer of this.#observers) observer.complete();
    this.#observers.clear();
    this.#spareStorage.clear();
    this.#host.remove(this);
  }

  removeParagraph(paragraph: ParagraphImpl<Technique, Variant>): void {
    if (this.#paragraphs.delete(paragraph)) this.#markDirty();
  }
  markParagraphDirty(): void {
    this.#markDirty();
  }
  #markDirty(): void {
    this.#desiredRevision += 1;
    this.#preparationError = undefined;
    if (!this.#dirty) {
      this.#dirty = true;
      this.#host.dirty();
    }
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph batch has been disposed');
  }
  #assertSnapshot(snapshot: ParagraphBatchPreparation): void {
    if (snapshot.controller !== this) throw new TypeError('paragraph batch preparation belongs to another batch');
  }
}

interface CapturedParagraph<Technique extends AnyRasterTechnique, Variant> {
  readonly owner: ParagraphImpl<Technique, Variant>;
  readonly desiredRevision: number;
  readonly state: ParagraphSnapshot<Technique, Variant>;
  readonly origins: GlyphOriginUpdate | undefined;
  readonly prepared: PreparedOwnedParagraph<Technique, Variant> | undefined;
  readonly needsShape: boolean;
  readonly topology: number;
  readonly hasDensity: boolean;
}

interface PreparedOwnedParagraph<Technique extends AnyRasterTechnique, Variant> {
  readonly owner: ParagraphImpl<Technique, Variant>;
  readonly capture: CapturedParagraph<Technique, Variant>;
  readonly state: ParagraphSnapshot<Technique, Variant>;
  readonly publicParagraph: PreparedParagraph;
  readonly layout: ParagraphLayout;
  readonly fonts: ReadonlyMap<number, LoadedFont<Technique>>;
  readonly displayedX: Float32Array;
  readonly displayedY: Float32Array;
  readonly rasterPixelRatio: number;
  readonly batchRenderVariant: Variant | undefined;
  /** Cascade-resolved paint per glyph, parallel to `layout.glyphIds`. */
  readonly glyphPaints: readonly ResolvedPaint[];
  /** Cascade-resolved render variant per glyph, parallel to `layout.glyphIds`. */
  readonly glyphVariants: readonly (Variant | undefined)[];
}

class ParagraphImpl<Technique extends AnyRasterTechnique, Variant> implements Paragraph<Technique, Variant> {
  readonly id: ParagraphId;
  readonly batch: ParagraphBatchImpl<Technique, Variant>;
  #state: ParagraphSnapshot<Technique, Variant>;
  #disposed = false;
  #prepared: PreparedOwnedParagraph<Technique, Variant> | undefined;
  #origins: GlyphOriginUpdate | undefined;
  #topology = 0;
  #desiredRevision = 0;
  #leasedFonts: readonly LoadedFont<Technique>[];
  #needsShape = true;
  readonly hasDensity: boolean;

  constructor(
    batch: ParagraphBatchImpl<Technique, Variant>,
    id: ParagraphId,
    properties: ParagraphProperties<Technique, Variant>,
  ) {
    this.batch = batch;
    this.id = id;
    this.hasDensity = properties.rasterPixelRatio !== undefined;
    this.#state = normalizeProperties(properties, batch.runtime, batch.technique);
    this.#leasedFonts = selectedFonts(this.#state);
    acquireFonts(this.#leasedFonts, batch.runtime, batch.technique);
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get committed(): PreparedParagraph | undefined {
    return this.#prepared?.publicParagraph;
  }
  get font(): FontSelection<Technique> {
    return this.#state.font;
  }
  set font(value: FontSelection<Technique>) {
    this.set({ font: value });
  }
  get text(): string {
    return this.#state.text;
  }
  set text(value: TextInput<Technique>) {
    this.set({ text: value } as ParagraphUpdate<Technique, Variant>);
  }
  get spans(): readonly ParagraphSpan<Technique, Variant>[] {
    return this.#state.spans;
  }
  set spans(value: readonly ParagraphSpan<Technique, Variant>[]) {
    this.set({ spans: value });
  }
  get contentBox(): ParagraphContentBox {
    return this.#state.contentBox;
  }
  set contentBox(value: ParagraphContentBox) {
    this.set({ contentBox: value });
  }
  get style(): ParagraphStyle {
    return this.#state.style;
  }
  set style(value: ParagraphStyle) {
    this.set({ style: value });
  }
  get paint(): GlyphPaintInput {
    return this.#state.paint;
  }
  set paint(value: GlyphPaintInput) {
    this.set({ paint: value });
  }
  get rasterPixelRatio(): number {
    return this.#state.rasterPixelRatio;
  }
  set rasterPixelRatio(value: number) {
    this.set({ rasterPixelRatio: value });
  }
  get order(): number {
    return this.#state.order;
  }
  set order(value: number) {
    this.set({ order: value });
  }
  get renderVariant(): Variant | undefined {
    return this.#state.renderVariant;
  }
  set renderVariant(value: Variant | undefined) {
    this.set({ renderVariant: value } as ParagraphUpdate<Technique, Variant>);
  }

  set(update: ParagraphUpdate<Technique, Variant>): void {
    this.#assertActive();
    const next = normalizeProperties(
      { ...this.#state, ...replacedContent(update) } as ParagraphProperties<Technique, Variant>,
      this.batch.runtime,
      this.batch.technique,
    );
    const nextFonts = selectedFonts(next);
    acquireFonts(nextFonts, this.batch.runtime, this.batch.technique);
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = nextFonts;
    if ('font' in update || 'text' in update || 'spans' in update || 'contentBox' in update || 'style' in update) {
      this.#needsShape = true;
    }
    this.#state = next;
    this.#origins = undefined;
    this.#desiredRevision += 1;
    this.batch.markParagraphDirty();
  }
  setSpan(index: number, value: ParagraphSpan<Technique, Variant>): void {
    const spans = [...this.spans];
    if (!Number.isSafeInteger(index) || index < 0 || index >= spans.length)
      throw new RangeError('span index is outside the paragraph');
    spans[index] = value;
    this.spans = spans;
  }
  removeSpan(index: number): void {
    const spans = [...this.spans];
    if (!Number.isSafeInteger(index) || index < 0 || index >= spans.length)
      throw new RangeError('span index is outside the paragraph');
    spans.splice(index, 1);
    this.spans = spans;
  }
  snapshotProperties(): ParagraphSnapshot<Technique, Variant> {
    this.#assertActive();
    return this.#state;
  }
  snapshotGlyphs(): GlyphSnapshot {
    this.#assertActive();
    const prepared = this.#prepared;
    if (prepared === undefined) throw new Error('paragraph has not been prepared');
    const layout = prepared.layout;
    const displayedX = this.#origins?.x ?? layout.x;
    const displayedY = this.#origins?.y ?? layout.y;
    return {
      topology: prepared.publicParagraph.topology,
      glyphIds: Uint32Array.from(layout.glyphIds),
      clusters: layout.clusters.slice(),
      fontSlots: layout.glyphFontSlots.slice(),
      shapedX: layout.x.slice(),
      shapedY: layout.y.slice(),
      displayedX: displayedX.slice(),
      displayedY: displayedY.slice(),
    };
  }
  setGlyphOrigins(update: GlyphOriginUpdate): void {
    this.#assertActive();
    const prepared = this.#prepared;
    if (prepared === undefined || update.topology !== prepared.publicParagraph.topology)
      throw new TypeError('glyph origins do not match the committed topology');
    if (update.x.length !== prepared.layout.x.length || update.y.length !== prepared.layout.y.length)
      throw new RangeError('glyph origin arrays do not match the glyph count');
    this.#origins = { topology: update.topology, x: update.x.slice(), y: update.y.slice() };
    this.#desiredRevision += 1;
    this.batch.markParagraphDirty();
  }
  clearGlyphOriginOverrides(): void {
    this.#assertActive();
    if (this.#origins !== undefined) {
      this.#origins = undefined;
      this.#desiredRevision += 1;
      this.batch.markParagraphDirty();
    }
  }

  capture(): CapturedParagraph<Technique, Variant> {
    return Object.freeze({
      owner: this,
      desiredRevision: this.#desiredRevision,
      state: this.#state,
      origins: this.#origins,
      prepared: this.#prepared,
      needsShape: this.#needsShape,
      topology: this.#topology,
      hasDensity: this.hasDensity,
    });
  }
  prepare(
    capture: CapturedParagraph<Technique, Variant>,
    shaper: RuntimeShaper,
    batchRasterPixelRatio: number,
    batchRenderVariant: Variant | undefined,
    preparedLayout?: ParagraphLayout,
  ): PreparedOwnedParagraph<Technique, Variant> {
    if (capture.owner !== this) throw new TypeError('paragraph preparation belongs to another paragraph');
    const fonts = collectFonts(capture.state);
    const layout =
      !capture.needsShape && capture.prepared !== undefined
        ? capture.prepared.layout
        : (preparedLayout ?? layoutWithFallback(shaper, capture.state));
    const topology = (
      !capture.needsShape && capture.prepared !== undefined
        ? capture.prepared.publicParagraph.topology
        : capture.topology + 1
    ) as GlyphTopology;
    return {
      owner: this,
      capture,
      state: capture.state,
      layout,
      fonts,
      displayedX: capture.origins?.x ?? layout.x,
      displayedY: capture.origins?.y ?? layout.y,
      rasterPixelRatio: capture.hasDensity ? capture.state.rasterPixelRatio : batchRasterPixelRatio,
      batchRenderVariant,
      ...resolveGlyphAttribution(capture.state, layout, batchRenderVariant),
      publicParagraph: Object.freeze({ id: this.id, layout, topology }),
    };
  }
  publish(): void {}
  setPrepared(value: PreparedOwnedParagraph<Technique, Variant>): void {
    this.#prepared = value;
    this.#topology = value.publicParagraph.topology;
    if (value.capture.desiredRevision === this.#desiredRevision) this.#needsShape = false;
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = [];
    this.batch.removeParagraph(this);
    this.#prepared = undefined;
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('paragraph has been disposed');
  }
}

function pack<Technique extends AnyRasterTechnique, Variant>(
  batch: ParagraphBatchImpl<Technique, Variant>,
  prepared: readonly PreparedOwnedParagraph<Technique, Variant>[],
  capacity: GlyphBufferCapacity,
  previous: PreparedParagraphBatchRevision<Technique, Variant>,
  forceReplacement: boolean,
): { batches: PreparedGlyphBatch<Technique>[]; runs: PreparedGlyphRun<Variant>[] } {
  const technique = packingOperations(batch.technique);
  type Entry = {
    font: LoadedFont<Technique>;
    selection: RasterGlyphSelection<RasterBindingOf<Technique>>;
    glyphs: RasterGlyphInput<LoadedFont<Technique>['data']>[];
  };
  type LogicalRun = {
    entry: Entry;
    paragraph: ParagraphImpl<Technique, Variant>;
    variant: Variant | undefined;
    start: number;
    count: number;
  };
  const entries = new Map<string, Entry>();
  const orderedRuns: LogicalRun[] = [];
  for (const value of prepared) {
    const { layout, owner } = value;
    for (let index = 0; index < layout.glyphIds.length; index += 1) {
      const handle = layout.fontHandles[layout.glyphFontSlots[index]!]!;
      const font = value.fonts.get(handle);
      if (font === undefined) throw new Error('paragraph layout referenced an unresolved loaded font');
      const input = {
        data: font.data,
        glyphId: layout.glyphIds[index]!,
        fontSize: layout.glyphFontSizes[index]!,
        originX: value.displayedX[index]!,
        originY: value.displayedY[index]!,
        rasterPixelRatio: value.rasterPixelRatio,
        paint: value.glyphPaints[index]!,
      };
      const selection = technique.select(input);
      if (selection === undefined) continue;
      const key = `${selection.resource}\0${selection.pipelineVariant}`;
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = { font, selection, glyphs: [] };
        entries.set(key, entry);
      }
      const variant = value.glyphVariants[index];
      const previousRun = orderedRuns.at(-1);
      if (
        previousRun !== undefined &&
        previousRun.entry === entry &&
        previousRun.paragraph === owner &&
        Object.is(previousRun.variant, variant) &&
        previousRun.start + previousRun.count === entry.glyphs.length
      )
        previousRun.count += 1;
      else orderedRuns.push({ entry, paragraph: owner, variant, start: entry.glyphs.length, count: 1 });
      entry.glyphs.push(input);
    }
  }
  const batches: PreparedGlyphBatch<Technique>[] = [];
  const runLookup = new Map<Entry, { key: GlyphBatchKey; offset: number }[]>();
  if (capacity.policy === 'fixed') {
    const overflows: GlyphCapacityOverflow[] = [];
    for (const entry of entries.values()) {
      if (entry.glyphs.length <= capacity.size) continue;
      overflows.push({
        resourceKey: Object.freeze({
          technique: batch.technique.id,
          resource: entry.selection.resource,
          pipelineVariant: entry.selection.pipelineVariant,
          generation: nextGeneration(previous, entry.selection.resource, entry.selection.pipelineVariant, 0),
          chunk: 0,
        }),
        required: entry.glyphs.length,
      });
    }
    if (overflows.length !== 0) throw new CapacityOverflow(overflows);
  }
  for (const entry of entries.values()) {
    const required = entry.glyphs.length;
    const prior = matchingBatch(previous, entry.selection.resource, entry.selection.pipelineVariant, 0);
    const chunkSize =
      capacity.policy === 'grow'
        ? prior !== undefined && !forceReplacement && prior.capacity >= required
          ? prior.capacity
          : grownCapacity(forceReplacement ? capacity.size : (prior?.capacity ?? capacity.size), required)
        : capacity.size;
    const chunks = Math.max(1, Math.ceil(required / chunkSize));
    const keys: { key: GlyphBatchKey; offset: number }[] = [];
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const start = chunk * chunkSize;
      const count = Math.min(chunkSize, required - start);
      const old = matchingBatch(previous, entry.selection.resource, entry.selection.pipelineVariant, chunk);
      const reusable = old !== undefined && !forceReplacement && old.capacity === chunkSize;
      const key = reusable
        ? old.key
        : Object.freeze({
            technique: batch.technique.id,
            resource: entry.selection.resource,
            pipelineVariant: entry.selection.pipelineVariant,
            generation: old === undefined ? 0 : old.key.generation + 1,
            chunk,
          });
      const storage = batch.storage(key, chunkSize);
      technique.writeStorage(
        storage,
        { start: 0, count },
        { data: entry.font.data, binding: entry.selection.binding, glyphs: entry.glyphs.slice(start, start + count) },
      );
      batches.push(
        Object.freeze({
          key,
          technique: batch.technique,
          font: entry.font,
          capacity: chunkSize,
          instanceCount: count,
          binding: entry.selection.binding,
          storage,
          dirtyRanges: Object.freeze(storageDirtyRanges(reusable ? old.storage : undefined, storage, count, chunkSize)),
        }),
      );
      keys.push({ key, offset: start });
    }
    runLookup.set(entry, keys);
  }
  const runs: PreparedGlyphRun<Variant>[] = [];
  for (const run of orderedRuns) {
    const { entry } = run;
    let remaining = run.count;
    let cursor = run.start;
    while (remaining > 0) {
      const chunk = capacity.policy === 'grow' ? 0 : Math.floor(cursor / capacity.size);
      const target = runLookup.get(entry)![chunk]!;
      const local = cursor - target.offset;
      const count = Math.min(remaining, batches.find((item) => item.key === target.key)!.capacity - local);
      runs.push(
        Object.freeze({
          batch: target.key,
          paragraph: run.paragraph.id,
          renderVariant: run.variant,
          start: local,
          count,
        }),
      );
      cursor += count;
      remaining -= count;
    }
  }
  return { batches, runs };
}

function storageDirtyRanges(
  previous: Readonly<Partial<Record<PropertyKey, ArrayBufferView>>> | undefined,
  next: Readonly<Partial<Record<PropertyKey, ArrayBufferView>>>,
  count: number,
  capacity: number,
): GlyphRange[] {
  if (count === 0) return [];
  if (previous === undefined) return [{ start: 0, count }];
  const fields = Reflect.ownKeys(next);
  if (fields.length !== Reflect.ownKeys(previous).length) return [{ start: 0, count }];
  const previousBytes: Uint8Array[] = [];
  const nextBytes: Uint8Array[] = [];
  const strides: number[] = [];
  for (const field of fields) {
    const before = previous[field];
    const after = next[field];
    if (
      before === undefined ||
      after === undefined ||
      before.byteLength !== after.byteLength ||
      after.byteLength % capacity !== 0
    )
      return [{ start: 0, count }];
    previousBytes.push(new Uint8Array(before.buffer, before.byteOffset, before.byteLength));
    nextBytes.push(new Uint8Array(after.buffer, after.byteOffset, after.byteLength));
    strides.push(after.byteLength / capacity);
  }
  const ranges: GlyphRange[] = [];
  let start = -1;
  for (let slot = 0; slot < count; slot += 1) {
    let changed = false;
    for (let field = 0; field < fields.length && !changed; field += 1) {
      const stride = strides[field]!;
      const offset = slot * stride;
      const before = previousBytes[field]!;
      const after = nextBytes[field]!;
      for (let byte = 0; byte < stride; byte += 1)
        if (before[offset + byte] !== after[offset + byte]) {
          changed = true;
          break;
        }
    }
    if (changed && start === -1) start = slot;
    if (!changed && start !== -1) {
      ranges.push({ start, count: slot - start });
      start = -1;
    }
  }
  if (start !== -1) ranges.push({ start, count: count - start });
  return ranges;
}

function matchingBatch<Technique extends AnyRasterTechnique, Variant>(
  revision: PreparedParagraphBatchRevision<Technique, Variant>,
  resource: RasterResourceId,
  pipelineVariant: number,
  chunk: number,
): PreparedGlyphBatch<Technique> | undefined {
  return revision.glyphBatches.find(
    (batch) =>
      batch.key.resource === resource && batch.key.pipelineVariant === pipelineVariant && batch.key.chunk === chunk,
  );
}

function nextGeneration<Technique extends AnyRasterTechnique, Variant>(
  revision: PreparedParagraphBatchRevision<Technique, Variant>,
  resource: RasterResourceId,
  pipelineVariant: number,
  chunk: number,
): number {
  return (matchingBatch(revision, resource, pipelineVariant, chunk)?.key.generation ?? -1) + 1;
}

class CapacityOverflow extends Error {
  readonly overflows: readonly GlyphCapacityOverflow[];
  readonly required: number;
  constructor(overflows: readonly GlyphCapacityOverflow[]) {
    super('fixed glyph capacity is smaller than the prepared generation');
    this.name = 'CapacityOverflow';
    this.overflows = overflows;
    this.required = Math.max(...overflows.map((overflow) => overflow.required));
  }
}

/**
 * Replacement text carries its own formatting: a literal brings its spans and a
 * plain string brings none. Retaining the previous spans would reinterpret them
 * against unrelated text, so an update that replaces text without stating spans
 * clears the ones it replaced.
 */
function replacedContent<Technique extends AnyRasterTechnique, Variant>(
  update: ParagraphUpdate<Technique, Variant>,
): ParagraphUpdate<Technique, Variant> {
  if (!('text' in update) || 'spans' in update) return update;
  return { ...update, spans: [] } as ParagraphUpdate<Technique, Variant>;
}

function normalizeProperties<Technique extends AnyRasterTechnique, Variant>(
  properties: ParagraphProperties<Technique, Variant>,
  runtime: TextRuntime,
  technique: Technique,
): ParagraphSnapshot<Technique, Variant> {
  if (properties === undefined) throw new TypeError('paragraph properties are required');
  assertFontSelection(properties.font, runtime, technique);
  const formatted = typeof properties.text === 'string' ? undefined : properties.text;
  const text = typeof properties.text === 'string' ? properties.text : properties.text.text;
  const spans = Object.freeze([
    ...((formatted?.spans ?? properties.spans ?? []) as readonly ParagraphSpan<Technique, Variant>[]),
  ]);
  for (const span of spans) {
    if (
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < 0 ||
      span.end < span.start ||
      span.end > text.length
    )
      throw new RangeError('paragraph span is outside the text');
    if (span.font !== undefined) assertFontSelection(span.font, runtime, technique);
  }
  // Resolution folds covering spans from the outermost inward, so a pair that
  // overlaps without nesting has no innermost span and must fail here rather
  // than resolve to whichever span a consumer happened to visit last.
  assertSpanNesting(spans, 'paragraph span');
  const rasterPixelRatio = positive(properties.rasterPixelRatio ?? 1, 'rasterPixelRatio');
  const order = finite(properties.order ?? 0, 'order');
  return Object.freeze({
    font: properties.font,
    text,
    spans,
    contentBox: Object.freeze({ ...(properties.contentBox ?? EMPTY_BOX) }),
    style: Object.freeze({ ...(properties.style ?? EMPTY_STYLE) }),
    paint: Object.freeze({ ...(properties.paint ?? EMPTY_PAINT) }),
    rasterPixelRatio,
    order,
    renderVariant: properties.renderVariant,
  });
}

function collectFonts<Technique extends AnyRasterTechnique, Variant>(
  state: ParagraphSnapshot<Technique, Variant>,
): ReadonlyMap<number, LoadedFont<Technique>> {
  const map = new Map<number, LoadedFont<Technique>>();
  for (const font of concreteFonts(state.font)) map.set(font.font.handle, font);
  for (const span of state.spans)
    if (span.font !== undefined) for (const font of concreteFonts(span.font)) map.set(font.font.handle, font);
  return map;
}
function selectedFonts<Technique extends AnyRasterTechnique, Variant>(
  state: ParagraphSnapshot<Technique, Variant>,
): readonly LoadedFont<Technique>[] {
  return [...new Set(collectFonts(state).values())];
}
function acquireFonts<Technique extends AnyRasterTechnique>(
  fonts: readonly LoadedFont<Technique>[],
  runtime: TextRuntime,
  technique: Technique,
): void {
  const acquired: LoadedFont<Technique>[] = [];
  try {
    for (const font of fonts) {
      acquireFontSelection(font, runtime, technique);
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
function shapingSpans(
  state: WorkerParagraphLayoutInput,
  fallbacks: ReadonlyMap<number, FontHandle> = new Map(),
): import('./paragraph.js').ParagraphSpan[] {
  const authored = state.spans.map((span) => ({
    start: span.start,
    end: span.end,
    ...(span.fonts === undefined ? {} : { font: span.fonts[0] }),
    ...(span.style ?? {}),
  }));
  // A fallback overlay is machine-generated rather than authored, so it is split
  // at the authored boundaries it crosses. Each piece then sits inside exactly
  // one span or in a gap, which keeps the overlay inside the nesting invariant.
  const boundaries = [
    ...new Set([0, state.text.length, ...state.spans.flatMap((span) => [span.start, span.end])]),
  ].sort((left, right) => left - right);
  const starts = [...fallbacks.keys()].sort((left, right) => left - right);
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = starts[index + 1] ?? state.text.length;
    const font = fallbacks.get(start)!;
    let cursor = start;
    for (const boundary of boundaries) {
      if (boundary <= cursor || boundary >= end) continue;
      authored.push({ start: cursor, end: boundary, font });
      cursor = boundary;
    }
    if (cursor < end) authored.push({ start: cursor, end, font });
  }
  return authored;
}

function layoutWithFallback<Technique extends AnyRasterTechnique, Variant>(
  shaper: RuntimeShaper,
  state: ParagraphSnapshot<Technique, Variant>,
): ParagraphLayout {
  return prepareParagraphLayout(shaper, paragraphLayoutInput(state));
}

/**
 * The shaping layer receives the cascade already resolved into disjoint
 * segments, so a span's font and shaping style reach run segmentation with the
 * same answer that packing later paints with.
 */
function paragraphLayoutInput<Technique extends AnyRasterTechnique, Variant>(
  state: ParagraphSnapshot<Technique, Variant>,
): WorkerParagraphLayoutInput {
  return Object.freeze({
    text: state.text,
    fonts: Object.freeze(concreteFonts(state.font).map((font) => font.font.handle)),
    spans: Object.freeze(
      paragraphCascade(state).flatMap((segment) => {
        const font = segment.properties.font;
        const style = shapingStyleOf(segment.properties);
        if (font === undefined && style === undefined) return [];
        return [
          Object.freeze({
            start: segment.start,
            end: segment.end,
            ...(font === undefined
              ? {}
              : { fonts: Object.freeze(concreteFonts(font).map((value) => value.font.handle)) }),
            ...(style === undefined ? {} : { style }),
          }),
        ];
      }),
    ),
    style: state.style,
    contentBox: state.contentBox,
  });
}

export interface WorkerParagraphLayoutInput {
  readonly text: string;
  readonly fonts: readonly FontHandle[];
  readonly spans: readonly {
    readonly start: number;
    readonly end: number;
    readonly fonts?: readonly FontHandle[];
    readonly style?: Partial<ParagraphStyle>;
  }[];
  readonly style: ParagraphStyle;
  readonly contentBox: ParagraphContentBox;
}

/** @internal */
export function prepareParagraphLayout(shaper: RuntimeShaper, state: WorkerParagraphLayoutInput): ParagraphLayout {
  const engine = createParagraphEngine({ shaper });
  const fallbackIndexes = new Map<number, number>();
  const fallbacks = new Map<number, FontHandle>();
  const maximumDepth = Math.max(state.fonts.length, ...state.spans.map((span) => span.fonts?.length ?? 1));
  for (let pass = 0; pass < maximumDepth; pass += 1) {
    const paragraph = engine.create({
      text: state.text,
      font: state.fonts[0]!,
      spans: shapingSpans(state, fallbacks),
      style: state.style,
    });
    try {
      const probe = paragraph.layout();
      const clusters = [...new Set(probe.clusters)].sort((left, right) => left - right);
      let changed = false;
      for (let glyph = 0; glyph < probe.glyphIds.length; glyph += 1) {
        if (probe.glyphIds[glyph] !== 0) continue;
        const cluster = probe.clusters[glyph]!;
        const fonts = fontHandlesAt(state, cluster);
        const next = (fallbackIndexes.get(cluster) ?? 0) + 1;
        if (next >= fonts.length) continue;
        fallbackIndexes.set(cluster, next);
        fallbacks.set(cluster, fonts[next]!);
        const nextCluster = clusters.find((value) => value > cluster);
        if (nextCluster !== undefined && !fallbacks.has(nextCluster)) {
          // A sentinel restores authored selection after this shaped cluster.
          fallbacks.set(nextCluster, fontHandlesAt(state, nextCluster)[0]!);
        }
        changed = true;
      }
      if (!changed) return paragraph.layout(layoutConstraints(state.contentBox));
    } finally {
      paragraph.dispose();
    }
  }
  const paragraph = engine.create({
    text: state.text,
    font: state.fonts[0]!,
    spans: shapingSpans(state, fallbacks),
    style: state.style,
  });
  try {
    return paragraph.layout(layoutConstraints(state.contentBox));
  } finally {
    paragraph.dispose();
  }
}

function fontHandlesAt(state: WorkerParagraphLayoutInput, cluster: number): readonly FontHandle[] {
  let selection = state.fonts;
  for (const span of state.spans) {
    if (span.start <= cluster && cluster < span.end && span.fonts !== undefined) selection = span.fonts;
  }
  return selection;
}

/**
 * Every span property in one flat record so a single cascade resolves shaping
 * and paint under one merge rule. `outline` and `shadow` stay whole values
 * because neither is meaningful without all of its parts.
 */
interface StatedSpanProperties<Technique extends AnyRasterTechnique, Variant> extends ParagraphStyle, GlyphPaintInput {
  readonly font?: FontSelection<Technique>;
  readonly renderVariant?: Variant;
}

type ParagraphCascade<Technique extends AnyRasterTechnique, Variant> = readonly SpanCascadeSegment<
  StatedSpanProperties<Technique, Variant>
>[];

/**
 * A snapshot is replaced whenever a paragraph property changes, so keying the
 * cascade on it resolves the spans once per revision for both the shaping layer
 * and glyph-instance packing.
 */
const paragraphCascades = new WeakMap<object, unknown>();

function paragraphCascade<Technique extends AnyRasterTechnique, Variant>(
  state: ParagraphSnapshot<Technique, Variant>,
): ParagraphCascade<Technique, Variant> {
  const cached = paragraphCascades.get(state);
  if (cached !== undefined) return cached as ParagraphCascade<Technique, Variant>;
  const resolved = resolveSpanCascade(
    state.spans.map((span) => ({
      start: span.start,
      end: span.end,
      properties: statedProperties<StatedSpanProperties<Technique, Variant>>(
        span.font === undefined ? undefined : { font: span.font },
        span.style,
        span.paint,
        span.renderVariant === undefined ? undefined : { renderVariant: span.renderVariant },
      ),
    })),
    state.text.length,
    'paragraph span',
  );
  paragraphCascades.set(state, resolved);
  return resolved;
}

function shapingStyleOf<Technique extends AnyRasterTechnique, Variant>(
  properties: StatedSpanProperties<Technique, Variant>,
): ParagraphStyle | undefined {
  const style = statedProperties<ParagraphStyle>({
    fontSize: properties.fontSize,
    lineHeight: properties.lineHeight,
    letterSpacing: properties.letterSpacing,
    language: properties.language,
    direction: properties.direction,
    features: properties.features,
  });
  return Object.keys(style).length === 0 ? undefined : style;
}

function paintOf<Technique extends AnyRasterTechnique, Variant>(
  root: GlyphPaintInput,
  properties: StatedSpanProperties<Technique, Variant>,
): GlyphPaintInput | undefined {
  const stated = statedProperties<GlyphPaintInput>({
    color: properties.color,
    opacity: properties.opacity,
    outline: properties.outline,
    shadow: properties.shadow,
  });
  return Object.keys(stated).length === 0 ? undefined : { ...root, ...stated };
}

/**
 * Paint and render variant resolve once per revision from the same cascade the
 * shaping layer consumed, so packing indexes a per-glyph result instead of
 * rescanning the span array for every glyph.
 */
function resolveGlyphAttribution<Technique extends AnyRasterTechnique, Variant>(
  state: ParagraphSnapshot<Technique, Variant>,
  layout: ParagraphLayout,
  batchRenderVariant: Variant | undefined,
): {
  readonly glyphPaints: readonly ResolvedPaint[];
  readonly glyphVariants: readonly (Variant | undefined)[];
} {
  const cascade = paragraphCascade(state);
  const rootPaint = resolvePaint(state.paint);
  const rootVariant = state.renderVariant ?? batchRenderVariant;
  const starts = Uint32Array.from(cascade, (segment) => segment.start);
  const paints = cascade.map((segment) => {
    const paint = paintOf(state.paint, segment.properties);
    return paint === undefined ? rootPaint : resolvePaint(paint);
  });
  const variants = cascade.map((segment) => segment.properties.renderVariant ?? rootVariant);
  const glyphPaints: ResolvedPaint[] = [];
  const glyphVariants: (Variant | undefined)[] = [];
  for (let index = 0; index < layout.glyphIds.length; index += 1) {
    const segment = segmentIndexAt(starts, layout.clusters[index]!);
    glyphPaints.push(segment === -1 ? rootPaint : paints[segment]!);
    glyphVariants.push(segment === -1 ? rootVariant : variants[segment]);
  }
  return { glyphPaints, glyphVariants };
}

function segmentIndexAt(starts: Uint32Array, offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
function layoutConstraints(box: ParagraphContentBox): import('./paragraph.js').ParagraphConstraints {
  const axis = (
    value: ParagraphAxisConstraint | undefined,
  ): import('./paragraph.js').ParagraphAxisConstraint | undefined =>
    value?.mode === 'exact' ? { mode: 'exactly', size: value.size } : value;
  return {
    ...(box.width === undefined ? {} : { width: axis(box.width)! }),
    ...(box.height === undefined ? {} : { height: axis(box.height)! }),
    ...(box.maxLines === undefined ? {} : { maxLines: box.maxLines }),
    ...(box.wrap === undefined ? {} : { wrap: box.wrap }),
    ...(box.align === undefined ? {} : { align: box.align }),
    ...(box.overflow === undefined ? {} : { overflow: box.overflow }),
  };
}

interface TechniquePackingOperations<Technique extends AnyRasterTechnique> {
  select(
    input: RasterGlyphInput<LoadedFont<Technique>['data']>,
  ): RasterGlyphSelection<RasterBindingOf<Technique>> | undefined;
  createStorage(capacity: number): GlyphBatchStorageOf<Technique>;
  writeStorage(
    storage: GlyphBatchStorageOf<Technique>,
    range: GlyphRange,
    input: {
      readonly data: LoadedFont<Technique>['data'];
      readonly binding: RasterBindingOf<Technique>;
      readonly glyphs: readonly RasterGlyphInput<LoadedFont<Technique>['data']>[];
    },
  ): void;
}

function packingOperations<Technique extends AnyRasterTechnique>(
  technique: Technique,
): TechniquePackingOperations<Technique> {
  return technique as unknown as TechniquePackingOperations<Technique>;
}
function normalizeCapacity(value: GlyphBufferCapacity): GlyphBufferCapacity {
  if (!Number.isSafeInteger(value.size) || value.size <= 0)
    throw new RangeError('glyph capacity size must be a positive safe integer');
  if (value.policy !== 'grow' && value.policy !== 'chunk' && value.policy !== 'fixed')
    throw new TypeError('glyph capacity policy is invalid');
  return Object.freeze({ size: value.size, policy: value.policy });
}
function grownCapacity(size: number, required: number): number {
  let value = size;
  while (value < required) value *= 2;
  return value;
}
function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
  return value;
}
function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}
function resolvePaint(input: GlyphPaintInput): ResolvedPaint {
  const opacity = input.opacity ?? 1;
  return Object.freeze({
    color: color(input.color ?? '#ffffff', opacity),
    ...(input.outline === undefined
      ? {}
      : {
          outline: Object.freeze({
            color: color(input.outline.color, opacity),
            width: positive(input.outline.width, 'outline width'),
          }),
        }),
    ...(input.shadow === undefined
      ? {}
      : { shadow: Object.freeze({ color: color(input.shadow.color, opacity), offset: input.shadow.offset }) }),
  });
}
function color(
  value: GlyphPaintInput['color'] extends infer _ ? import('./formatted-text.js').ColorInput : never,
  opacity: number,
): readonly [number, number, number, number] {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('opacity must be in [0, 1]');
  if (typeof value !== 'string') return [value[0], value[1], value[2], value[3] * opacity];
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value);
  if (match === null) throw new TypeError('colors must be #rrggbb, #rrggbbaa, or linear RGBA');
  const hex = match[1]!;
  const channel = (at: number) => {
    const srgb = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [
    channel(0),
    channel(2),
    channel(4),
    (hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1) * opacity,
  ];
}
