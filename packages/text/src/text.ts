import * as THREE from 'three/webgpu';
import type { AnyFontToken, FontInput, RegisteredFont } from './font.js';
import type { FontHandle, FontSlot } from './identity.js';
import type { ParagraphLayout } from './layout.js';
import type { GlyphPaint, LinearRgba, ResolvedPaint } from './paint.js';
import { createParagraphEngine, type Paragraph, type ParagraphConstraints } from './paragraph.js';
import type {
  AnyRasterInput,
  AnyRasterModule,
  LoadedRaster,
  RasterBatchStage,
  RasterObjectDrawBatch,
} from './raster.js';
import {
  assertRasterBatchStage,
  EMPTY_TEXT_STATE,
  isFontToken,
  isNormalizedRasterRequest,
  normalizeRasterInput,
  normalizeTextState,
  sameLayoutInput,
  sameParagraphInput,
  sameTextInput,
  type NormalizedRasterRequest,
  type TextState,
} from './internal/text-properties.js';
import {
  isRegisteredFont,
  loadedTextFont,
  loadedTextShaper,
  loadTextFont,
  sharedRasterRuntime,
  textRegistry,
  textShaper,
} from './internal/text-runtime.js';
import type { FontRegistry } from './loader.js';

/** Three.js adapter batch required by raster modules rendered through {@link Text}. */
export type ThreeRasterDrawBatch = RasterObjectDrawBatch<THREE.Object3D>;

export interface FontFeature {
  readonly tag: string;
  readonly value?: number;
  readonly start?: number;
  readonly end?: number;
}

