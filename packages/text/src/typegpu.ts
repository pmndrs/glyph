import type { TgpuRoot } from 'typegpu';

import type { FormattedText, GlyphPaintInput, ParagraphSpan, TextInput } from './formatted-text.js';
import type { ParagraphLayout } from './layout.js';
import type {
  GlyphBufferCapacity,
  GlyphOriginUpdate,
  GlyphSnapshot,
  Paragraph,
  ParagraphBatch,
  ParagraphContentBox,
  ParagraphId,
  ParagraphProperties,
  ParagraphSnapshot,
  ParagraphUpdate,
  TextPreparationError,
} from './paragraph-batch.js';
import type { ParagraphStyle } from './paragraph.js';
import type {
  ParagraphBatchAttachment,
  ParagraphBatchTarget,
  ParagraphBatchTargetError,
  ParagraphBatchTargetRevision,
} from './paragraph-batch-attachment.js';
import type { AnyRasterTechnique } from './raster-technique.js';
import {
  createTextRuntime,
  type AsyncTextUpdateOptions,
  type LoadedFontRequest,
  type TextRuntime,
  type TextRuntimeOptions,
  type TextRuntimeRevision,
  type TextUpdateCallback,
  type TextUpdateOutcome,
} from './text-runtime.js';
import type { FontSelection, LoadedFont } from './loaded-font.js';

export interface TypeGpuFrame {
  readonly viewProjection: Float32Array;
  readonly viewport: readonly [width: number, height: number];
  readonly pixelRatio: number;
}

export interface TypeGpuParagraphState {
  readonly transform: Float32Array;
  readonly visible: boolean;
}

export interface TypeGpuParagraphBatchTargetRevision<Draw> extends ParagraphBatchTargetRevision {
  readonly draws: readonly Draw[];
}

/**
 * Program-owned rendering target. Core supplies revisions; the program owns the exact TypeGPU
 * buffers, bind groups, pipelines, resources, partial writes, and draw encoding they require.
 */
export interface TypeGpuParagraphBatchTarget<
  Technique extends AnyRasterTechnique,
  Variant,
  Draw,
  Revision extends TypeGpuParagraphBatchTargetRevision<Draw> = TypeGpuParagraphBatchTargetRevision<Draw>,
> extends ParagraphBatchTarget<Technique, Variant, Revision> {
  readonly root: TgpuRoot;
  setParagraphState(paragraph: ParagraphId, state: TypeGpuParagraphState | undefined): void;
  encode(pass: GPURenderPassEncoder, revision: Revision, frame: TypeGpuFrame): void;
}

export interface TypeGpuTargetOptions<Technique extends AnyRasterTechnique> {
  readonly root: TgpuRoot;
  readonly technique: Technique;
  readonly colorFormat: GPUTextureFormat;
  readonly depthStencil?: GPUDepthStencilState;
  readonly sampleCount: number;
}

declare const typeGpuRasterProgramTypes: unique symbol;

interface TypeGpuRasterProgramTypeMap<Variant, Draw, Revision> {
  readonly variant: Variant;
  readonly draw: Draw;
  readonly revision: Revision;
}

export interface AnyTypeGpuRasterProgram<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly [typeGpuRasterProgramTypes]?: TypeGpuRasterProgramTypeMap<
    unknown,
    unknown,
    TypeGpuParagraphBatchTargetRevision<unknown>
  >;
  dispose(): void;
}

export interface TypeGpuRasterProgram<
  Technique extends AnyRasterTechnique,
  Variant,
  Draw,
  Revision extends TypeGpuParagraphBatchTargetRevision<Draw>,
> extends AnyTypeGpuRasterProgram<Technique> {
  readonly [typeGpuRasterProgramTypes]?: TypeGpuRasterProgramTypeMap<Variant, Draw, Revision>;
  createTarget(
    options: TypeGpuTargetOptions<Technique>,
  ): TypeGpuParagraphBatchTarget<Technique, Variant, Draw, Revision>;
}

export type TypeGpuProgramTypesOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> = NonNullable<
  Program[typeof typeGpuRasterProgramTypes]
>;
export type TypeGpuVariantOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> =
  TypeGpuProgramTypesOf<Program>['variant'];
export type TypeGpuDrawOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> =
  TypeGpuProgramTypesOf<Program>['draw'];
export type TypeGpuRevisionOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> =
  TypeGpuProgramTypesOf<Program>['revision'];

export function defineTypeGpuRasterProgram<
  Technique extends AnyRasterTechnique,
  Variant,
  Draw,
  Revision extends TypeGpuParagraphBatchTargetRevision<Draw>,
>(
  program: TypeGpuRasterProgram<Technique, Variant, Draw, Revision>,
): TypeGpuRasterProgram<Technique, Variant, Draw, Revision> {
  return program;
}

export interface TypeGpuRasterShader<Technique extends AnyRasterTechnique, Vertex, Fragment, Resources> {
  readonly technique: Technique;
  readonly vertex: Vertex;
  readonly fragment: Fragment;
  readonly resources: Resources;
}

export function defineTypeGpuRasterShader<
  Technique extends AnyRasterTechnique,
  Vertex,
  Fragment,
  Resources,
  const Shader extends TypeGpuRasterShader<Technique, Vertex, Fragment, Resources>,
>(shader: Shader): Shader {
  return shader;
}

export interface TypeGpuTextEngineOptions {
  readonly root: TgpuRoot;
  readonly colorFormat: GPUTextureFormat;
  readonly depthStencil?: GPUDepthStencilState;
  readonly sampleCount?: number;
  readonly runtime?: TextRuntimeOptions;
}

export interface TypeGpuParagraphBatchOptions<
  Technique extends AnyRasterTechnique,
  Program extends AnyTypeGpuRasterProgram<Technique>,
> {
  readonly technique: Technique;
  readonly program: Program;
  readonly capacity?: GlyphBufferCapacity;
  readonly rasterPixelRatio?: number;
  readonly renderVariant?: TypeGpuVariantOf<Program>;
}

export type TypeGpuParagraphProperties<Technique extends AnyRasterTechnique, Variant> = ParagraphProperties<
  Technique,
  Variant
> &
  Readonly<{ transform?: ArrayLike<number>; visible?: boolean }>;

export type TypeGpuParagraphUpdate<Technique extends AnyRasterTechnique, Variant> = ParagraphUpdate<
  Technique,
  Variant
> &
  Readonly<{ transform?: ArrayLike<number>; visible?: boolean }>;

export interface TypeGpuParagraphSnapshot<Technique extends AnyRasterTechnique, Variant> extends ParagraphSnapshot<
  Technique,
  Variant
> {
  readonly transform: Float32Array;
  readonly visible: boolean;
}

export interface TypeGpuParagraph<Technique extends AnyRasterTechnique, Variant> {
  readonly id: ParagraphId;
  readonly disposed: boolean;
  readonly layout: ParagraphLayout | undefined;
  font: FontSelection<Technique>;
  text: TextInput<Technique>;
  spans: readonly ParagraphSpan<Technique, Variant>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  rasterPixelRatio: number;
  order: number;
  renderVariant: Variant | undefined;
  visible: boolean;
  set(properties: TypeGpuParagraphUpdate<Technique, Variant>): void;
  setSpan(index: number, span: ParagraphSpan<Technique, Variant>): void;
  removeSpan(index: number): void;
  setTransform(columnMajorMatrix4: ArrayLike<number>): void;
  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;
  snapshotProperties(): TypeGpuParagraphSnapshot<Technique, Variant>;
  dispose(): void;
}

export interface TypeGpuParagraphBatch<
  Technique extends AnyRasterTechnique,
  Variant,
  Program extends AnyTypeGpuRasterProgram<Technique>,
