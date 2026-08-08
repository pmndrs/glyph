import * as THREE from 'three/webgpu';

import type { FormattedText, GlyphPaintInput, ParagraphSpan, TextInput } from '../formatted-text.js';
import {
  acquireFontSelection,
  assertFontSelection,
  concreteFonts,
  releaseFontSelection,
  type FontSelection,
  type LoadedFont,
} from '../loaded-font.js';
import type {
  GlyphBufferCapacity,
  GlyphOriginUpdate,
  GlyphSnapshot,
  Paragraph,
  ParagraphBatch,
  ParagraphContentBox,
  ParagraphLayout,
  ParagraphProperties,
  ParagraphStyle,
  ParagraphUpdate,
} from '../index.js';
import type { ParagraphBatchTarget, ParagraphBatchTargetRevision } from '../paragraph-batch-attachment.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import {
  threeRasterProgram,
  type ThreeRasterTargetAccounting,
  type ThreeRasterTargetOwner,
} from './program-registry.js';

export interface ThreeRenderVariant {
  readonly effects?: readonly unknown[];
}

export type TextSpan<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = ParagraphSpan<
  Technique,
  Variant
>;

export type TextProperties<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = ParagraphProperties<
  Technique,
  Variant
>;

export type StandaloneTextProperties<
  Technique extends AnyRasterTechnique,
  Variant = ThreeRenderVariant,
> = TextProperties<Technique, Variant> & Readonly<{ capacity?: GlyphBufferCapacity }>;

export type TextUpdate<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = ParagraphUpdate<
  Technique,
  Variant
>;

export interface TextGroupOptions<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> {
  readonly technique: Technique;
  readonly capacity?: GlyphBufferCapacity;
  readonly renderOrder?: number;
  readonly renderVariant?: Variant;
}

type SameType<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type CompatibleTextChildren<
  Technique extends AnyRasterTechnique,
  Variant,
  Children extends readonly THREE.Object3D[],
> = {
  readonly [Index in keyof Children]: Children[Index] extends Text<infer ChildTechnique, infer ChildVariant>
    ? SameType<ChildTechnique, Technique> extends true
      ? SameType<ChildVariant, Variant> extends true
        ? Children[Index]
        : never
      : never
    : Children[Index];
};

interface DesiredTextState<Technique extends AnyRasterTechnique, Variant> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly TextSpan<Technique, Variant>[];
  readonly contentBox: ParagraphContentBox;
  readonly style: ParagraphStyle;
  readonly paint: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly renderVariant?: Variant;
}