/** Resolved, absolute UTF-16 feature range passed to the shaping ABI. */
export interface ResolvedFontFeature {
  readonly tag: string;
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

export interface TextLayoutProperties {
  readonly width?: number;
  readonly height?: number;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
  readonly textAlign?: 'start' | 'center' | 'end' | 'justify';
}

export interface TextShapingProperties {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
}

export interface TextPaintProperties {
  readonly color?: THREE.ColorRepresentation;
  readonly opacity?: number;
  readonly outline?: {
    readonly color: THREE.ColorRepresentation;
    /** Paragraph-local layout units. */
    readonly width: number;
  };
  readonly shadow?: {
    readonly color: THREE.ColorRepresentation;
    /** Paragraph-local layout units: positive X is right and positive Y is down. */
    readonly offset: readonly [number, number];
  };
}

export interface TextRasterProperties {
  /** Physical device pixels represented by one paragraph-local CSS pixel. */
  readonly rasterPixelRatio?: number;
}

export interface TextSpan extends TextShapingProperties, TextPaintProperties {
  readonly start: number;
  readonly end: number;
  readonly font?: AnyFontToken | FontInput | RegisteredFont;
}

export type TextFontProperties =
  | {
      readonly font: AnyFontToken;
      readonly raster?: never;
    }
  | {
      readonly font: FontInput | RegisteredFont;
      readonly raster: AnyRasterInput;
    }
  | {
      readonly font?: undefined;
      readonly raster?: undefined;
    };

export type TextContentProperties =
  | {
      readonly text?: string;
      readonly spans?: never;
    }
  | {
      readonly text: string;
      readonly spans: readonly TextSpan[];
    };

export type TextProperties = TextLayoutProperties &
  TextShapingProperties &
  TextPaintProperties &
  TextRasterProperties &
  TextFontProperties &
  TextContentProperties & {
    readonly onLayout?: (layout: ParagraphLayout) => void;
  };

type TextContentUpdate =
  | { readonly text?: never; readonly spans?: never }
  | { readonly text: string; readonly spans?: readonly TextSpan[] };

type TextFontUpdate =
  | { readonly font?: never; readonly raster?: never }
  | { readonly font: undefined; readonly raster?: undefined }
  | { readonly font: AnyFontToken; readonly raster?: never }
  | {
      readonly font: FontInput | RegisteredFont;
      readonly raster: AnyRasterInput;
    };

/**
 * A patch whose coupled content and font/raster fields remain atomic.
 * The complete merged Text state is validated before it is committed.
 */
export type TextUpdateProperties = Partial<Omit<TextProperties, 'text' | 'spans' | 'font' | 'raster'>> &
  TextContentUpdate &
  TextFontUpdate;

interface ResolvedFontRaster {
  readonly font: RegisteredFont;
  readonly request: NormalizedRasterRequest;
  readonly raster: LoadedRaster<AnyRasterModule>;
}

interface OwnedBatch {
  readonly module: AnyRasterModule;
  readonly raster: LoadedRaster<AnyRasterModule>;
  readonly batch: ThreeRasterDrawBatch;
  readonly fontHandle: FontHandle;
  readonly fontSlot: FontSlot;
}

interface StagedBatch {
  readonly stage: RasterBatchStage<ThreeRasterDrawBatch>;
  readonly previous: ThreeRasterDrawBatch | undefined;
}

interface TextGeneration {
  state: TextState;
  readonly paragraph: Paragraph;
  /** True only when this uncommitted generation acquired the paragraph it carries. */
  readonly createdParagraph: boolean;
  readonly layout: ParagraphLayout;
  readonly paintPlan: GlyphPaintPlan;
  batches: OwnedBatch[];
  readonly batchStages: StagedBatch[];
  readonly releaseFontDisposal: () => void;
}

interface PendingPublication {
  readonly generation: TextGeneration;
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
}

interface GlyphPaintPlan {
  readonly paintIndices: Uint16Array;
  readonly spanCount: number;
}

interface ResolvedParagraphInput {
  readonly registry: FontRegistry;
  readonly root: ResolvedFontRaster;
  readonly fontsByHandle: ReadonlyMap<FontHandle, ResolvedFontRaster>;
  readonly spans: readonly import('./paragraph.js').ParagraphSpan[];
}

interface PreparedFontRaster {
  readonly fontHandle: FontHandle;
  readonly fontRaster: ResolvedFontRaster;
  readonly fontSlot: FontSlot;
}

/** Framework-neutral Three.js text object with transactional generations. */
export class Text extends THREE.Object3D {
  #state: TextState;
  #generation: TextGeneration | undefined;
  #pending: AbortController | undefined;
  #publication: PendingPublication | undefined;
  #invalidatedState: TextState | undefined;
  #revision = 0;
  #renderOrderBase = Number.NaN;
  #ready: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(properties: TextProperties = {}) {
    super();
    this.name = 'pmndrs.text';
    this.#state = normalizeTextState(EMPTY_TEXT_STATE, properties, true);
    this.#schedule();
  }

  get ready(): Promise<void> {
    return this.#ready;
  }

  get layout(): ParagraphLayout | undefined {
    return this.#generation?.layout;
  }