> {
  readonly technique: Technique;
  readonly program: Program;
  readonly current: TypeGpuRevisionOf<Program> | undefined;
  readonly error: TextPreparationError | ParagraphBatchTargetError | undefined;
  readonly disposed: boolean;
  rasterPixelRatio: number;
  renderVariant: Variant | undefined;
  add(properties: TypeGpuParagraphProperties<Technique, Variant>): TypeGpuParagraph<Technique, Variant>;
  has(paragraph: TypeGpuParagraph<Technique, Variant>): boolean;
  setCapacity(capacity: GlyphBufferCapacity): void;
  retry(): void;
  encode(pass: GPURenderPassEncoder, frame: TypeGpuFrame): void;
  dispose(): void;
}

export interface TypeGpuTextEngine {
  readonly root: TgpuRoot;
  readonly current: TextRuntimeRevision;
  readonly disposed: boolean;
  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;
  createParagraphBatch<
    Technique extends AnyRasterTechnique,
    Variant,
    Draw,
    Revision extends TypeGpuParagraphBatchTargetRevision<Draw>,
    Program extends TypeGpuRasterProgram<Technique, Variant, Draw, Revision>,
  >(
    options: TypeGpuParagraphBatchOptions<Technique, Program>,
  ): TypeGpuParagraphBatch<Technique, TypeGpuVariantOf<Program>, Program>;
  update(): TextRuntimeRevision;
  updateAsync(options?: AsyncTextUpdateOptions): Promise<TextUpdateOutcome>;
  updateAsync(callback: TextUpdateCallback): void;
  updateAsync(options: AsyncTextUpdateOptions, callback: TextUpdateCallback): void;
  dispose(): void;
}

export async function createTypeGpuTextEngine(options: TypeGpuTextEngineOptions): Promise<TypeGpuTextEngine> {
  const sampleCount = options.sampleCount ?? 1;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1)
    throw new RangeError('sampleCount must be a positive integer');
  const runtime = await createTextRuntime(options.runtime);
  return new TypeGpuTextEngineImpl(runtime, options.root, options.colorFormat, options.depthStencil, sampleCount);
}

class TypeGpuTextEngineImpl implements TypeGpuTextEngine {
  readonly root: TgpuRoot;
  readonly #runtime: TextRuntime;
  readonly #colorFormat: GPUTextureFormat;
  readonly #depthStencil: GPUDepthStencilState | undefined;
  readonly #sampleCount: number;
  readonly #batches = new Set<
    TypeGpuParagraphBatchImpl<AnyRasterTechnique, unknown, AnyTypeGpuRasterProgram<AnyRasterTechnique>>
  >();
  #disposed = false;

  constructor(
    runtime: TextRuntime,
    root: TgpuRoot,
    colorFormat: GPUTextureFormat,
    depthStencil: GPUDepthStencilState | undefined,
    sampleCount: number,
  ) {
    this.#runtime = runtime;
    this.root = root;
    this.#colorFormat = colorFormat;
    this.#depthStencil = depthStencil;
    this.#sampleCount = sampleCount;
  }