export class Text<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> extends THREE.Object3D {
  readonly #runtime: TextRuntime;
  readonly #technique: Technique;
  #desired: DesiredTextState<Technique, Variant>;
  #leasedFonts: readonly LoadedFont<Technique>[];
  #standaloneCapacity: GlyphBufferCapacity;
  #binding: ThreeTextBatchBinding<Technique, Variant> | undefined;
  #paragraph: Paragraph<Technique, Variant> | undefined;
  #textGroup: TextGroup<Technique, Variant> | undefined;
  #desiredRevision = 0;
  #appliedRevision = -1;
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(properties: StandaloneTextProperties<Technique, Variant>) {
    super();
    const normalized = normalizeDesired(properties);
    const primary = concreteFonts(normalized.font)[0];
    this.#runtime = primary.runtime;
    this.#technique = primary.technique as Technique;
    this.#desired = normalized;
    this.#leasedFonts = selectedFonts(normalized);
    acquireFonts(this.#leasedFonts, this.#runtime, this.#technique);
    this.#standaloneCapacity = normalizeCapacity(properties.capacity ?? { size: 256, policy: 'grow' });
  }

  get textGroup(): TextGroup<Technique, Variant> | undefined {
    return this.#textGroup;
  }
  get bound(): boolean {
    return this.#paragraph !== undefined;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get layout(): ParagraphLayout | undefined {
    return this.#paragraph?.committed?.layout;
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
    this.set({ text: value } as TextUpdate<Technique, Variant>);
  }
  get spans(): readonly TextSpan<Technique, Variant>[] {
    return this.#desired.spans;
  }
  set spans(value: readonly TextSpan<Technique, Variant>[]) {
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
  get renderVariant(): Variant | undefined {
    return this.#desired.renderVariant;
  }
  set renderVariant(value: Variant | undefined) {
    this.set({ renderVariant: value } as TextUpdate<Technique, Variant>);
  }

  set(update: TextUpdate<Technique, Variant>): void {
    this.#assertActive();
    const next = normalizeDesired({ ...this.#desired, ...replacedContent(update) } as TextProperties<
      Technique,
      Variant
    >);
    const fonts = selectedFonts(next);
    acquireFonts(fonts, this.#runtime, this.#technique);
    releaseFonts(this.#leasedFonts);
    this.#leasedFonts = fonts;
    this.#desired = next;
    this.#desiredRevision += 1;
  }

  setSpan(index: number, span: TextSpan<Technique, Variant>): void {
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

  snapshotGlyphs(): GlyphSnapshot {
    this.#assertActive();
    if (this.#paragraph === undefined) throw new Error('text is not bound to a prepared paragraph');
    return this.#paragraph.snapshotGlyphs();
  }
  setGlyphOrigins(update: GlyphOriginUpdate): void {
    this.#assertActive();
    if (this.#paragraph === undefined) throw new Error('text is not bound to a prepared paragraph');
    this.#paragraph.setGlyphOrigins(update);
  }
  clearGlyphOriginOverrides(): void {
    this.#assertActive();
    this.#paragraph?.clearGlyphOriginOverrides();
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

  override updateMatrixWorld(force?: boolean): void {
    if (this.#disposed) {
      super.updateMatrixWorld(force);
      return;
    }
    const boundary = nearestTextGroup<Technique, Variant>(this);
    if (boundary?.disposed) {
      this.#unbind();
    } else if (boundary !== undefined) {
      boundary.bindText(this);
    } else if (this.parent !== null) {
      if (this.#binding === undefined || this.#textGroup !== undefined) {
        this.#unbind();
        this.#binding = new ThreeTextBatchBinding(this.#runtime, this.#technique, this.#standaloneCapacity, undefined);
      }
      this.#binding.reconcileStandalone(this);
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

  coreProperties(): ParagraphProperties<Technique, Variant> {
    return {
      ...this.#desired,
      order: this.renderOrder,
      ...(this.#desired.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: this.#desired.rasterPixelRatio }),
    };
  }
  needsApply(): boolean {
    return this.#desiredRevision !== this.#appliedRevision;
  }
  markApplied(): void {
    this.#appliedRevision = this.#desiredRevision;
  }
  bind(
    binding: ThreeTextBatchBinding<Technique, Variant>,
    paragraph: Paragraph<Technique, Variant>,
    group: TextGroup<Technique, Variant> | undefined,
  ): void {
    if (this.#binding !== binding) this.#unbind();
    this.#binding = binding;
    this.#paragraph = paragraph;
    this.#textGroup = group;
    this.#appliedRevision = this.#desiredRevision;
  }
  unbindFrom(binding: ThreeTextBatchBinding<Technique, Variant>): void {
    if (this.#binding !== binding) return;
    this.#binding = undefined;
    this.#paragraph = undefined;
    this.#textGroup = undefined;
  }
  setParagraph(paragraph: Paragraph<Technique, Variant>): void {
    this.#paragraph = paragraph;
  }
  get runtime(): TextRuntime {
    return this.#runtime;
  }
  get technique(): Technique {
    return this.#technique;
  }
  #unbind(): void {
    const binding = this.#binding;
    const standalone = binding !== undefined && this.#textGroup === undefined;
    this.#binding = undefined;
    this.#paragraph = undefined;
    this.#textGroup = undefined;
    if (standalone) binding.dispose();
    else binding?.removeText(this);
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('text has been disposed');
  }
}

export class TextGroup<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> extends THREE.Object3D {
  readonly technique: Technique;
  #capacity: GlyphBufferCapacity;
  #renderVariant: Variant | undefined;
  #binding: ThreeTextBatchBinding<Technique, Variant> | undefined;
  #disposed = false;
  #error: unknown;
  onError: ((error: unknown) => void) | undefined;

  constructor(options: TextGroupOptions<Technique, Variant>) {
    super();
    if (options?.technique === undefined) throw new TypeError('TextGroup requires a raster technique');
    this.technique = options.technique;
    this.#capacity = normalizeCapacity(options.capacity ?? { size: 4_096, policy: 'chunk' });
    this.#renderVariant = options.renderVariant;
    if (options.renderOrder !== undefined) this.renderOrder = options.renderOrder;
  }
  get capacity(): GlyphBufferCapacity {
    return this.#capacity;
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
  get renderVariant(): Variant | undefined {
    return this.#renderVariant;
  }
  set renderVariant(value: Variant | undefined) {
    this.#renderVariant = value;
    this.#binding?.setRenderVariant(value);
  }
  setRenderVariant(value: Variant | undefined): void {
    this.renderVariant = value;
  }

  override add<const Children extends readonly THREE.Object3D[]>(
    ...children: CompatibleTextChildren<Technique, Variant, Children>
  ): this {
    this.#assertActive();
    for (const child of children) if (child instanceof Text) validateText(this, child as Text<Technique, Variant>);
    return super.add(...(children as readonly THREE.Object3D[]));
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
      const texts = collectTextDescendants<Technique, Variant>(this);
      if (texts.length !== 0) {
        const first = texts[0]!;
        validateText(this, first);
        this.#binding ??= new ThreeTextBatchBinding(first.runtime, this.technique, this.#capacity, this);
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

  bindText(text: Text<Technique, Variant>): void {
    if (this.#disposed) return;
    validateText(this, text);
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

interface ThreeTargetRevision {
  readonly sourceRevision: number;
  setRenderOrderBase(base: number): void;
  dispose(): void;
}

interface ThreeTargetAttachment {
  readonly error: unknown;
  prepare(): void;
  commit(): ThreeTargetRevision | undefined;
  retry(): void;
  dispose(): void;
}

class ThreeTextBatchBinding<Technique extends AnyRasterTechnique, Variant> implements ThreeRasterTargetOwner {
  readonly #runtime: TextRuntime;
  readonly #group: TextGroup<Technique, Variant> | undefined;
  readonly #batch: ParagraphBatch<Technique, Variant>;
  readonly #paragraphs = new Map<Text<Technique, Variant>, Paragraph<Technique, Variant>>();
  readonly #textsByParagraph = new Map<number, Text<Technique, Variant>>();
  readonly #renderOrders = new Map<Text<Technique, Variant>, number>();
  readonly #target: ThreeRasterTargetAccounting;
  readonly #attachment: ThreeTargetAttachment;
  #disposed = false;

  constructor(
    runtime: TextRuntime,
    technique: Technique,
    capacity: GlyphBufferCapacity,
    group: TextGroup<Technique, Variant> | undefined,
  ) {
    this.#runtime = runtime;
    this.#group = group;
    this.#batch = runtime.createParagraphBatch<Technique, Variant>({
      technique,
      capacity,
      ...(group?.renderVariant === undefined ? {} : { renderVariant: group.renderVariant }),
    });
    const program = threeRasterProgram(technique);
    if (program === undefined) {
      throw new TypeError(
        `no Three raster program is registered for "${technique.id}"; register one with registerThreeRasterProgram`,
      );
    }
    const target = program(this);
    const attached = target as unknown as ParagraphBatchTarget<
      AnyRasterTechnique,
      Variant,
      ParagraphBatchTargetRevision
    >;
    const batch = this.#batch as unknown as ParagraphBatch<AnyRasterTechnique, Variant>;
    this.#target = target;
    this.#attachment = batch.attach(attached) as unknown as ThreeTargetAttachment;
  }
  get textCount(): number {
    return this.#paragraphs.size;
  }
  get error(): unknown {
    return this.#batch.preparationError ?? this.#attachment.error;
  }
  get gpuBytes(): number {
    const bytes = this.#target.gpuBytes;
    return typeof bytes === 'number' ? bytes : 0;
  }
  get renderOrderBase(): number {
    return this.#group?.renderOrder ?? 0;
  }
  objectForParagraph(id: number): THREE.Object3D {
    const text = this.#textsByParagraph.get(id);
    if (text === undefined) throw new Error('Three target cannot resolve a paragraph transform');
    return text;
  }
  reconcile(texts: readonly Text<Technique, Variant>[]): void {
    const desired = new Set(texts);
    for (const text of [...this.#paragraphs.keys()]) if (!desired.has(text)) this.removeText(text);
    for (const text of texts) this.#ensureText(text, this.#group);
  }
  reconcileStandalone(text: Text<Technique, Variant>): void {
    this.#ensureText(text, undefined);
  }
  synchronize(): void {
    if (this.#disposed) return;
    for (const [text, paragraph] of this.#paragraphs) {
      if (text.needsApply()) {
        paragraph.set(text.coreProperties() as ParagraphUpdate<Technique, Variant>);
        text.markApplied();
      }
      if (this.#renderOrders.get(text) !== text.renderOrder) {
        paragraph.order = text.renderOrder;
        this.#renderOrders.set(text, text.renderOrder);
      }
    }
    this.#runtime.update();
    this.#attachment.prepare();
    this.#attachment.commit()?.setRenderOrderBase(this.renderOrderBase);
  }
  setCapacity(value: GlyphBufferCapacity): void {
    this.#batch.setCapacity(value);
  }
  setRenderVariant(value: Variant | undefined): void {
    this.#batch.renderVariant = value;
  }
  retry(): void {
    this.#attachment.retry();
  }
  removeText(text: Text<Technique, Variant>): void {
    const paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined) return;
    this.#paragraphs.delete(text);
    this.#textsByParagraph.delete(paragraph.id);
    this.#renderOrders.delete(text);
    paragraph.dispose();
    text.unbindFrom(this);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const text of this.#paragraphs.keys()) text.unbindFrom(this);
    this.#batch.dispose();
    this.#paragraphs.clear();
    this.#textsByParagraph.clear();
    this.#renderOrders.clear();
  }
  #ensureText(text: Text<Technique, Variant>, group: TextGroup<Technique, Variant> | undefined): void {
    validateBinding(this.#runtime, this.#batch.technique, text);
    let paragraph = this.#paragraphs.get(text);
    if (paragraph === undefined) {
      paragraph = this.#batch.add(text.coreProperties());
      this.#paragraphs.set(text, paragraph);
      this.#textsByParagraph.set(paragraph.id, text);
      this.#renderOrders.set(text, text.renderOrder);
      text.bind(this, paragraph, group);
    }
  }
}

/**
 * Replacement text carries its own formatting: a literal brings its spans and a
 * plain string brings none. Retaining the previous spans would reinterpret them
 * against unrelated text, so an update that replaces text without stating spans
 * clears the ones it replaced.
 */
function replacedContent<Technique extends AnyRasterTechnique, Variant>(
  update: TextUpdate<Technique, Variant>,
): TextUpdate<Technique, Variant> {
  if (!('text' in update) || 'spans' in update) return update;
  return { ...update, spans: [] } as TextUpdate<Technique, Variant>;
}

function normalizeDesired<Technique extends AnyRasterTechnique, Variant>(
  properties: TextProperties<Technique, Variant>,
): DesiredTextState<Technique, Variant> {
  if (properties === undefined) throw new TypeError('Text properties are required');
  const formatted = typeof properties.text === 'string' ? undefined : (properties.text as FormattedText<Technique>);
  return Object.freeze({
    font: properties.font,
    text: formatted?.text ?? (properties.text as string),
    spans: Object.freeze([
      ...((formatted?.spans as readonly TextSpan<Technique, Variant>[]) ?? properties.spans ?? []),
    ]),
    contentBox: Object.freeze({ ...(properties.contentBox ?? {}) }),
    style: Object.freeze({ ...(properties.style ?? {}) }),
    paint: Object.freeze({ ...(properties.paint ?? {}) }),
    ...(properties.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: properties.rasterPixelRatio }),
    ...(properties.renderVariant === undefined ? {} : { renderVariant: properties.renderVariant }),
  });
}
function selectedFonts<Technique extends AnyRasterTechnique, Variant>(
  state: DesiredTextState<Technique, Variant>,
): readonly LoadedFont<Technique>[] {
  const fonts = new Set<LoadedFont<Technique>>(concreteFonts(state.font));
  for (const span of state.spans)
    if (span.font !== undefined) for (const font of concreteFonts(span.font)) fonts.add(font);
  return [...fonts];
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
function normalizeCapacity(value: GlyphBufferCapacity): GlyphBufferCapacity {
  if (!Number.isSafeInteger(value.size) || value.size <= 0)
    throw new RangeError('glyph capacity size must be positive');
  if (value.policy !== 'grow' && value.policy !== 'chunk' && value.policy !== 'fixed')
    throw new TypeError('glyph capacity policy is invalid');
  return Object.freeze({ size: value.size, policy: value.policy });
}
function nearestTextGroup<Technique extends AnyRasterTechnique, Variant>(
  object: THREE.Object3D,
): TextGroup<Technique, Variant> | undefined {
  let parent = object.parent;
  while (parent !== null) {
    if (parent instanceof TextGroup) return parent as TextGroup<Technique, Variant>;
    parent = parent.parent;
  }
  return undefined;
}
function collectTextDescendants<Technique extends AnyRasterTechnique, Variant>(
  group: TextGroup<Technique, Variant>,
): Text<Technique, Variant>[] {
  const texts: Text<Technique, Variant>[] = [];
  for (const child of group.children) collect(child, texts);
  return texts;
  function collect(object: THREE.Object3D, result: Text<Technique, Variant>[]): void {
    if (object instanceof TextGroup) return;
    if (object instanceof Text) result.push(object as Text<Technique, Variant>);
    for (const child of object.children) collect(child, result);
  }
}
function validateText<Technique extends AnyRasterTechnique, Variant>(
  group: TextGroup<Technique, Variant>,
  text: Text<Technique, Variant>,
): void {
  validateBinding(text.runtime, group.technique, text);
}
function validateBinding<Technique extends AnyRasterTechnique, Variant>(
  runtime: TextRuntime,
  technique: Technique,
  text: Text<Technique, Variant>,
): void {
  if (text.disposed) throw new TypeError('disposed text cannot be attached');
  if (text.runtime !== runtime) throw new TypeError('text belongs to another Three font-cache domain');
  if (text.technique !== technique) throw new TypeError('text uses another raster technique');
  assertFontSelection(text.font, text.runtime, text.technique);
}