  setProperties(properties: TextUpdateProperties): void {
    this.#assertActive();
    const next = normalizeTextState(this.#state, properties, false);
    if (sameTextInput(this.#state, next)) {
      this.#state = next;
      if (this.#invalidatedState !== undefined && sameTextInput(this.#invalidatedState, next)) return;
      if (this.#pending !== undefined) return;
      if (this.#publication !== undefined && sameTextInput(this.#publication.generation.state, next)) {
        this.#publication.generation.state = next;
        return;
      }
      if (this.#generation !== undefined && sameTextInput(this.#generation.state, next)) {
        this.#generation.state = next;
        return;
      }
      if (next.font === undefined) return;
    }
    let prevalidatedPaint: GlyphPaint | undefined;
    if (this.#generation !== undefined && sameLayoutInput(this.#generation.state, next)) {
      prevalidatedPaint = resolveGlyphPaint(next, this.#generation.paintPlan);
      for (const owned of this.#generation.batches) owned.module.validatePaint?.(prevalidatedPaint);
    }
    const previousState = this.#state;
    this.#state = next;
    try {
      this.#schedule(prevalidatedPaint);
    } catch (error) {
      this.#state = previousState;
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revision += 1;
    const reason = new DOMException('The text object was disposed', 'AbortError');
    this.#pending?.abort(reason);
    this.#pending = undefined;
    this.#cancelPublication(reason);
    this.#disposeGeneration(this.#generation);
    this.#generation = undefined;
    this.#invalidatedState = undefined;
    this.#setCancelledReady(reason);
  }

  override updateMatrixWorld(force?: boolean): void {
    this.#publishPending();
    this.#syncRenderOrderBase();
    super.updateMatrixWorld(force);
  }

  override updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void {
    this.#publishPending();
    this.#syncRenderOrderBase();
    super.updateWorldMatrix(updateParents, updateChildren);
  }

  #schedule(prevalidatedPaint?: GlyphPaint): void {
    if (this.#state.font === undefined) {
      this.#invalidatedState = undefined;
      this.#revision += 1;
      this.#pending?.abort();
      this.#pending = undefined;
      this.#cancelPublication(new DOMException('The text generation was superseded', 'AbortError'));
      this.#disposeGeneration(this.#generation);
      this.#generation = undefined;
      this.#ready = Promise.resolve();
      return;
    }

    const controller = new AbortController();
    const warm = this.#buildWarmGeneration(this.#state, prevalidatedPaint, controller);
    if (warm !== undefined) {
      this.#invalidatedState = undefined;
      this.#revision += 1;
      const revision = this.#revision;
      this.#pending?.abort();
      this.#pending = undefined;
      this.#cancelPublication(new DOMException('The text generation was superseded', 'AbortError'));
      if (warm instanceof Promise) {
        this.#trackAsyncGeneration(warm, controller, revision);
        return;
      }
      if (this.#generation === undefined) {
        this.#commitGeneration(warm);
        this.#ready = Promise.resolve();
        return;
      }
      const publication = Promise.withResolvers<void>();
      void publication.promise.catch(() => undefined);
      this.#publication = { generation: warm, resolve: publication.resolve, reject: publication.reject };
      this.#ready = publication.promise;
      return;
    }

    this.#invalidatedState = undefined;
    this.#revision += 1;
    const revision = this.#revision;
    this.#pending?.abort();
    this.#pending = undefined;
    this.#cancelPublication(new DOMException('The text generation was superseded', 'AbortError'));
    this.#trackAsyncGeneration(this.#buildGeneration(this.#state, controller), controller, revision);
  }

  #trackAsyncGeneration(build: Promise<TextGeneration>, controller: AbortController, revision: number): void {
    this.#pending = controller;
    const ready = build.then((generation) => {
      if (this.#disposed || revision !== this.#revision || controller.signal.aborted) {
        this.#disposeUncommitted(generation);
        controller.signal.throwIfAborted();
        return;
      }
      this.#pending = undefined;
      this.#commitGeneration(generation);
    });
    // `ready` remains an observation channel that rejects on failure or cancellation. The
    // internal branch prevents an abandoned generation from becoming an unhandled rejection.
    void ready.catch(() => {
      if (this.#pending === controller) this.#pending = undefined;
    });
    this.#ready = ready;
  }

  #buildWarmGeneration(
    state: TextState,
    prevalidatedPaint: GlyphPaint | undefined,
    controller: AbortController,
  ): TextGeneration | Promise<TextGeneration> | undefined {
    const resolved = resolveParagraphInputSync(state);
    if (resolved === undefined) return undefined;
    const reusableParagraph =
      this.#generation !== undefined && sameParagraphInput(this.#generation.state, state)
        ? this.#generation.paragraph
        : undefined;
    let paragraph = reusableParagraph;
    let ownsParagraph = false;
    let handedOff = false;
    const cleanup = () => {
      if (handedOff) return;
      handedOff = true;
      if (ownsParagraph) paragraph?.dispose();
    };
    try {
      if (paragraph === undefined) {
        const shaper = loadedTextShaper(resolved.registry);
        if (shaper === undefined) return undefined;
        paragraph = createParagraphEngine({ shaper }).create({
          text: state.text,
          font: resolved.root.font.handle,
          spans: resolved.spans,
          style: paragraphStyle(state),
        });
        ownsParagraph = true;
      }
      const builtParagraph = paragraph;
      const retainedLayout =
        this.#generation !== undefined && sameLayoutInput(this.#generation.state, state) ? this.#generation : undefined;
      const layout = retainedLayout?.layout ?? builtParagraph.layout(paragraphConstraints(state));
      const paintPlan = retainedLayout?.paintPlan ?? createGlyphPaintPlan(layout, state);
      const paint = prevalidatedPaint ?? resolveGlyphPaint(state, paintPlan);
      const prepared: PreparedFontRaster[] = [];
      const preparations: Promise<void>[] = [];
      for (let slot = 0; slot < layout.fontHandles.length; slot += 1) {
        const handle = layout.fontHandles[slot] as FontHandle | undefined;
        if (handle === undefined) throw new Error('paragraph layout has an incomplete font table');
        const fontRaster = resolved.fontsByHandle.get(handle);
        if (fontRaster === undefined) throw new Error('paragraph layout references an unresolved font');
        fontRaster.raster.module.validatePaint?.(paint);
        if (retainedLayout === undefined) {
          const preparation = fontRaster.raster.module.prepare(
            layout,
            fontRaster.raster.resource,
            slot,
            controller.signal,
          );
          if (preparation !== undefined) {
            void preparation.catch(() => undefined);
            preparations.push(preparation);
          }
        }
        prepared.push({ fontHandle: handle, fontRaster, fontSlot: slot });
      }
      const finish = (): TextGeneration => {
        controller.signal.throwIfAborted();
        const generation = this.#stageGeneration({
          state,
          resolved,
          paragraph: builtParagraph,
          createdParagraph: ownsParagraph,
          layout,
          paintPlan,
          paint,
          prepared,
          controller,
        });
        handedOff = true;
        return generation;
      };
      if (preparations.length === 0) return finish();
      return Promise.all(preparations)
        .then(finish)
        .catch((error: unknown) => {
          controller.abort(error);
          cleanup();
          throw error;
        });
    } catch (error) {
      controller.abort(error);
      cleanup();
      throw error;
    }
  }

  async #buildGeneration(state: TextState, controller: AbortController): Promise<TextGeneration> {
    const { signal } = controller;
    const reusableParagraph =
      this.#generation !== undefined && sameParagraphInput(this.#generation.state, state)
        ? this.#generation.paragraph
        : undefined;
    let paragraph = reusableParagraph;
    let ownsParagraph = false;
    try {
      let resolved: ResolvedParagraphInput;
      if (paragraph === undefined) {
        resolved = await resolveParagraphInput(state, signal);
        signal.throwIfAborted();
        const shaper = await textShaper(resolved.registry);
        signal.throwIfAborted();
        paragraph = createParagraphEngine({ shaper }).create({
          text: state.text,
          font: resolved.root.font.handle,
          spans: resolved.spans,
          style: paragraphStyle(state),
        });
        ownsParagraph = true;
      } else {
        resolved = await resolveParagraphInput(state, signal);
        signal.throwIfAborted();
      }

      const layout = paragraph.layout(paragraphConstraints(state));
      const paintPlan = createGlyphPaintPlan(layout, state);
      const paint = resolveGlyphPaint(state, paintPlan);
      const prepared: PreparedFontRaster[] = [];
      for (let slot = 0; slot < layout.fontHandles.length; slot += 1) {
        const handle = layout.fontHandles[slot] as FontHandle | undefined;
        if (handle === undefined) throw new Error('paragraph layout has an incomplete font table');
        const fontRaster = resolved.fontsByHandle.get(handle);
        if (fontRaster === undefined) {
          throw new Error('paragraph layout references an unresolved font');
        }
        fontRaster.raster.module.validatePaint?.(paint);
        await fontRaster.raster.module.prepare(layout, fontRaster.raster.resource, slot, signal);
        signal.throwIfAborted();
        prepared.push({ fontHandle: handle, fontRaster, fontSlot: slot });
      }
      return this.#stageGeneration({
        state,
        resolved,
        paragraph,
        createdParagraph: ownsParagraph,
        layout,
        paintPlan,
        paint,
        prepared,
        controller,
      });
    } catch (error) {
      if (ownsParagraph) paragraph?.dispose();
      throw error;
    }
  }

