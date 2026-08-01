import * as THREE from 'three/webgpu';
import type { AnyFontToken, FontInput, RegisteredFont } from './font.js';
import type { FontHandle, FontSlot } from './identity.js';
import type { ParagraphLayout } from './layout.js';
import type { GlyphPaint, LinearRgba, ResolvedPaint } from './paint.js';
import { createParagraphEngine, type Paragraph, type ParagraphConstraints } from './paragraph.js';
import type { AnyRasterInput, AnyRasterModule, LoadedRaster, RasterBatchUpdate, RasterDrawBatch } from './raster.js';
import {
  assertRasterBatch,
  EMPTY_TEXT_STATE,
  isFontToken,
  isNormalizedRasterRequest,
  normalizeRasterInput,
  normalizeTextState,
  sameLayoutInput,
  samePaintInput,
  sameParagraphInput,
  sameTextInput,
  type NormalizedRasterRequest,
  type TextState,
} from './internal/text-properties.js';
import {
  isRegisteredFont,
  loadTextFont,
  sharedRasterRuntime,
  textRegistry,
  textShaper,
} from './internal/text-runtime.js';
import type { FontRegistry } from './loader.js';

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
  readonly batch: RasterDrawBatch;
  readonly fontHandle: FontHandle;
  readonly fontSlot: FontSlot;
  readonly ownership: 'fresh' | 'retained';
}

interface TextGeneration {
  state: TextState;
  readonly paragraph: Paragraph;
  /** True only when this uncommitted generation acquired the paragraph it carries. */
  readonly createdParagraph: boolean;
  readonly layout: ParagraphLayout;
  readonly paintPlan: GlyphPaintPlan;
  readonly batches: readonly OwnedBatch[];
  readonly batchUpdates: RasterBatchUpdate[];
  readonly releaseFontDisposal: () => void;
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

/** Framework-neutral Three.js text object with transactional async generations. */
export class Text extends THREE.Group {
  #state: TextState;
  #generation: TextGeneration | undefined;
  #pending: AbortController | undefined;
  #invalidatedState: TextState | undefined;
  #revision = 0;
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
    this.#state = next;
    this.#schedule(prevalidatedPaint);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revision += 1;
    const reason = new DOMException('The text object was disposed', 'AbortError');
    this.#pending?.abort(reason);
    this.#pending = undefined;
    this.#disposeGeneration(this.#generation);
    this.#generation = undefined;
    this.#invalidatedState = undefined;
    this.#setCancelledReady(reason);
  }

  #schedule(prevalidatedPaint?: GlyphPaint): void {
    this.#invalidatedState = undefined;
    this.#revision += 1;
    const revision = this.#revision;
    this.#pending?.abort();
    this.#pending = undefined;

    if (this.#state.font === undefined) {
      this.#disposeGeneration(this.#generation);
      this.#generation = undefined;
      this.#ready = Promise.resolve();
      return;
    }

    if (this.#generation !== undefined && sameLayoutInput(this.#generation.state, this.#state)) {
      if (!samePaintInput(this.#generation.state, this.#state)) {
        const paint = prevalidatedPaint ?? resolveGlyphPaint(this.#state, this.#generation.paintPlan);
        for (const owned of this.#generation.batches) {
          owned.module.updatePaint(owned.batch, paint, owned.fontSlot);
        }
      }
      this.#generation.state = this.#state;
      this.#ready = Promise.resolve();
      return;
    }

    const controller = new AbortController();
    this.#pending = controller;
    const state = this.#state;
    const ready = this.#buildGeneration(state, controller).then((generation) => {
      if (this.#disposed || revision !== this.#revision || controller.signal.aborted) {
        this.#disposeUncommitted(generation);
        controller.signal.throwIfAborted();
        return;
      }
      this.#pending = undefined;
      const previous = this.#generation;
      for (const update of generation.batchUpdates) update.commit();
      generation.batchUpdates.length = 0;
      generation.state = this.#state;
      this.#generation = generation;
      previous?.releaseFontDisposal();
      for (const owned of previous?.batches ?? []) {
        if (generation.batches.some(({ batch }) => batch === owned.batch)) continue;
        this.remove(owned.batch.object);
        owned.batch.dispose();
      }
      if (previous !== undefined && previous.paragraph !== generation.paragraph) {
        previous.paragraph.dispose();
      }
      for (const owned of generation.batches) {
        if (owned.batch.object.parent !== this) this.add(owned.batch.object);
      }
      this.#state.onLayout?.(generation.layout);
    });
    // `ready` remains an observation channel that rejects on failure or cancellation. The
    // internal branch prevents an abandoned generation from becoming an unhandled rejection.
    void ready.catch(() => {
      if (this.#pending === controller) this.#pending = undefined;
    });
    this.#ready = ready;
  }