  get current(): TextRuntimeRevision {
    return this.#runtime.current;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>> {
    this.#assertActive();
    return this.#runtime.loadFont(request, options);
  }
  createParagraphBatch<
    Technique extends AnyRasterTechnique,
    Variant,
    Draw,
    Revision extends TypeGpuParagraphBatchTargetRevision<Draw>,
    Program extends TypeGpuRasterProgram<Technique, Variant, Draw, Revision>,
  >(
    options: TypeGpuParagraphBatchOptions<Technique, Program>,
  ): TypeGpuParagraphBatch<Technique, TypeGpuVariantOf<Program>, Program> {
    this.#assertActive();
    if (options.program.technique !== options.technique)
      throw new TypeError('TypeGPU program uses another raster technique');
    const batch = new TypeGpuParagraphBatchImpl<Technique, TypeGpuVariantOf<Program>, Program>(
      this.#runtime,
      this.root,
      this.#colorFormat,
      this.#depthStencil,
      this.#sampleCount,
      options,
      (value) => this.#batches.delete(value),
    );
    this.#batches.add(
      batch as TypeGpuParagraphBatchImpl<AnyRasterTechnique, unknown, AnyTypeGpuRasterProgram<AnyRasterTechnique>>,
    );
    return batch;
  }
  update(): TextRuntimeRevision {
    this.#assertActive();
    return this.#runtime.update();
  }
  updateAsync(options?: AsyncTextUpdateOptions): Promise<TextUpdateOutcome>;
  updateAsync(callback: TextUpdateCallback): void;
  updateAsync(options: AsyncTextUpdateOptions, callback: TextUpdateCallback): void;
  updateAsync(
    options?: AsyncTextUpdateOptions | TextUpdateCallback,
    callback?: TextUpdateCallback,
  ): Promise<TextUpdateOutcome> | void {
    this.#assertActive();
    if (typeof options === 'function') return this.#runtime.updateAsync(options);
    if (callback !== undefined) return this.#runtime.updateAsync(options ?? {}, callback);
    return this.#runtime.updateAsync(options);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const batch of [...this.#batches]) batch.dispose();
    this.#runtime.dispose();
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('TypeGPU text engine has been disposed');
  }
}

class TypeGpuParagraphBatchImpl<
  Technique extends AnyRasterTechnique,
  Variant,
  Program extends AnyTypeGpuRasterProgram<Technique>,
> implements TypeGpuParagraphBatch<Technique, Variant, Program> {
  readonly technique: Technique;
  readonly program: Program;
  readonly #batch: ParagraphBatch<Technique, Variant>;
  readonly #target: TypeGpuParagraphBatchTarget<Technique, Variant, TypeGpuDrawOf<Program>, TypeGpuRevisionOf<Program>>;
  readonly #attachment: ParagraphBatchAttachment<Technique, Variant, TypeGpuRevisionOf<Program>>;
  readonly #paragraphs = new Map<ParagraphId, TypeGpuParagraphImpl<Technique, Variant>>();
  readonly #onDispose: (
    batch: TypeGpuParagraphBatchImpl<AnyRasterTechnique, unknown, AnyTypeGpuRasterProgram<AnyRasterTechnique>>,
  ) => void;
  #disposed = false;

  constructor(
    runtime: TextRuntime,
    root: TgpuRoot,
    colorFormat: GPUTextureFormat,
    depthStencil: GPUDepthStencilState | undefined,
    sampleCount: number,
    options: TypeGpuParagraphBatchOptions<Technique, Program>,
    onDispose: (
      batch: TypeGpuParagraphBatchImpl<AnyRasterTechnique, unknown, AnyTypeGpuRasterProgram<AnyRasterTechnique>>,
    ) => void,
  ) {
    this.technique = options.technique;
    this.program = options.program;
    this.#onDispose = onDispose;
    this.#batch = runtime.createParagraphBatch<Technique, Variant>({
      technique: options.technique,
      ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
      ...(options.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: options.rasterPixelRatio }),
      ...(options.renderVariant === undefined ? {} : { renderVariant: options.renderVariant as Variant }),
    });
    const program = options.program as unknown as TypeGpuRasterProgram<
      Technique,
      Variant,
      TypeGpuDrawOf<Program>,
      TypeGpuRevisionOf<Program>
    >;
    this.#target = program.createTarget({
      root,
      technique: options.technique,
      colorFormat,
      ...(depthStencil === undefined ? {} : { depthStencil }),
      sampleCount,
    });
    this.#attachment = this.#batch.attach(this.#target);
  }

  get current(): TypeGpuRevisionOf<Program> | undefined {
    return this.#attachment.current;
  }
  get error(): TextPreparationError | ParagraphBatchTargetError | undefined {
    return this.#batch.preparationError ?? this.#attachment.error;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get rasterPixelRatio(): number {
    return this.#batch.rasterPixelRatio;
  }
  set rasterPixelRatio(value: number) {
    this.#assertActive();
    this.#batch.rasterPixelRatio = value;
  }
  get renderVariant(): Variant | undefined {
    return this.#batch.renderVariant;
  }
  set renderVariant(value: Variant | undefined) {
    this.#assertActive();
    this.#batch.renderVariant = value;
  }
  add(properties: TypeGpuParagraphProperties<Technique, Variant>): TypeGpuParagraph<Technique, Variant> {
    this.#assertActive();
    const { transform, visible, ...coreProperties } = properties;
    const paragraph = this.#batch.add(coreProperties as ParagraphProperties<Technique, Variant>);
    const value = new TypeGpuParagraphImpl(paragraph, transform, visible, this.#target, () => {
      this.#paragraphs.delete(paragraph.id);
    });
    this.#paragraphs.set(paragraph.id, value);
    return value;
  }
  has(paragraph: TypeGpuParagraph<Technique, Variant>): boolean {
    return this.#paragraphs.get(paragraph.id) === paragraph && !paragraph.disposed;
  }
  setCapacity(capacity: GlyphBufferCapacity): void {
    this.#assertActive();
    this.#batch.setCapacity(capacity);
  }
  retry(): void {
    this.#assertActive();
    this.#attachment.retry();
  }
  encode(pass: GPURenderPassEncoder, frame: TypeGpuFrame): void {
    this.#assertActive();
    assertFrame(frame);
    this.#attachment.prepare();
    const revision = this.#attachment.commit();
    if (revision !== undefined) this.#target.encode(pass, revision, frame);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const paragraph of [...this.#paragraphs.values()]) paragraph.dispose();
    this.#attachment.dispose();
    this.#batch.dispose();
    this.#onDispose(
      this as TypeGpuParagraphBatchImpl<AnyRasterTechnique, unknown, AnyTypeGpuRasterProgram<AnyRasterTechnique>>,
    );
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('TypeGPU paragraph batch has been disposed');
  }
}