  #stageGeneration(input: {
    readonly state: TextState;
    readonly resolved: ResolvedParagraphInput;
    readonly paragraph: Paragraph;
    readonly createdParagraph: boolean;
    readonly layout: ParagraphLayout;
    readonly paintPlan: GlyphPaintPlan;
    readonly paint: GlyphPaint;
    readonly prepared: readonly PreparedFontRaster[];
    readonly controller: AbortController;
  }): TextGeneration {
    const { state, resolved, paragraph, createdParagraph, layout, paintPlan, paint, prepared, controller } = input;
    const batches: OwnedBatch[] = [];
    const batchStages: StagedBatch[] = [];
    try {
      for (const { fontHandle, fontRaster, fontSlot } of prepared) {
        const previous = this.#generation?.batches.find(
          (owned) => owned.fontHandle === fontHandle && owned.module === fontRaster.raster.module,
        );
        const stage = fontRaster.raster.module.stageBatch(
          previous?.batch,
          layout,
          fontRaster.raster.resource,
          fontSlot,
          paint,
          state.rasterPixelRatio,
        );
        try {
          assertRasterBatchStage(stage);
        } catch (error) {
          try {
            stage.abort();
          } catch {
            // The untrusted module returned no usable cleanup surface.
          }
          throw error;
        }
        batchStages.push({ stage, previous: previous?.batch });
        batches.push({
          module: fontRaster.raster.module,
          raster: fontRaster.raster,
          batch: stage.batch,
          fontHandle,
          fontSlot,
        });
      }
      const fontHandles = new Set(resolved.fontsByHandle.keys());
      let generation: TextGeneration;
      const releaseFontDisposal = resolved.registry._onFontDispose((font) => {
        if (!fontHandles.has(font.handle)) return;
        const reason = new DOMException('A font used by this text was disposed', 'AbortError');
        controller.abort(reason);
        if (this.#publication?.generation === generation) this.#cancelPublication(reason);
        else if (this.#generation === generation) this.#invalidateGeneration(generation, reason);
      });
      generation = {
        state,
        paragraph,
        createdParagraph,
        layout,
        paintPlan,
        batches,
        batchStages,
        releaseFontDisposal,
      };
      return generation;
    } catch (error) {
      for (const staged of batchStages) abortStagedBatch(staged);
      throw error;
    }
  }

  #disposeGeneration(generation: TextGeneration | undefined): void {
    if (generation === undefined) return;
    generation.releaseFontDisposal();
    for (const owned of generation.batches) {
      this.remove(owned.batch.object);
      owned.batch.dispose();
    }
    generation.paragraph.dispose();
  }

  #disposeUncommitted(generation: TextGeneration): void {
    generation.releaseFontDisposal();
    for (const staged of generation.batchStages) abortStagedBatch(staged);
    if (generation.createdParagraph) generation.paragraph.dispose();
  }

  #commitGeneration(generation: TextGeneration): void {
    try {
      for (const { stage } of generation.batchStages) stage.commit();
    } catch (error) {
      this.#disposeUncommitted(generation);
      throw error;
    }
    generation.batchStages.length = 0;
    generation.state = this.#state;
    const previous = this.#generation;
    this.#generation = generation;
    previous?.releaseFontDisposal();
    for (const owned of previous?.batches ?? []) {
      if (generation.batches.some(({ batch }) => batch === owned.batch)) continue;
      this.remove(owned.batch.object);
      owned.batch.dispose();
    }
    if (previous !== undefined && previous.paragraph !== generation.paragraph) previous.paragraph.dispose();
    for (const owned of generation.batches) {
      owned.batch.setRenderOrderBase(this.renderOrder);
      if (owned.batch.object.parent !== this) this.add(owned.batch.object);
    }
    this.#renderOrderBase = this.renderOrder;
    if (previous?.layout !== generation.layout) this.#state.onLayout?.(generation.layout);
  }

  #syncRenderOrderBase(): void {
    if (this.#renderOrderBase === this.renderOrder) return;
    for (const owned of this.#generation?.batches ?? []) owned.batch.setRenderOrderBase(this.renderOrder);
    this.#renderOrderBase = this.renderOrder;
  }

  #publishPending(): void {
    const publication = this.#publication;
    if (publication === undefined) return;
    this.#publication = undefined;
    try {
      this.#commitGeneration(publication.generation);
      publication.resolve();
    } catch (error) {
      publication.reject(error);
    }
  }

  #cancelPublication(reason: unknown): void {
    const publication = this.#publication;
    if (publication === undefined) return;
    this.#publication = undefined;
    this.#disposeUncommitted(publication.generation);
    publication.reject(reason);
  }

  #invalidateGeneration(generation: TextGeneration, reason: unknown): void {
    if (this.#generation !== generation) return;
    this.#invalidatedState = generation.state;
    this.#revision += 1;
    this.#pending?.abort(reason);
    this.#pending = undefined;
    this.#disposeGeneration(generation);
    this.#generation = undefined;
    if (this.#publication !== undefined) {
      this.#invalidatedState = undefined;
      return;
    }
    this.#setCancelledReady(reason);
  }

  #setCancelledReady(reason: unknown): void {
    const ready = Promise.reject(reason);
    void ready.catch(() => undefined);
    this.#ready = ready;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text object is disposed');
  }
}