  async #buildGeneration(state: TextState, controller: AbortController): Promise<TextGeneration> {
    const { signal } = controller;
    const reusableParagraph =
      this.#generation !== undefined && sameParagraphInput(this.#generation.state, state)
        ? this.#generation.paragraph
        : undefined;
    let paragraph = reusableParagraph;
    let ownsParagraph = false;
    const batches: OwnedBatch[] = [];
    const batchUpdates: RasterBatchUpdate[] = [];
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
      const prepared: Array<{
        readonly fontHandle: FontHandle;
        readonly fontRaster: ResolvedFontRaster;
        readonly fontSlot: FontSlot;
      }> = [];
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
      let retainAll = this.#generation !== undefined && this.#generation.batches.length === prepared.length;
      if (retainAll) {
        for (const { fontHandle, fontRaster, fontSlot } of prepared) {
          const previous = this.#generation?.batches.find(
            (owned) => owned.fontHandle === fontHandle && owned.module === fontRaster.raster.module,
          );
          const update =
            previous?.module.stageBatchUpdate?.(
              previous.batch,
              layout,
              fontRaster.raster.resource,
              fontSlot,
              paint,
              state.rasterPixelRatio,
            ) ?? undefined;
          if (previous === undefined || update === undefined) {
            retainAll = false;
            break;
          }
          batchUpdates.push(update);
          batches.push({ ...previous, fontSlot, ownership: 'retained' });
        }
      }
      if (!retainAll) {
        for (const update of batchUpdates) update.dispose();
        batchUpdates.length = 0;
        batches.length = 0;
        for (const { fontHandle, fontRaster, fontSlot } of prepared) {
          const batch = fontRaster.raster.module.buildBatches(
            layout,
            fontRaster.raster.resource,
            fontSlot,
            paint,
            state.rasterPixelRatio,
          );
          assertRasterBatch(batch);
          batches.push({ module: fontRaster.raster.module, batch, fontHandle, fontSlot, ownership: 'fresh' });
        }
      }
      const fontHandles = new Set(resolved.fontsByHandle.keys());
      let generation: TextGeneration;
      const releaseFontDisposal = resolved.registry._onFontDispose((font) => {
        if (!fontHandles.has(font.handle)) return;
        const reason = new DOMException('A font used by this text was disposed', 'AbortError');
        controller.abort(reason);
        if (this.#generation === generation) this.#invalidateGeneration(generation, reason);
      });
      generation = {
        state,
        paragraph,
        createdParagraph: ownsParagraph,
        layout,
        paintPlan,
        batches,
        batchUpdates,
        releaseFontDisposal,
      };
      return generation;
    } catch (error) {
      for (const update of batchUpdates) update.dispose();
      for (const owned of batches) {
        if (owned.ownership === 'fresh') owned.batch.dispose();
      }
      if (ownsParagraph) paragraph?.dispose();
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
    for (const update of generation.batchUpdates) update.dispose();
    for (const owned of generation.batches) {
      if (owned.ownership === 'fresh') owned.batch.dispose();
    }
    if (generation.createdParagraph) generation.paragraph.dispose();
  }

  #invalidateGeneration(generation: TextGeneration, reason: unknown): void {
    if (this.#generation !== generation) return;
    this.#invalidatedState = generation.state;
    this.#revision += 1;
    this.#pending?.abort(reason);
    this.#pending = undefined;
    this.#disposeGeneration(generation);
    this.#generation = undefined;
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