const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

class TypeGpuParagraphImpl<Technique extends AnyRasterTechnique, Variant> implements TypeGpuParagraph<
  Technique,
  Variant
> {
  readonly #paragraph: Paragraph<Technique, Variant>;
  readonly #target: Pick<TypeGpuParagraphBatchTarget<Technique, Variant, unknown>, 'setParagraphState'>;
  readonly #onDispose: () => void;
  #transform: Float32Array;
  #visible: boolean;
  #disposed = false;

  constructor(
    paragraph: Paragraph<Technique, Variant>,
    transform: ArrayLike<number> | undefined,
    visible: boolean | undefined,
    target: Pick<TypeGpuParagraphBatchTarget<Technique, Variant, unknown>, 'setParagraphState'>,
    onDispose: () => void,
  ) {
    this.#paragraph = paragraph;
    this.#target = target;
    this.#onDispose = onDispose;
    this.#transform = copyTransform(transform ?? IDENTITY_MATRIX);
    this.#visible = visible ?? true;
    this.#publishTargetState();
  }
  get id(): ParagraphId {
    return this.#paragraph.id;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get layout(): ParagraphLayout | undefined {
    return this.#paragraph.committed?.layout;
  }
  get font(): FontSelection<Technique> {
    return this.#paragraph.font;
  }
  set font(value: FontSelection<Technique>) {
    this.#paragraph.font = value;
  }
  get text(): string {
    return this.#paragraph.snapshotProperties().text;
  }
  set text(value: TextInput<Technique>) {
    this.#paragraph.text = value;
  }
  get spans(): readonly ParagraphSpan<Technique, Variant>[] {
    return this.#paragraph.spans;
  }
  set spans(value: readonly ParagraphSpan<Technique, Variant>[]) {
    this.#paragraph.spans = value;
  }
  get contentBox(): ParagraphContentBox {
    return this.#paragraph.contentBox;
  }
  set contentBox(value: ParagraphContentBox) {
    this.#paragraph.contentBox = value;
  }
  get style(): ParagraphStyle {
    return this.#paragraph.style;
  }
  set style(value: ParagraphStyle) {
    this.#paragraph.style = value;
  }
  get paint(): GlyphPaintInput {
    return this.#paragraph.paint;
  }
  set paint(value: GlyphPaintInput) {
    this.#paragraph.paint = value;
  }
  get rasterPixelRatio(): number {
    return this.#paragraph.rasterPixelRatio;
  }
  set rasterPixelRatio(value: number) {
    this.#paragraph.rasterPixelRatio = value;
  }
  get order(): number {
    return this.#paragraph.order;
  }
  set order(value: number) {
    this.#paragraph.order = value;
  }
  get renderVariant(): Variant | undefined {
    return this.#paragraph.renderVariant;
  }
  set renderVariant(value: Variant | undefined) {
    this.#paragraph.renderVariant = value;
  }
  get visible(): boolean {
    return this.#visible;
  }
  set visible(value: boolean) {
    this.#assertActive();
    if (this.#visible === value) return;
    this.#visible = value;
    this.#publishTargetState();
  }
  set(properties: TypeGpuParagraphUpdate<Technique, Variant>): void {
    this.#assertActive();
    const { transform, visible, ...coreProperties } = properties;
    this.#paragraph.set(coreProperties as ParagraphUpdate<Technique, Variant>);
    if (transform !== undefined) this.#transform = copyTransform(transform);
    if (visible !== undefined) this.#visible = visible;
    if (transform !== undefined || visible !== undefined) this.#publishTargetState();
  }
  setSpan(index: number, span: ParagraphSpan<Technique, Variant>): void {
    this.#paragraph.setSpan(index, span);
  }
  removeSpan(index: number): void {
    this.#paragraph.removeSpan(index);
  }
  setTransform(columnMajorMatrix4: ArrayLike<number>): void {
    this.#assertActive();
    this.#transform = copyTransform(columnMajorMatrix4);
    this.#publishTargetState();
  }
  snapshotGlyphs(): GlyphSnapshot {
    return this.#paragraph.snapshotGlyphs();
  }
  setGlyphOrigins(update: GlyphOriginUpdate): void {
    this.#paragraph.setGlyphOrigins(update);
  }
  clearGlyphOriginOverrides(): void {
    this.#paragraph.clearGlyphOriginOverrides();
  }
  snapshotProperties(): TypeGpuParagraphSnapshot<Technique, Variant> {
    return Object.freeze({
      ...this.#paragraph.snapshotProperties(),
      transform: this.#transform.slice(),
      visible: this.#visible,
    });
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#target.setParagraphState(this.id, undefined);
    this.#paragraph.dispose();
    this.#onDispose();
  }
  #publishTargetState(): void {
    this.#target.setParagraphState(
      this.id,
      Object.freeze({ transform: this.#transform.slice(), visible: this.#visible }),
    );
  }
  #assertActive(): void {
    if (this.#disposed) throw new Error('TypeGPU paragraph has been disposed');
  }
}

function copyTransform(value: ArrayLike<number>): Float32Array {
  if (value.length !== 16) throw new TypeError('paragraph transform must contain exactly 16 values');
  const result = Float32Array.from(value);
  for (const component of result)
    if (!Number.isFinite(component)) throw new TypeError('paragraph transform must be finite');
  return result;
}

function assertFrame(frame: TypeGpuFrame): void {
  copyTransform(frame.viewProjection);
  if (
    frame.viewport.length !== 2 ||
    !Number.isFinite(frame.viewport[0]) ||
    frame.viewport[0] <= 0 ||
    !Number.isFinite(frame.viewport[1]) ||
    frame.viewport[1] <= 0
  )
    throw new TypeError('TypeGPU frame viewport must contain two positive finite values');
  if (!Number.isFinite(frame.pixelRatio) || frame.pixelRatio <= 0)
    throw new TypeError('TypeGPU frame pixelRatio must be positive and finite');
}

export type { FormattedText };