function abortStagedBatch({ stage, previous }: StagedBatch): void {
  try {
    stage.abort();
  } catch {
    // Continue releasing the remaining transaction after a plugin contract violation.
  }
  if (stage.batch === previous) return;
  try {
    stage.batch.dispose();
  } catch {
    // Cleanup remains best-effort at an untrusted renderer boundary.
  }
}

async function resolveParagraphInput(state: TextState, signal: AbortSignal): Promise<ResolvedParagraphInput> {
  const rootSource = state.font;
  if (rootSource === undefined) throw new Error('text has no font');
  const registry = isRegisteredFont(rootSource) ? textRegistry(rootSource) : textRegistry();
  const root = await resolveFontRaster(rootSource, state.raster, registry, signal);
  const rootRegistry = textRegistry(root.font);
  const fontsByHandle = new Map<FontHandle, ResolvedFontRaster>([[root.font.handle, root]]);
  const spans = [] as import('./paragraph.js').ParagraphSpan[];
  for (const span of state.spans) {
    let font = root;
    if (span.font !== undefined) {
      font = await resolveFontRaster(span.font, root.request, rootRegistry, signal);
      const existing = fontsByHandle.get(font.font.handle);
      if (
        existing !== undefined &&
        (existing.raster.module !== font.raster.module ||
          existing.raster.artifact.rasterKey !== font.raster.artifact.rasterKey)
      ) {
        throw new TypeError('one font cannot select multiple raster definitions in one paragraph');
      }
      fontsByHandle.set(font.font.handle, font);
    }
    spans.push({
      start: span.start,
      end: span.end,
      font: font.font.handle,
      ...(span.fontSize === undefined ? {} : { fontSize: span.fontSize }),
      ...(span.lineHeight === undefined ? {} : { lineHeight: span.lineHeight }),
      ...(span.letterSpacing === undefined ? {} : { letterSpacing: span.letterSpacing }),
      ...(span.language === undefined ? {} : { language: span.language }),
      ...(span.direction === undefined ? {} : { direction: span.direction }),
      ...(span.features === undefined ? {} : { features: span.features }),
    });
  }
  return { registry: rootRegistry, root, fontsByHandle, spans };
}

function resolveParagraphInputSync(state: TextState): ResolvedParagraphInput | undefined {
  const rootSource = state.font;
  if (rootSource === undefined) throw new Error('text has no font');
  const registry = isRegisteredFont(rootSource) ? textRegistry(rootSource) : textRegistry();
  const root = resolveFontRasterSync(rootSource, state.raster, registry);
  if (root === undefined) return undefined;
  const rootRegistry = textRegistry(root.font);
  const fontsByHandle = new Map<FontHandle, ResolvedFontRaster>([[root.font.handle, root]]);
  const spans = [] as import('./paragraph.js').ParagraphSpan[];
  for (const span of state.spans) {
    let font = root;
    if (span.font !== undefined) {
      const resolvedFont = resolveFontRasterSync(span.font, root.request, rootRegistry);
      if (resolvedFont === undefined) return undefined;
      font = resolvedFont;
      const existing = fontsByHandle.get(font.font.handle);
      if (
        existing !== undefined &&
        (existing.raster.module !== font.raster.module ||
          existing.raster.artifact.rasterKey !== font.raster.artifact.rasterKey)
      ) {
        throw new TypeError('one font cannot select multiple raster definitions in one paragraph');
      }
      fontsByHandle.set(font.font.handle, font);
    }
    spans.push({
      start: span.start,
      end: span.end,
      font: font.font.handle,
      ...(span.fontSize === undefined ? {} : { fontSize: span.fontSize }),
      ...(span.lineHeight === undefined ? {} : { lineHeight: span.lineHeight }),
      ...(span.letterSpacing === undefined ? {} : { letterSpacing: span.letterSpacing }),
      ...(span.language === undefined ? {} : { language: span.language }),
      ...(span.direction === undefined ? {} : { direction: span.direction }),
      ...(span.features === undefined ? {} : { features: span.features }),
    });
  }
  return { registry: rootRegistry, root, fontsByHandle, spans };
}

async function resolveFontRaster(
  source: AnyFontToken | FontInput | RegisteredFont,
  inheritedRaster: AnyRasterInput | NormalizedRasterRequest | undefined,
  registry: FontRegistry,
  signal: AbortSignal,
): Promise<ResolvedFontRaster> {
  let font: RegisteredFont;
  let request: NormalizedRasterRequest;
  if (isFontToken(source)) {
    font = await loadTextFont(source.input, registry, signal);
    request = normalizeRasterInput(source.raster);
  } else {
    font = isRegisteredFont(source) ? source : await loadTextFont(source, registry, signal);
    if (inheritedRaster === undefined) throw new TypeError('raw fonts require a raster definition');
    request = isNormalizedRasterRequest(inheritedRaster) ? inheritedRaster : normalizeRasterInput(inheritedRaster);
  }
  if (textRegistry(font) !== registry) {
    throw new TypeError('all fonts in one Text object must belong to the same registry');
  }
  const raster = await sharedRasterRuntime.load(font, { module: request.module, options: request.options }, { signal });
  return { font, request, raster };
}

function resolveFontRasterSync(
  source: AnyFontToken | FontInput | RegisteredFont,
  inheritedRaster: AnyRasterInput | NormalizedRasterRequest | undefined,
  registry: FontRegistry,
): ResolvedFontRaster | undefined {
  const font = isRegisteredFont(source)
    ? source
    : loadedTextFont(isFontToken(source) ? source.input : source, registry);
  if (font === undefined) return undefined;
  let request: NormalizedRasterRequest;
  if (isFontToken(source)) {
    request = normalizeRasterInput(source.raster);
  } else {
    if (inheritedRaster === undefined) throw new TypeError('raw fonts require a raster definition');
    request = isNormalizedRasterRequest(inheritedRaster) ? inheritedRaster : normalizeRasterInput(inheritedRaster);
  }
  if (textRegistry(font) !== registry) {
    throw new TypeError('all fonts in one Text object must belong to the same registry');
  }
  const raster = sharedRasterRuntime._peek(font, { module: request.module, options: request.options });
  if (raster === undefined) return undefined;
  return { font, request, raster };
}

function paragraphStyle(state: TextState) {
  return {
    ...(state.fontSize === undefined ? {} : { fontSize: state.fontSize }),
    ...(state.lineHeight === undefined ? {} : { lineHeight: state.lineHeight }),
    ...(state.letterSpacing === undefined ? {} : { letterSpacing: state.letterSpacing }),
    ...(state.language === undefined ? {} : { language: state.language }),
    ...(state.direction === undefined ? {} : { direction: state.direction }),
    ...(state.features.length === 0 ? {} : { features: state.features }),
  };
}

function paragraphConstraints(state: TextState): ParagraphConstraints {
  return {
    width: state.width === undefined ? { mode: 'unconstrained' } : { mode: 'exactly', size: state.width },
    height: state.height === undefined ? { mode: 'unconstrained' } : { mode: 'exactly', size: state.height },
    ...(state.maxLines === undefined ? {} : { maxLines: state.maxLines }),
    ...(state.wrap === undefined ? {} : { wrap: state.wrap }),
    ...(state.overflow === undefined ? {} : { overflow: state.overflow }),
    ...(state.textAlign === undefined ? {} : { align: state.textAlign }),
  };
}

function createGlyphPaintPlan(layout: ParagraphLayout, state: TextState): GlyphPaintPlan {
  const paintByCodeUnit = new Uint16Array(state.text.length + 1);
  if (state.spans.length > 0xffff) throw new RangeError('text paint palette exceeds uint16 capacity');
  for (let spanIndex = 0; spanIndex < state.spans.length; spanIndex += 1) {
    const span = state.spans[spanIndex]!;
    const paintIndex = spanIndex + 1;
    paintByCodeUnit.fill(paintIndex, span.start, span.end);
  }
  const paintIndices = new Uint16Array(layout.glyphIds.length);
  for (let glyph = 0; glyph < layout.glyphIds.length; glyph += 1) {
    const cluster = layout.clusters[glyph];
    if (cluster === undefined) throw new Error('paragraph layout has an incomplete cluster array');
    const paintIndex = paintByCodeUnit[cluster];
    if (paintIndex === undefined) throw new Error('paragraph layout cluster exceeds its source text');
    paintIndices[glyph] = paintIndex;
  }
  return { paintIndices, spanCount: state.spans.length };
}

function resolveGlyphPaint(state: TextState, plan: GlyphPaintPlan): GlyphPaint {
  if (state.spans.length !== plan.spanCount) {
    throw new Error('glyph paint plan does not match the normalized text spans');
  }
  const palette = new Array<ResolvedPaint>(state.spans.length + 1);
  palette[0] = resolvedPaint(state, undefined);
  for (let spanIndex = 0; spanIndex < state.spans.length; spanIndex += 1) {
    palette[spanIndex + 1] = resolvedPaint(state, state.spans[spanIndex]!);
  }
  return { paintIndices: plan.paintIndices, palette };
}

function resolvedPaint(state: TextState, span: TextSpan | undefined): ResolvedPaint {
  const opacity = span?.opacity ?? state.opacity ?? 1;
  const outline = span?.outline ?? state.outline;
  const shadow = span?.shadow ?? state.shadow;
  return {
    color: color(span?.color ?? state.color ?? 0xffffff, opacity),
    ...(outline === undefined ? {} : { outline: { color: color(outline.color, opacity), width: outline.width } }),
    ...(shadow === undefined ? {} : { shadow: { color: color(shadow.color, opacity), offset: shadow.offset } }),
  };
}

const paintColorScratch = new THREE.Color();

function color(value: THREE.ColorRepresentation, alpha: number): LinearRgba {
  paintColorScratch.set(value);
  return [paintColorScratch.r, paintColorScratch.g, paintColorScratch.b, alpha];
}
