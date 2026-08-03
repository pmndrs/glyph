import {
  FontRegistry,
  Text,
  type FontFeature,
  type JsonValue,
  type ParagraphLayout,
  type RegisteredFont,
} from '@pmndrs/text';
import {
  bitmap,
  bitmapRasterKey,
  captureBitmapGlyphPositions,
  createBitmapGlyphPositionTransition,
  selectBitmapStrikePpem,
  type BitmapGlyphPositionSnapshot,
  type BitmapGlyphPositionTransition,
  type BitmapResource,
} from '@pmndrs/text/raster/bitmap';
import * as THREE from 'three/webgpu';

import amiriBitmapFontUrl from '../../fixtures/rendering/amiri-bitmap-16.font.glb?url';
import amiriBitmapDensityFontUrl from '../../fixtures/rendering/amiri-bitmap-16-32.font.glb?url';
import dotGothicBitmapFontUrl from '../../fixtures/rendering/dot-gothic-16-bitmap-16.font.glb?url';
import dotGothicBitmapDensityFontUrl from '../../fixtures/rendering/dot-gothic-16-bitmap-16-32.font.glb?url';
import dancingScriptBitmapFontUrl from '../../fixtures/rendering/dancing-script-bitmap-16.font.glb?url';
import dancingScriptBitmapDensityFontUrl from '../../fixtures/rendering/dancing-script-bitmap-16-32.font.glb?url';
import fontAwesomeBitmapFontUrl from '../../fixtures/rendering/font-awesome-free-6.7.2-bitmap-16.font.glb?url';
import fontAwesomeBitmapDensityFontUrl from '../../fixtures/rendering/font-awesome-free-6.7.2-bitmap-16-32.font.glb?url';
import bitmapFontUrl from '../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import bitmapDensityFontUrl from '../../fixtures/rendering/inter-bitmap-16-32.font.glb?url';
import devanagariBitmapFontUrl from '../../fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb?url';
import devanagariBitmapDensityFontUrl from '../../fixtures/rendering/noto-sans-devanagari-bitmap-16-32.font.glb?url';
import notoCjkShowcaseBitmapFontUrl from '../../fixtures/rendering/noto-sans-cjk-showcase-bitmap-16.font.glb?url';
import notoCjkShowcaseBitmapDensityFontUrl from '../../fixtures/rendering/noto-sans-cjk-showcase-bitmap-16-32.font.glb?url';
import sourceSerifBitmapFontUrl from '../../fixtures/rendering/source-serif-4-bitmap-16.font.glb?url';
import sourceSerifBitmapDensityFontUrl from '../../fixtures/rendering/source-serif-4-bitmap-16-32.font.glb?url';
import { conformanceText, type BenchmarkFontFixture, type SelectableFontFixture } from '../benchmark/font-fixtures';
import type { FontDelivery } from '../benchmark/url-state';
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts';
import { compactRgba8Readback } from './tsl-baseline';
import { createCanvasSurface } from './canvas-surface';
import { finiteCanvasDelta } from './canvas-view';
import { createGpuFrameTimer, type GpuFrameTimer } from './gpu-frame-timer';
import { createLiveFrameTelemetry, type LiveFrameHistoryCursor } from './live-frame-telemetry';
import { createTextUpdateTelemetry, type TextUpdateTimingSummary } from './text-update-telemetry';
import {
  createRetainedFontFixtureController,
  type LiveFontFixtureUpdate,
  type RetainedFontFixtureController,
} from './retained-font-fixture';
import {
  benchmarkContentWidth,
  LIVE_TEXT_COLOR,
  LIVE_TEXT_LINE_HEIGHT,
  liveTextPosition,
  type LiveTextAnchor,
} from '../workloads/shared/text-style';
import { captureSourceOutlineFidelity, type SourceOutlineFidelityCapture } from './source-outline-reference';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from './webgpu-renderer';
import {
  type PersistentRenderFrameContext,
  type PersistentRenderScene,
  type PersistentRenderSceneContext,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from './persistent-render-host';
import { createPersistentSceneActivation } from './persistent-scene-activation';
import { withRendererStateRestored } from './renderer-state-transaction';
import {
  createFontDeliveryMetrics,
  loadRuntimeFont,
  measuredBitmapRaster,
  type FontDeliveryMetrics,
} from './font-delivery';

const WIDTH = 384;
const HEIGHT = 128;
const CLIPPED_WIDTH = 192;
const CLIPPED_HEIGHT = 64;
const BITMAP_FONT_SIZE = 16;
const CONFORMANCE_BITMAP_STRIKES = [16] as const;
const LIVE_BITMAP_STRIKES = [16, 32] as const;
const bitmapRequest = bitmap({ strikes: CONFORMANCE_BITMAP_STRIKES });
const liveBitmapRequest = bitmap({ strikes: LIVE_BITMAP_STRIKES });
export type BitmapFixtureDensity = 'conformance' | 'live';
const bitmapFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: bitmapFontUrl,
  amiri: amiriBitmapFontUrl,
  'noto-sans-devanagari': devanagariBitmapFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseBitmapFontUrl,
  'dot-gothic-16': dotGothicBitmapFontUrl,
  'font-awesome-free-6.7.2': fontAwesomeBitmapFontUrl,
  'source-serif-4': sourceSerifBitmapFontUrl,
  'dancing-script': dancingScriptBitmapFontUrl,
};
const bitmapDensityFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: bitmapDensityFontUrl,
  amiri: amiriBitmapDensityFontUrl,
  'noto-sans-devanagari': devanagariBitmapDensityFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseBitmapDensityFontUrl,
  'dot-gothic-16': dotGothicBitmapDensityFontUrl,
  'font-awesome-free-6.7.2': fontAwesomeBitmapDensityFontUrl,
  'source-serif-4': sourceSerifBitmapDensityFontUrl,
  'dancing-script': dancingScriptBitmapDensityFontUrl,
};

export async function preloadBitmapFontAssets(
  fixtures: readonly BenchmarkFontFixture[],
  signal?: AbortSignal,
): Promise<void> {
  await preloadFontUrls(
    fixtures.map((fixture) => bitmapDensityFontUrls[fixture]),
    signal,
  );
}

interface BitmapTextResources {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly ownedRenderer?: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly font: RegisteredFont;
  readonly line: BitmapLine;
  readonly reference: BitmapReferenceResource;
  readonly referencePixels: Uint8Array;
  readonly atlasGpuBytes: number;
  readonly firstDrawMs: number;
  readonly fontFixture: BenchmarkFontFixture;
}

interface BitmapReferencePage {
  readonly width: number;
  readonly height: number;
  readonly texels: Uint8Array;
}

interface BitmapReferenceStrike {
  readonly ppem: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly BitmapReferencePage[];
}

interface BitmapReferenceResource {
  readonly strikes: readonly BitmapReferenceStrike[];
}

interface BitmapLine {
  readonly object: Text;
  readonly layout: ParagraphLayout;
  readonly height: number;
  readonly width: number;
  readonly cssFontSize: number;
  readonly glyphCount: number;
  readonly missingGlyphCount: number;
  readonly drawCount: number;
  readonly strikePpem: number;
  readonly scheduleMs: number;
  readonly readyMs: number;
}

export interface BitmapTextLiveStats {
  readonly technique: 'bitmap';
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly showGrid: boolean;
  readonly frameCount: number;
  readonly framesPerSecond: number;
  readonly refreshRateHz: number;
  readonly frameBudgetMs: number;
  readonly medianSubmitMs: number;
  readonly p95SubmitMs: number;
  readonly minimumSubmitMs: number;
  readonly maximumSubmitMs: number;
  readonly minimumFramesPerSecond: number;
  readonly maximumFramesPerSecond: number;
  readonly glyphCount: number;
  readonly missingGlyphCount: number;
  readonly drawCount: number;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly lineCount: number;
  readonly strikePpem: number;
  readonly cssFontSize: number;
  readonly renderedPpem: number;
  readonly scaleRatio: number;
  readonly atlasGpuBytes: number;
  readonly atlasPages: readonly BitmapAtlasPageStats[];
  readonly framebufferGpuBytes: number;
  readonly totalGpuBytes: number;
  readonly artifactBytes: number;
  readonly delivery: FontDelivery;
  readonly sourceFontBytes: number;
  readonly coreArtifactBytes: number;
  readonly coreBakeMs: number;
  readonly rasterArtifactBytes: number;
  readonly rasterBakeMs: number;
  readonly rendererInitMs: number;
  readonly fontLoadMs: number;
  readonly textReadyMs: number;
  readonly firstDrawMs: number;
  readonly uploadFrameGpuMs?: number;
  readonly uploadFrameCompleteMs?: number;
  readonly startupMs: number;
  readonly gpuTimingSupported: boolean;
  readonly gpuFrameMs: number | undefined;
  readonly medianGpuMs: number | undefined;
  readonly p95GpuMs: number | undefined;
  readonly minimumGpuMs: number | undefined;
  readonly maximumGpuMs: number | undefined;
  readonly textUpdateTimings: TextUpdateTimingSummary;
  readonly frameTimestampHistory: Float64Array;
  readonly submitHistory: Float32Array;
  readonly submitHistoryLength: number;
  readonly submitHistoryNextIndex: number;
  readonly submitHistoryCursor: LiveFrameHistoryCursor;
  readonly fpsHistory: Float32Array;
  readonly fpsHistoryLength: number;
  readonly fpsHistoryNextIndex: number;
  readonly fpsHistoryCursor: LiveFrameHistoryCursor;
  readonly gpuHistory: Float32Array;
  readonly gpuHistoryLength: number;
  readonly gpuHistoryNextIndex: number;
  readonly gpuHistoryCursor: LiveFrameHistoryCursor;
}

export interface BitmapAtlasPageStats {
  readonly strikePpem: number;
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly gpuBytes: number;
}

export interface BitmapTextConformanceCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly mismatchBytes: number;
  readonly litPixels: number;
  readonly inkPixels: number;
  readonly renderSubmitMs: number;
}

export interface BitmapTextPreview {
  resize(width: number, height: number): void;
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(options: BitmapTextPreviewUpdate): Promise<BitmapTextPreviewSnapshot>;
  setPresentationProgress(revision: number, progress: number): BitmapTextPreviewSnapshot;
  finishPresentation(revision: number): BitmapTextPreviewSnapshot;
  dispose(): Promise<void>;
}

export interface BitmapTextPreviewUpdate extends LiveFontFixtureUpdate {
  readonly anchor: LiveTextAnchor;
  readonly fontSize: number;
  readonly layoutWidthRatio: number;
  readonly text: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
  readonly textAlign: 'start' | 'center';
  readonly expectedGlyphCount?: number | undefined;
}

export interface BitmapTextPreviewSnapshot {
  readonly revision: number;
  readonly presentationProgress: number;
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
  readonly glyphCount: number;
  readonly lineCount: number;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
}

type BitmapTextPresentation =
  | {
      readonly kind: 'transitioning';
      readonly revision: number;
      readonly controllers: readonly BitmapGlyphPositionTransition[];
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
      readonly matchedGlyphs: number;
      readonly targetGlyphs: number;
      progress: number;
    }
  | {
      readonly kind: 'settled';
      readonly revision: number;
      readonly matchedGlyphs: number;
      readonly targetGlyphs: number;
    };

export interface BitmapTextPreviewOptions {
  readonly anchor?: LiveTextAnchor;
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly fontSize: number;
  readonly height: number;
  readonly showGrid: boolean;
  readonly layoutWidth: number;
  readonly layoutWidthRatio?: number;
  readonly expectedGlyphCount?: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly delivery?: FontDelivery;
  readonly language?: string;
  readonly direction?: 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
  readonly text: string;
  readonly textAlign?: 'start' | 'center';
  readonly width: number;
  readonly signal?: AbortSignal;
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: BitmapTextLiveStats) => void;
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener;
}

export type BitmapTextPersistentSceneOptions = Omit<
  BitmapTextPreviewOptions,
  'canvas' | 'dpr' | 'height' | 'signal' | 'width'
> & {
  readonly id?: string;
};

export interface BitmapTextPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(options: BitmapTextPreviewUpdate): Promise<BitmapTextPreviewSnapshot>;
  setPresentationProgress(revision: number, progress: number): BitmapTextPreviewSnapshot;
  finishPresentation(revision: number): BitmapTextPreviewSnapshot;
}

type BitmapTextState = { readonly kind: 'empty' } | { readonly kind: 'ready'; readonly resources: BitmapTextResources };

export function createBitmapTextTarget(backend: RendererBackend): BenchmarkTarget {
  let state: BitmapTextState = { kind: 'empty' };
  let fontFixture: BenchmarkFontFixture = 'inter';
  return {
    id: `bitmap-text-${backend}`,
    label: backend === 'webgpu' ? 'Bitmap text · WebGPU' : 'Bitmap text · WebGL',
    detail: 'Selected font GLB · HarfRust layout · R8 KTX2 · instanced TSL',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    configure: (input) => {
      fontFixture = input.fontFixture ?? 'inter';
    },
    status: () => 'ready',
    load: async (controls, context) => {
      if (state.kind === 'ready') return;
      state = {
        kind: 'ready',
        resources: await createResources(
          backend,
          controls.dpr,
          fontFixture,
          'baked',
          context?.signal,
          context?.renderer,
        ),
      };
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (state.kind !== 'ready') throw new Error('bitmap text target was not loaded');
      return renderBitmapText(state.resources);
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const resources = state.resources;
      state = { kind: 'empty' };
      await disposeBitmapTextResources(resources);
    },
  };
}

async function createResources(
  backend: RendererBackend,
  dpr: number,
  fontFixture: BenchmarkFontFixture = 'inter',
  delivery: FontDelivery = 'baked',
  signal?: AbortSignal,
  borrowedRenderer?: PersistentRenderSceneRenderer,
): Promise<BitmapTextResources> {
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          width: WIDTH,
          height: HEIGHT,
          backend,
          dpr,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  const rendererViewport = readRendererViewportState(renderer as THREE.WebGPURenderer);
  let target: THREE.RenderTarget | undefined;
  let font: RegisteredFont | undefined;
  let line: BitmapLine | undefined;
  try {
    const loadedFont = await loadBitmapFont(signal, fontFixture, delivery);
    font = loadedFont.font;
    line = await createBitmapLine(
      font,
      loadedFont.raster,
      conformanceText(),
      BITMAP_FONT_SIZE / dpr,
      rendererViewport.pixelRatio,
      signal,
    );
    line.object.position.set(
      quarterDevicePosition(Math.max(4, (WIDTH - line.width) / 2), dpr),
      quarterDevicePosition(-Math.max(4, (HEIGHT - line.height) / 2), dpr),
      0,
    );

    const scene = new THREE.Scene();
    scene.add(line.object);
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(Math.round(WIDTH * dpr), Math.round(HEIGHT * dpr), {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    const firstDrawTarget = target;
    const firstDrawMs = await withRendererStateRestored(renderer, () => {
      renderer.setRenderTarget(firstDrawTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      const firstDrawStarted = performance.now();
      renderer.render(scene, camera);
      return performance.now() - firstDrawStarted;
    });
    const { atlasGpuBytes, reference } = await loadBitmapReferenceSnapshot(font, signal);
    const referencePixels = composeBitmapReference(line, reference, dpr, WIDTH, HEIGHT);
    return {
      backend,
      dpr,
      renderer,
      ...(ownedRenderer === undefined ? {} : { ownedRenderer }),
      target,
      scene,
      camera,
      font,
      line,
      reference,
      referencePixels,
      atlasGpuBytes,
      firstDrawMs,
      fontFixture,
    };
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line);
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

export async function loadBitmapFont(
  signal?: AbortSignal,
  fixture: BenchmarkFontFixture = 'inter',
  delivery: FontDelivery = 'baked',
  density: BitmapFixtureDensity = 'conformance',
  onProgress?: import('@pmndrs/text').BakeProgressListener,
  registry = new FontRegistry(),
): Promise<{
  readonly artifactBytes: number;
  readonly font: RegisteredFont;
  readonly metrics: FontDeliveryMetrics;
  readonly raster: ReturnType<typeof bitmap>;
}> {
  signal?.throwIfAborted();
  const metrics = createFontDeliveryMetrics(delivery);
  const raster = density === 'live' ? liveBitmapRequest : bitmapRequest;
  if (delivery === 'runtime') {
    const loaded = await loadRuntimeFont(fixture, metrics, signal, onProgress, registry);
    return {
      artifactBytes: metrics.coreArtifactBytes,
      font: loaded.font,
      metrics,
      raster: measuredBitmapRaster(metrics, density, onProgress),
    };
  }
  let font: RegisteredFont | undefined;
  try {
    const fontResponse = await fetch(
      (density === 'live' ? bitmapDensityFontUrls : bitmapFontUrls)[fixture],
      signal === undefined ? undefined : { signal },
    );
    if (!fontResponse.ok) throw new Error(`Unable to load bitmap font fixture (${fontResponse.status})`);
    const fontBytes = await fontResponse.arrayBuffer();
    signal?.throwIfAborted();
    font = await registry.registerAsset(new Uint8Array(fontBytes));
    signal?.throwIfAborted();
    return { artifactBytes: fontBytes.byteLength, font, metrics, raster };
  } catch (error) {
    font?.dispose();
    throw error;
  }
}

async function preloadFontUrls(urls: readonly string[], signal?: AbortSignal): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url, signal === undefined ? undefined : { signal });
      if (!response.ok) throw new Error(`Unable to preload bitmap font fixture (${response.status})`);
      await response.arrayBuffer();
    }),
  );
}

async function createBitmapLine(
  font: RegisteredFont,
  raster: ReturnType<typeof bitmap>,
  text: string,
  fontSize: number,
  rasterPixelRatio: number,
  signal?: AbortSignal,
  layoutWidth?: number,
  shaping: {
    readonly language: string;
    readonly direction: 'ltr' | 'rtl';
    readonly features: readonly FontFeature[];
    readonly textAlign: 'start' | 'center';
    readonly rejectMissingGlyphs?: boolean;
  } = { language: 'en', direction: 'ltr', features: [], textAlign: 'start' },
): Promise<BitmapLine> {
  signal?.throwIfAborted();
  const startedAt = performance.now();
  const object = new Text({
    text,
    font,
    raster,
    fontSize,
    rasterPixelRatio,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    color: LIVE_TEXT_COLOR,
    language: shaping.language,
    direction: shaping.direction,
    features: shaping.features,
    textAlign: shaping.textAlign,
    ...(layoutWidth === undefined ? {} : { width: layoutWidth, wrap: 'word' as const, overflow: 'visible' as const }),
  });
  const scheduledAt = performance.now();
  try {
    await object.ready;
    const readyAt = performance.now();
    signal?.throwIfAborted();
    const layout = object.layout;
    if (layout === undefined) throw new Error('public Text did not commit a bitmap layout');
    const missingGlyphCount = layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
    if (shaping.rejectMissingGlyphs !== false && missingGlyphCount !== 0) {
      throw new Error(`benchmark specimen contains ${missingGlyphCount} missing glyphs`);
    }
    return {
      object,
      layout,
      height: layout.height,
      width: layout.width,
      cssFontSize: fontSize,
      glyphCount: countRenderedGlyphs(object),
      missingGlyphCount,
      drawCount: countDraws(object),
      strikePpem: selectBitmapStrikePpem(
        raster.options.strikes.map((ppem) => ({ ppem })),
        fontSize,
        rasterPixelRatio,
      ),
      scheduleMs: scheduledAt - startedAt,
      readyMs: readyAt - scheduledAt,
    };
  } catch (error) {
    object.dispose();
    throw error;
  }
}

function disposeBitmapLine(line: BitmapLine): void {
  line.object.dispose();
}

async function loadBitmapReferenceSnapshot(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<{
  readonly atlasGpuBytes: number;
  readonly reference: BitmapReferenceResource;
}> {
  // The registry caches this handle for the font and releases it from font.dispose().
  // The decoded GPU textures are a separate lease and must be released immediately.
  const raster = await font.loadRaster(
    {
      rasterKey: await bitmapRasterKey({ strikes: [16] as const }),
      kind: 'bitmap',
    },
    signal === undefined ? undefined : { signal },
  );
  const resource = await bitmapRequest.module.decode(font, raster, signal);
  try {
    return {
      atlasGpuBytes: bitmapAtlasBytes(resource),
      reference: snapshotBitmapReference(resource),
    };
  } finally {
    bitmapRequest.module.dispose(resource);
  }
}

export async function registeredBitmapAtlas(
  font: RegisteredFont,
  density: BitmapFixtureDensity = 'conformance',
): Promise<{
  readonly gpuBytes: number;
  readonly pages: readonly BitmapAtlasPageStats[];
  readonly strikes: readonly { readonly ppem: number }[];
}> {
  const rasterKey =
    density === 'live'
      ? await bitmapRasterKey({ strikes: LIVE_BITMAP_STRIKES })
      : await bitmapRasterKey({ strikes: CONFORMANCE_BITMAP_STRIKES });
  const raster =
    font.getRaster(rasterKey) ??
    (await font.loadRaster({
      kind: 'bitmap',
      rasterKey,
    }));
  const extension = jsonObject(raster.extensionData, 'bitmap extension');
  const strikes = jsonArray(extension.strikes, 'bitmap strikes');
  let bytes = 0;
  const pages: BitmapAtlasPageStats[] = [];
  const registeredStrikes: Array<{ readonly ppem: number }> = [];
  for (const [strikeIndex, strikeValue] of strikes.entries()) {
    const strike = jsonObject(strikeValue, `bitmap strike ${strikeIndex}`);
    const strikePpem = jsonPositiveInteger(strike.ppemX, `bitmap strike ${strikeIndex} ppemX`);
    if (strike.ppemY !== strikePpem) {
      throw new TypeError(`bitmap strike ${strikeIndex} must be square`);
    }
    registeredStrikes.push({ ppem: strikePpem });
    for (const [pageIndex, pageValue] of jsonArray(strike.pages, `bitmap strike ${strikeIndex} pages`).entries()) {
      const page = jsonObject(pageValue, `bitmap strike ${strikeIndex} page ${pageIndex}`);
      const width = jsonPositiveInteger(page.width, 'bitmap page width');
      const height = jsonPositiveInteger(page.height, 'bitmap page height');
      const gpuBytes = width * height;
      bytes += gpuBytes;
      pages.push({ strikePpem, pageIndex, width, height, gpuBytes });
    }
  }
  return { gpuBytes: bytes, pages, strikes: registeredStrikes };
}

function jsonObject(value: JsonValue | undefined, name: string): Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonArray(value: JsonValue | undefined, name: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function jsonPositiveInteger(value: JsonValue | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function bitmapAtlasBytes(resource: BitmapResource): number {
  return resource.strikes.reduce(
    (strikeBytes, strike) =>
      strikeBytes + strike.pages.reduce((pageBytes, page) => pageBytes + page.width * page.height, 0),
    0,
  );
}

function snapshotBitmapReference(resource: BitmapResource): BitmapReferenceResource {
  return {
    strikes: resource.strikes.map((strike) => ({
      ppem: strike.ppem,
      planeUnitsPerEm: strike.planeUnitsPerEm,
      records: strike.records.slice(),
      pages: strike.pages.map((page) => {
        const texels = page.texture.image.data;
        if (!(texels instanceof Uint8Array)) {
          throw new TypeError('bitmap reference page is not backed by unsigned-byte coverage');
        }
        return { width: page.width, height: page.height, texels: texels.slice() };
      }),
    })),
  };
}

function countDraws(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

function countRenderedGlyphs(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount;
    }
  });
  return count;
}

function updateBitmapDrawVisibility(object: THREE.Object3D): void {
  let glyphCount = 0;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const availableVertexCount = child.geometry.index?.count ?? child.geometry.getAttribute('position')?.count ?? 0;
    const vertexCount = Number.isFinite(child.geometry.drawRange.count)
      ? Math.min(availableVertexCount, child.geometry.drawRange.count)
      : availableVertexCount;
    const instanceCount =
      child.geometry instanceof THREE.InstancedBufferGeometry ? child.geometry.instanceCount : vertexCount > 0 ? 1 : 0;
    child.visible = vertexCount > 0 && instanceCount > 0;
    if (child.geometry instanceof THREE.InstancedBufferGeometry) glyphCount += child.geometry.instanceCount;
  });
  object.visible = glyphCount > 0;
}

function countMissingGlyphs(layout: ParagraphLayout): number {
  return layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
}

interface ActiveBitmapTextPersistentScene {
  finishPresentation(revision: number): BitmapTextPreviewSnapshot;
  frame(context: PersistentRenderFrameContext): void;
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  resize(viewport: PersistentRenderViewport): void;
  setGridVisible(visible: boolean): void;
  setPresentationProgress(revision: number, progress: number): BitmapTextPreviewSnapshot;
  telemetry(
    snapshot: Parameters<NonNullable<PersistentRenderScene['telemetry']>>[0],
    viewport: PersistentRenderViewport,
  ): void;
  update(options: BitmapTextPreviewUpdate): Promise<BitmapTextPreviewSnapshot>;
  dispose(): void;
}

interface BitmapPersistentFontFixture {
  readonly atlas: Awaited<ReturnType<typeof registeredBitmapAtlas>>;
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  readonly loaded: Awaited<ReturnType<typeof loadBitmapFont>>;
}

export function createBitmapTextPersistentScene(options: BitmapTextPersistentSceneOptions): BitmapTextPersistentScene {
  let runtime: ActiveBitmapTextPersistentScene | undefined;
  const activation = createPersistentSceneActivation<ActiveBitmapTextPersistentScene>();
  let activated = false;
  let deactivated = false;
  const active = (): ActiveBitmapTextPersistentScene => {
    if (runtime === undefined || deactivated) {
      throw new DOMException('The bitmap persistent scene is not active', 'InvalidStateError');
    }
    return runtime;
  };
  return {
    id: options.id ?? 'bitmap-text',
    async activate(context) {
      if (activated)
        throw new DOMException('The bitmap persistent scene cannot be activated twice', 'InvalidStateError');
      activated = true;
      try {
        runtime = await activateBitmapTextPersistentScene(options, context);
        activation.resolve(runtime);
      } catch (error) {
        activation.reject(error);
        throw error;
      }
    },
    frame(context) {
      active().frame(context);
    },
    telemetry(snapshot, viewport) {
      active().telemetry(snapshot, viewport);
    },
    resize(viewport) {
      active().resize(viewport);
    },
    async deactivate() {
      if (deactivated) return;
      deactivated = true;
      if (runtime === undefined) {
        activation.reject(new DOMException('The bitmap persistent scene was deactivated', 'AbortError'));
      }
      runtime?.dispose();
      runtime = undefined;
    },
    panBy(deltaX, deltaY) {
      active().panBy(deltaX, deltaY);
    },
    resetView() {
      active().resetView();
    },
    setGridVisible(visible) {
      active().setGridVisible(visible);
    },
    update(update) {
      return activation.wait().then((activatedRuntime) => activatedRuntime.update(update));
    },
    setPresentationProgress(revision, progress) {
      return active().setPresentationProgress(revision, progress);
    },
    finishPresentation(revision) {
      return active().finishPresentation(revision);
    },
  };
}

async function activateBitmapTextPersistentScene(
  options: BitmapTextPersistentSceneOptions,
  context: PersistentRenderSceneContext,
): Promise<ActiveBitmapTextPersistentScene> {
  const {
    backend,
    expectedGlyphCount,
    delivery = 'baked',
    fontFixture = 'inter',
    fontSize,
    layoutWidth,
    text,
    language = 'en',
    direction = 'ltr',
    features = [],
    textAlign = 'start',
    onError,
    onStats,
    onBakeProgress,
  } = options;
  const startupStarted = performance.now();
  let width = context.viewport.width;
  let viewportHeight = context.viewport.height;
  let currentFontSize = fontSize;
  let layoutWidthRatio = options.layoutWidthRatio ?? layoutWidth / width;
  let committedContentWidth = layoutWidth;
  let gridVisible = options.showGrid;
  // PersistentRenderSceneRenderer removes lifecycle methods at the type boundary. CanvasSurface uses only borrowed
  // render commands, so restore the concrete type locally without transferring renderer ownership.
  const renderer = context.renderer as THREE.WebGPURenderer;
  const canvasSurface = createCanvasSurface(renderer, width, viewportHeight, gridVisible);
  const textUpdateTelemetry = createTextUpdateTelemetry();
  const registry = new FontRegistry();
  let font: RegisteredFont | undefined;
  let fontFixtureController: RetainedFontFixtureController<BitmapPersistentFontFixture> | undefined;
  let line: BitmapLine | undefined;
  try {
    const fontStarted = performance.now();
    const loadedFont = await loadBitmapFont(context.signal, fontFixture, delivery, 'live', onBakeProgress, registry);
    font = loadedFont.font;
    const fontLoadMs = performance.now() - fontStarted;
    context.signal.throwIfAborted();
    const scene = new THREE.Scene();
    const textStarted = performance.now();
    line = await createBitmapLine(
      font,
      loadedFont.raster,
      text,
      fontSize,
      context.viewport.dpr,
      context.signal,
      layoutWidth,
      {
        language,
        direction,
        features,
        textAlign,
        rejectMissingGlyphs: expectedGlyphCount !== undefined,
      },
    );
    if (expectedGlyphCount !== undefined && line.glyphCount !== expectedGlyphCount) {
      throw new Error(`live workload rendered ${line.glyphCount} glyphs; expected ${expectedGlyphCount}`);
    }
    const textReadyMs = performance.now() - textStarted;
    let activeLine = line;
    updateBitmapDrawVisibility(activeLine.object);
    const atlas = await registeredBitmapAtlas(font, 'live');
    fontFixtureController = createRetainedFontFixtureController(registry, {
      fixture: fontFixture,
      asset: { atlas, font, fontLoadMs, loaded: loadedFont },
    });
    const activeFontFixture = fontFixtureController;
    context.signal.throwIfAborted();
    const sceneStartedAt = performance.now();
    scene.add(activeLine.object);
    const sceneMs = performance.now() - sceneStartedAt;
    textUpdateTelemetry.record({
      scheduleMs: activeLine.scheduleMs,
      readyMs: activeLine.readyMs,
      sceneMs,
      totalMs: performance.now() - textStarted,
    });
    const camera = new THREE.OrthographicCamera(0, width, 0, -viewportHeight, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();
    const startupMs = performance.now() - startupStarted;
    let closing = false;
    let disposed = false;
    let layoutRevision = 0;
    let currentExpectedGlyphCount = expectedGlyphCount;
    let firstDrawMs = 0;
    let gpuTimingSupported = backend === 'webgpu' && renderer.hasFeature('timestamp-query');
    let anchor = options.anchor ?? 'center';
    const targetLinePosition = (): readonly [number, number] => {
      const layout = activeLine.object.layout;
      const currentLayoutWidth =
        anchor === 'center' ? (layout?.width ?? activeLine.width) : benchmarkContentWidth(width, layoutWidthRatio);
      const layoutHeight = layout?.height ?? activeLine.height;
      return liveTextPosition(anchor, width, viewportHeight, currentLayoutWidth, layoutHeight);
    };
    const initialPosition = targetLinePosition();
    activeLine.object.position.set(initialPosition[0], initialPosition[1], 0);
    let presentation: BitmapTextPresentation = {
      kind: 'settled',
      revision: 0,
      matchedGlyphs: 0,
      targetGlyphs: countRenderedGlyphs(activeLine.object),
    };
    const disposePresentation = (): void => {
      if (presentation.kind !== 'transitioning') return;
      for (const controller of presentation.controllers) controller.dispose();
    };
    const presentationSnapshot = (): BitmapTextPreviewSnapshot => {
      const layout = activeLine.object.layout;
      if (layout === undefined) throw new Error('bitmap preview lost its committed layout');
      return {
        revision: presentation.revision,
        presentationProgress: presentation.kind === 'settled' ? 1 : presentation.progress,
        matchedGlyphs: presentation.matchedGlyphs,
        targetGlyphs: presentation.targetGlyphs,
        glyphCount: countRenderedGlyphs(activeLine.object),
        lineCount: layout.lineGlyphCounts.length,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
      };
    };
    const setPresentationProgress = (revision: number, progress: number): BitmapTextPreviewSnapshot => {
      if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
        throw new RangeError('bitmap preview presentation progress must be in [0, 1]');
      }
      if (closing || disposed || presentation.revision !== revision) {
        throw new DOMException('The bitmap preview presentation is stale', 'AbortError');
      }
      if (presentation.kind === 'settled') {
        if (progress !== 1) {
          throw new DOMException('The bitmap preview presentation is settled', 'InvalidStateError');
        }
        return presentationSnapshot();
      }
      for (const controller of presentation.controllers) controller.setProgress(progress);
      updateBitmapDrawVisibility(activeLine.object);
      activeLine.object.position.set(
        presentation.fromX + (presentation.toX - presentation.fromX) * progress,
        presentation.fromY + (presentation.toY - presentation.fromY) * progress,
        0,
      );
      presentation.progress = progress;
      if (progress === 1) {
        for (const controller of presentation.controllers) controller.finish();
        updateBitmapDrawVisibility(activeLine.object);
        presentation = {
          kind: 'settled',
          revision: presentation.revision,
          matchedGlyphs: presentation.matchedGlyphs,
          targetGlyphs: presentation.targetGlyphs,
        };
      }
      return presentationSnapshot();
    };
    const reflowToViewport = (update?: BitmapTextPreviewUpdate): Promise<BitmapTextPreviewSnapshot> => {
      const updateStartedAt = performance.now();
      const revision = ++layoutRevision;
      const previousSnapshots: readonly BitmapGlyphPositionSnapshot[] = activeLine.object.children.map((object) =>
        captureBitmapGlyphPositions(object),
      );
      const fromX = activeLine.object.position.x;
      const fromY = activeLine.object.position.y;
      disposePresentation();
      const targetFontSize = update?.fontSize ?? currentFontSize;
      const targetAnchor = update?.anchor ?? anchor;
      const targetLayoutWidthRatio = update?.layoutWidthRatio ?? layoutWidthRatio;
      const targetExpectedGlyphCount = update === undefined ? currentExpectedGlyphCount : update.expectedGlyphCount;
      const dimensions = {
        fontSize: targetFontSize,
        width: benchmarkContentWidth(width, targetLayoutWidthRatio),
      };
      let scheduledAt = updateStartedAt;
      return activeFontFixture
        .update({
          fixture: update?.fontFixture ?? activeFontFixture.current.fixture,
          isCurrent: () => !closing && !disposed && revision === layoutRevision,
          load: async (fixture, fixtureRegistry) => {
            const fontStartedAt = performance.now();
            const loaded = await loadBitmapFont(
              context.signal,
              fixture,
              delivery,
              'live',
              onBakeProgress,
              fixtureRegistry,
            );
            try {
              const nextAtlas = await registeredBitmapAtlas(loaded.font, 'live');
              return { atlas: nextAtlas, font: loaded.font, fontLoadMs: performance.now() - fontStartedAt, loaded };
            } catch (error) {
              if (loaded.font !== activeFontFixture.current.asset.font) loaded.font.dispose();
              throw error;
            }
          },
          commit: async (fixture) => {
            scheduledAt = performance.now();
            const replacingFont = fixture.font !== activeFontFixture.current.asset.font;
            if (replacingFont && update !== undefined) {
              const replacement = await createBitmapLine(
                fixture.font,
                fixture.loaded.raster,
                update.text,
                targetFontSize,
                context.viewport.dpr,
                context.signal,
                dimensions.width,
                {
                  language: update.language,
                  direction: update.direction,
                  features: update.features,
                  textAlign: update.textAlign,
                  rejectMissingGlyphs: targetExpectedGlyphCount !== undefined,
                },
              );
              if (closing || disposed || revision !== layoutRevision) {
                disposeBitmapLine(replacement);
                throw new DOMException('The bitmap preview update was superseded', 'AbortError');
              }
              updateBitmapDrawVisibility(replacement.object);
              scene.add(replacement.object);
              scene.remove(activeLine.object);
              disposeBitmapLine(activeLine);
              activeLine = replacement;
            } else {
              if (update?.text.length === 0) activeLine.object.visible = false;
              activeLine.object.setProperties({
                ...dimensions,
                font: fixture.font,
                raster: fixture.loaded.raster,
                ...(update === undefined
                  ? {}
                  : {
                      text: update.text,
                      language: update.language,
                      direction: update.direction,
                      features: update.features,
                      textAlign: update.textAlign,
                    }),
              });
              updateBitmapDrawVisibility(activeLine.object);
              await activeLine.object.ready;
              updateBitmapDrawVisibility(activeLine.object);
            }
            currentFontSize = targetFontSize;
            anchor = targetAnchor;
            layoutWidthRatio = targetLayoutWidthRatio;
            committedContentWidth = dimensions.width;
            currentExpectedGlyphCount = targetExpectedGlyphCount;
            const committedPosition = targetLinePosition();
            activeLine.object.position.set(committedPosition[0], committedPosition[1], 0);
          },
        })
        .then(() => {
          if (closing || disposed || revision !== layoutRevision) {
            throw new DOMException('The bitmap preview update was superseded', 'AbortError');
          }
          if (activeLine.object.layout === undefined) throw new Error('bitmap preview update did not commit a layout');
          if (
            currentExpectedGlyphCount !== undefined &&
            countRenderedGlyphs(activeLine.object) !== currentExpectedGlyphCount
          ) {
            throw new Error(
              `live workload rendered ${countRenderedGlyphs(activeLine.object)} glyphs; expected ${currentExpectedGlyphCount}`,
            );
          }
          const reflowSceneStartedAt = performance.now();
          const targetPosition = targetLinePosition();
          const controllers: BitmapGlyphPositionTransition[] = [];
          for (
            let batchIndex = 0;
            batchIndex < activeLine.object.children.length && batchIndex < previousSnapshots.length;
            batchIndex += 1
          ) {
            controllers.push(
              createBitmapGlyphPositionTransition(
                activeLine.object.children[batchIndex]!,
                previousSnapshots[batchIndex]!,
              ),
            );
          }
          for (const controller of controllers) controller.setProgress(0);
          updateBitmapDrawVisibility(activeLine.object);
          activeLine.object.position.set(fromX, fromY, 0);
          presentation = {
            kind: 'transitioning',
            revision,
            controllers,
            fromX,
            fromY,
            toX: targetPosition[0],
            toY: targetPosition[1],
            matchedGlyphs: controllers.reduce((count, controller) => count + controller.matchedGlyphs, 0),
            targetGlyphs: countRenderedGlyphs(activeLine.object),
            progress: 0,
          };
          const finishedAt = performance.now();
          textUpdateTelemetry.record({
            scheduleMs: scheduledAt - updateStartedAt,
            readyMs: reflowSceneStartedAt - scheduledAt,
            sceneMs: finishedAt - reflowSceneStartedAt,
            totalMs: finishedAt - updateStartedAt,
          });
          return presentationSnapshot();
        });
    };
    const resize = (viewport: PersistentRenderViewport): void => {
      if (closing || disposed) return;
      width = viewport.width;
      viewportHeight = viewport.height;
      canvasSurface.resize(width, viewportHeight);
      camera.right = width;
      camera.bottom = -viewportHeight;
      camera.updateProjectionMatrix();
      const nextContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
      if (nextContentWidth === committedContentWidth) {
        const targetPosition = targetLinePosition();
        activeLine.object.position.set(targetPosition[0], targetPosition[1], 0);
        return;
      }
      void reflowToViewport()
        .then((snapshot) => setPresentationProgress(snapshot.revision, 1))
        .catch((error: unknown) => {
          if (!closing && !disposed && !(error instanceof DOMException && error.name === 'AbortError')) onError(error);
        });
    };
    return {
      frame() {
        if (closing || disposed) return;
        const startedAt = performance.now();
        updateBitmapDrawVisibility(activeLine.object);
        canvasSurface.render(scene, camera);
        if (firstDrawMs === 0) firstDrawMs = performance.now() - startedAt;
      },
      telemetry(snapshot, viewport) {
        if (closing || disposed) return;
        gpuTimingSupported ||= snapshot.gpuFrameMs !== undefined;
        const currentFontFixture = activeFontFixture.current.asset;
        const layout = activeLine.object.layout;
        if (layout === undefined) throw new Error('live bitmap Text lost its committed layout');
        const strikePpem = selectBitmapStrikePpem(currentFontFixture.atlas.strikes, currentFontSize, viewport.dpr);
        const framebufferGpuBytes = viewport.drawingBufferWidth * viewport.drawingBufferHeight * 4;
        onStats({
          technique: 'bitmap',
          backend,
          dpr: viewport.dpr,
          showGrid: gridVisible,
          ...snapshot,
          glyphCount: countRenderedGlyphs(activeLine.object),
          missingGlyphCount: countMissingGlyphs(layout),
          drawCount: countDraws(activeLine.object),
          layoutWidth: layout.width,
          layoutHeight: layout.height,
          lineCount: layout.lineGlyphCounts.length,
          strikePpem,
          cssFontSize: currentFontSize,
          renderedPpem: currentFontSize * viewport.dpr,
          scaleRatio: (currentFontSize * viewport.dpr) / strikePpem,
          atlasGpuBytes: currentFontFixture.atlas.gpuBytes,
          atlasPages: currentFontFixture.atlas.pages,
          framebufferGpuBytes,
          totalGpuBytes: currentFontFixture.atlas.gpuBytes + framebufferGpuBytes,
          artifactBytes: currentFontFixture.loaded.artifactBytes,
          delivery,
          sourceFontBytes: currentFontFixture.loaded.metrics.sourceFontBytes,
          coreArtifactBytes: currentFontFixture.loaded.metrics.coreArtifactBytes,
          coreBakeMs: currentFontFixture.loaded.metrics.coreBakeMs,
          rasterArtifactBytes: currentFontFixture.loaded.metrics.rasterArtifactBytes,
          rasterBakeMs: currentFontFixture.loaded.metrics.rasterBakeMs,
          rendererInitMs: context.rendererInitMs,
          fontLoadMs: currentFontFixture.fontLoadMs,
          textReadyMs,
          firstDrawMs,
          startupMs,
          gpuTimingSupported,
          textUpdateTimings: textUpdateTelemetry.summary(),
        });
      },
      resize,
      panBy(deltaX, deltaY) {
        if (closing || disposed) return;
        scene.position.x += finiteCanvasDelta(deltaX, 'bitmap preview horizontal pan');
        scene.position.y -= finiteCanvasDelta(deltaY, 'bitmap preview vertical pan');
      },
      resetView() {
        scene.position.set(0, 0, 0);
      },
      setGridVisible(visible) {
        gridVisible = visible;
        canvasSurface.setGridVisible(visible);
      },
      update(next) {
        if (closing || disposed) {
          return Promise.reject(new DOMException('The bitmap preview is disposed', 'AbortError'));
        }
        positiveViewportSize(next.fontSize, 'bitmap preview font size');
        if (!Number.isFinite(next.layoutWidthRatio) || next.layoutWidthRatio <= 0 || next.layoutWidthRatio > 1) {
          throw new RangeError('bitmap preview layout width ratio must be in (0, 1]');
        }
        return reflowToViewport(next);
      },
      setPresentationProgress,
      finishPresentation(revision) {
        return setPresentationProgress(revision, 1);
      },
      dispose() {
        if (disposed) return;
        closing = true;
        disposed = true;
        layoutRevision += 1;
        disposePresentation();
        disposeBitmapLine(activeLine);
        activeFontFixture.dispose();
        canvasSurface.dispose();
      },
    };
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line);
    if (fontFixtureController === undefined) font?.dispose();
    else fontFixtureController.dispose();
    canvasSurface.dispose();
    throw error;
  }
}

export async function createBitmapTextPreview(options: BitmapTextPreviewOptions): Promise<BitmapTextPreview> {
  const {
    backend,
    canvas,
    dpr,
    expectedGlyphCount,
    delivery = 'baked',
    fontFixture = 'inter',
    fontSize,
    height,
    layoutWidth,
    signal,
    text,
    language = 'en',
    direction = 'ltr',
    features = [],
    textAlign = 'start',
    onError,
    onStats,
    onBakeProgress,
  } = options;
  const startupStarted = performance.now();
  let width = positiveViewportSize(options.width, 'bitmap preview width');
  let viewportHeight = positiveViewportSize(height, 'bitmap preview height');
  let currentFontSize = fontSize;
  let layoutWidthRatio = options.layoutWidthRatio ?? layoutWidth / width;
  let committedContentWidth = layoutWidth;
  const rendererStarted = performance.now();
  const renderer = await createConfiguredRenderer({
    backend,
    canvas,
    dpr,
    height: viewportHeight,
    trackGpuTimestamps: backend === 'webgpu',
    width,
  });
  let rendererViewport = readRendererViewportState(renderer);
  const canvasSurface = createCanvasSurface(renderer, width, viewportHeight, options.showGrid);
  let gridVisible = options.showGrid;
  const textUpdateTelemetry = createTextUpdateTelemetry();
  const rendererInitMs = performance.now() - rendererStarted;
  let font: RegisteredFont | undefined;
  let line: BitmapLine | undefined;
  let gpuFrameTimer: GpuFrameTimer | undefined;
  try {
    const fontStarted = performance.now();
    const loadedFont = await loadBitmapFont(signal, fontFixture, delivery, 'live', onBakeProgress);
    font = loadedFont.font;
    const fontLoadMs = performance.now() - fontStarted;
    signal?.throwIfAborted();
    const scene = new THREE.Scene();
    const textStarted = performance.now();
    line = await createBitmapLine(font, loadedFont.raster, text, fontSize, dpr, signal, layoutWidth, {
      language,
      direction,
      features,
      textAlign,
      rejectMissingGlyphs: expectedGlyphCount !== undefined,
    });
    if (expectedGlyphCount !== undefined && line.glyphCount !== expectedGlyphCount) {
      throw new Error(`live workload rendered ${line.glyphCount} glyphs; expected ${expectedGlyphCount}`);
    }
    const textReadyMs = performance.now() - textStarted;
    const startupMs = performance.now() - startupStarted;
    const activeFont = font;
    const activeLine = line;
    const atlas = await registeredBitmapAtlas(activeFont, 'live');
    const sceneStartedAt = performance.now();
    scene.add(activeLine.object);
    const sceneMs = performance.now() - sceneStartedAt;
    textUpdateTelemetry.record({
      scheduleMs: activeLine.scheduleMs,
      readyMs: activeLine.readyMs,
      sceneMs,
      totalMs: performance.now() - textStarted,
    });
    const camera = new THREE.OrthographicCamera(0, width, 0, -viewportHeight, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();
    gpuFrameTimer = createGpuFrameTimer({ backend, renderer, onError });
    const activeGpuFrameTimer = gpuFrameTimer;
    const gpuTimingSupported = activeGpuFrameTimer.supported;
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported });
    let closing = false;
    let disposed = false;
    let disposal: Promise<void> | undefined;
    let layoutRevision = 0;
    let firstDrawMs = 0;
    let anchor = options.anchor ?? 'center';
    const targetLinePosition = (): readonly [number, number] => {
      const layout = activeLine.object.layout;
      const currentLayoutWidth =
        anchor === 'center' ? (layout?.width ?? activeLine.width) : benchmarkContentWidth(width, layoutWidthRatio);
      const layoutHeight = layout?.height ?? activeLine.height;
      return liveTextPosition(anchor, width, viewportHeight, currentLayoutWidth, layoutHeight);
    };
    const initialPosition = targetLinePosition();
    activeLine.object.position.set(initialPosition[0], initialPosition[1], 0);
    let presentation: BitmapTextPresentation = {
      kind: 'settled',
      revision: 0,
      matchedGlyphs: 0,
      targetGlyphs: countRenderedGlyphs(activeLine.object),
    };
    const disposePresentation = (): void => {
      if (presentation.kind !== 'transitioning') return;
      for (const controller of presentation.controllers) controller.dispose();
    };
    const presentationSnapshot = (): BitmapTextPreviewSnapshot => {
      const layout = activeLine.object.layout;
      if (layout === undefined) throw new Error('bitmap preview lost its committed layout');
      return {
        revision: presentation.revision,
        presentationProgress: presentation.kind === 'settled' ? 1 : presentation.progress,
        matchedGlyphs: presentation.matchedGlyphs,
        targetGlyphs: presentation.targetGlyphs,
        glyphCount: countRenderedGlyphs(activeLine.object),
        lineCount: layout.lineGlyphCounts.length,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
      };
    };
    const setPresentationProgress = (revision: number, progress: number): BitmapTextPreviewSnapshot => {
      if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
        throw new RangeError('bitmap preview presentation progress must be in [0, 1]');
      }
      if (closing || disposed || presentation.revision !== revision) {
        throw new DOMException('The bitmap preview presentation is stale', 'AbortError');
      }
      if (presentation.kind === 'settled') {
        if (progress !== 1) {
          throw new DOMException('The bitmap preview presentation is settled', 'InvalidStateError');
        }
        return presentationSnapshot();
      }
      for (const controller of presentation.controllers) controller.setProgress(progress);
      activeLine.object.position.set(
        presentation.fromX + (presentation.toX - presentation.fromX) * progress,
        presentation.fromY + (presentation.toY - presentation.fromY) * progress,
        0,
      );
      presentation.progress = progress;
      if (progress === 1) {
        for (const controller of presentation.controllers) controller.finish();
        presentation = {
          kind: 'settled',
          revision: presentation.revision,
          matchedGlyphs: presentation.matchedGlyphs,
          targetGlyphs: presentation.targetGlyphs,
        };
      }
      return presentationSnapshot();
    };
    const reflowToViewport = (
      update?: Pick<BitmapTextPreviewUpdate, 'text' | 'language' | 'direction' | 'features' | 'textAlign'>,
    ): Promise<BitmapTextPreviewSnapshot> => {
      const updateStartedAt = performance.now();
      const revision = ++layoutRevision;
      const previousSnapshots: readonly BitmapGlyphPositionSnapshot[] = activeLine.object.children.map((object) =>
        captureBitmapGlyphPositions(object),
      );
      const fromX = activeLine.object.position.x;
      const fromY = activeLine.object.position.y;
      disposePresentation();
      const dimensions = {
        fontSize: currentFontSize,
        width: benchmarkContentWidth(width, layoutWidthRatio),
      };
      if (update === undefined) activeLine.object.setProperties(dimensions);
      else activeLine.object.setProperties({ ...dimensions, ...update });
      const scheduledAt = performance.now();
      return activeLine.object.ready.then(() => {
        if (closing || disposed || revision !== layoutRevision) {
          throw new DOMException('The bitmap preview update was superseded', 'AbortError');
        }
        const layout = activeLine.object.layout;
        if (layout === undefined) throw new Error('bitmap preview update did not commit a layout');
        committedContentWidth = dimensions.width;
        const reflowSceneStartedAt = performance.now();
        const targetPosition = targetLinePosition();
        const controllers: BitmapGlyphPositionTransition[] = [];
        for (
          let batchIndex = 0;
          batchIndex < activeLine.object.children.length && batchIndex < previousSnapshots.length;
          batchIndex += 1
        ) {
          controllers.push(
            createBitmapGlyphPositionTransition(
              activeLine.object.children[batchIndex]!,
              previousSnapshots[batchIndex]!,
            ),
          );
        }
        for (const controller of controllers) controller.setProgress(0);
        activeLine.object.position.set(fromX, fromY, 0);
        presentation = {
          kind: 'transitioning',
          revision,
          controllers,
          fromX,
          fromY,
          toX: targetPosition[0],
          toY: targetPosition[1],
          matchedGlyphs: controllers.reduce((count, controller) => count + controller.matchedGlyphs, 0),
          targetGlyphs: countRenderedGlyphs(activeLine.object),
          progress: 0,
        };
        const finishedAt = performance.now();
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - updateStartedAt,
          readyMs: reflowSceneStartedAt - scheduledAt,
          sceneMs: finishedAt - reflowSceneStartedAt,
          totalMs: finishedAt - updateStartedAt,
        });
        return presentationSnapshot();
      });
    };
    const renderPreviewFrame = (timestamp: number): void => {
      if (disposed) return;
      try {
        const cpuFrameStarted = performance.now();
        for (const measurement of activeGpuFrameTimer.poll()) {
          if (measurement.durationMs === undefined) telemetry.discardGpu(measurement.frameId);
          else telemetry.recordGpu(measurement.frameId, measurement.durationMs);
        }
        const frameId = telemetry.beginFrame(timestamp);
        if (telemetry.gpuTimingSupported) activeGpuFrameTimer.beginFrame(frameId);
        const started = performance.now();
        try {
          canvasSurface.render(scene, camera);
        } finally {
          if (telemetry.gpuTimingSupported) activeGpuFrameTimer.endFrame();
        }
        if (closing) return;
        const submitMs = performance.now() - started;
        if (firstDrawMs === 0) firstDrawMs = submitMs;
        const cpuFrameMs = performance.now() - cpuFrameStarted;
        const telemetrySnapshot = telemetry.endFrame(frameId, cpuFrameMs);
        if (telemetrySnapshot === undefined) return;
        const framebufferGpuBytes = rendererViewport.drawingBufferWidth * rendererViewport.drawingBufferHeight * 4;
        const layout = activeLine.object.layout;
        if (layout === undefined) throw new Error('live bitmap Text lost its committed layout');
        onStats({
          technique: 'bitmap',
          backend,
          dpr: rendererViewport.pixelRatio,
          showGrid: gridVisible,
          ...telemetrySnapshot,
          glyphCount: countRenderedGlyphs(activeLine.object),
          missingGlyphCount: countMissingGlyphs(layout),
          drawCount: countDraws(activeLine.object),
          layoutWidth: layout.width,
          layoutHeight: layout.height,
          lineCount: layout.lineGlyphCounts.length,
          strikePpem: selectBitmapStrikePpem(atlas.strikes, currentFontSize, rendererViewport.pixelRatio),
          cssFontSize: currentFontSize,
          renderedPpem: currentFontSize * rendererViewport.pixelRatio,
          scaleRatio:
            (currentFontSize * rendererViewport.pixelRatio) /
            selectBitmapStrikePpem(atlas.strikes, currentFontSize, rendererViewport.pixelRatio),
          atlasGpuBytes: atlas.gpuBytes,
          atlasPages: atlas.pages,
          framebufferGpuBytes,
          totalGpuBytes: atlas.gpuBytes + framebufferGpuBytes,
          artifactBytes: loadedFont.artifactBytes,
          delivery,
          sourceFontBytes: loadedFont.metrics.sourceFontBytes,
          coreArtifactBytes: loadedFont.metrics.coreArtifactBytes,
          coreBakeMs: loadedFont.metrics.coreBakeMs,
          rasterArtifactBytes: loadedFont.metrics.rasterArtifactBytes,
          rasterBakeMs: loadedFont.metrics.rasterBakeMs,
          rendererInitMs,
          fontLoadMs,
          textReadyMs,
          firstDrawMs,
          startupMs,
          gpuTimingSupported,
          textUpdateTimings: textUpdateTelemetry.summary(),
        });
      } catch (error) {
        onError(error);
      }
    };
    await renderer.setAnimationLoop(renderPreviewFrame);
    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return;
        width = positiveViewportSize(nextWidth, 'bitmap preview width');
        viewportHeight = positiveViewportSize(nextHeight, 'bitmap preview height');
        renderer.setSize(width, viewportHeight, false);
        rendererViewport = readRendererViewportState(renderer);
        canvasSurface.resize(width, viewportHeight);
        camera.right = width;
        camera.bottom = -viewportHeight;
        camera.updateProjectionMatrix();
        const nextContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
        if (nextContentWidth === committedContentWidth) {
          const targetPosition = targetLinePosition();
          activeLine.object.position.set(targetPosition[0], targetPosition[1], 0);
          return;
        }
        void reflowToViewport()
          .then((snapshot) => setPresentationProgress(snapshot.revision, 1))
          .catch((error: unknown) => {
            if (!closing && !disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
              onError(error);
            }
          });
      },
      panBy(deltaX, deltaY) {
        if (closing || disposed) return;
        scene.position.x += finiteCanvasDelta(deltaX, 'bitmap preview horizontal pan');
        scene.position.y -= finiteCanvasDelta(deltaY, 'bitmap preview vertical pan');
      },
      resetView() {
        scene.position.set(0, 0, 0);
      },
      setGridVisible(visible) {
        gridVisible = visible;
        canvasSurface.setGridVisible(visible);
      },
      update(next) {
        if (closing || disposed) {
          return Promise.reject(new DOMException('The bitmap preview is disposed', 'AbortError'));
        }
        currentFontSize = positiveViewportSize(next.fontSize, 'bitmap preview font size');
        anchor = next.anchor;
        if (!Number.isFinite(next.layoutWidthRatio) || next.layoutWidthRatio <= 0 || next.layoutWidthRatio > 1) {
          throw new RangeError('bitmap preview layout width ratio must be in (0, 1]');
        }
        layoutWidthRatio = next.layoutWidthRatio;
        return reflowToViewport({
          text: next.text,
          language: next.language,
          direction: next.direction,
          features: next.features,
          textAlign: next.textAlign,
        });
      },
      setPresentationProgress,
      finishPresentation(revision) {
        return setPresentationProgress(revision, 1);
      },
      dispose() {
        if (disposal !== undefined) return disposal;
        closing = true;
        disposal = (async () => {
          disposed = true;
          await renderer.setAnimationLoop(null);
          await activeGpuFrameTimer.dispose();
          disposePresentation();
          disposeBitmapLine(activeLine);
          activeFont.dispose();
          canvasSurface.dispose();
          await disposeConfiguredRenderer(renderer);
        })();
        return disposal;
      },
    };
  } catch (error) {
    await gpuFrameTimer?.dispose();
    if (line !== undefined) disposeBitmapLine(line);
    font?.dispose();
    canvasSurface.dispose();
    await disposeConfiguredRenderer(renderer);
    throw error;
  }
}

export async function captureBitmapTextConformance(options: {
  readonly backend: RendererBackend;
  readonly delivery?: FontDelivery;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<BitmapTextConformanceCapture> {
  options.signal?.throwIfAborted();
  const resources = await createResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.delivery,
    options.signal,
    options.renderer,
  );
  try {
    options.signal?.throwIfAborted();
    const width = Math.round(WIDTH * options.dpr);
    const height = Math.round(HEIGHT * options.dpr);
    const rendered = await renderFrame(resources, width, height);
    options.signal?.throwIfAborted();
    const quality = assertBitmapTextPixels(rendered.bytes, width, height);
    const { bytes: difference, mismatchBytes } = differenceImage(rendered.bytes, resources.referencePixels);
    return {
      width,
      height,
      candidate: rendered.bytes,
      reference: resources.referencePixels.slice(),
      difference,
      mismatchBytes,
      litPixels: quality.litPixels,
      inkPixels: quality.inkPixels,
      renderSubmitMs: rendered.renderMs,
    };
  } finally {
    await disposeBitmapTextResources(resources);
  }
}

export async function captureBitmapSourceOutlineFidelity(options: {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: SelectableFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted();
  const resources = await createResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    'baked',
    options.signal,
    options.renderer,
  );
  try {
    const width = Math.round(WIDTH * options.dpr);
    const height = Math.round(HEIGHT * options.dpr);
    const rendered = await renderFrame(resources, width, height);
    options.signal?.throwIfAborted();
    return await captureSourceOutlineFidelity({
      candidate: rendered.bytes,
      width,
      height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: resources.line.cssFontSize,
      direction: 'ltr',
      layout: resources.line.layout,
      originX: resources.line.object.position.x,
      originY: resources.line.object.position.y,
      text: conformanceText(),
      renderSubmitMs: rendered.renderMs,
    });
  } finally {
    await disposeBitmapTextResources(resources);
  }
}

function differenceImage(
  candidate: Uint8Array,
  reference: Uint8Array,
): { readonly bytes: Uint8Array; readonly mismatchBytes: number } {
  if (candidate.byteLength !== reference.byteLength) {
    throw new Error('bitmap conformance images do not have matching dimensions');
  }
  const bytes = new Uint8Array(candidate.byteLength);
  let mismatchBytes = 0;
  for (let offset = 0; offset < candidate.byteLength; offset += 4) {
    const red = Math.abs((candidate[offset] ?? 0) - (reference[offset] ?? 0));
    const green = Math.abs((candidate[offset + 1] ?? 0) - (reference[offset + 1] ?? 0));
    const blue = Math.abs((candidate[offset + 2] ?? 0) - (reference[offset + 2] ?? 0));
    if (red !== 0) mismatchBytes += 1;
    if (green !== 0) mismatchBytes += 1;
    if (blue !== 0) mismatchBytes += 1;
    bytes[offset] = Math.max(red, green, blue);
    bytes[offset + 1] = 0;
    bytes[offset + 2] = 0;
    bytes[offset + 3] = 255;
  }
  return { bytes, mismatchBytes };
}

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

async function renderBitmapText(resources: BitmapTextResources): Promise<TargetRunOutput> {
  const { target, camera, line } = resources;
  const physicalWidth = Math.round(WIDTH * resources.dpr);
  const physicalHeight = Math.round(HEIGHT * resources.dpr);
  const originalPosition = line.object.position.clone();
  const unsnappedOriginFraction = Math.max(
    devicePixelFraction(originalPosition.x * resources.dpr),
    devicePixelFraction(originalPosition.y * resources.dpr),
  );
  const full = await renderFrame(resources, physicalWidth, physicalHeight);
  const quality = assertBitmapTextPixels(full.bytes, physicalWidth, physicalHeight, resources.referencePixels);
  const clippedPhysicalWidth = Math.round(CLIPPED_WIDTH * resources.dpr);
  const clippedPhysicalHeight = Math.round(CLIPPED_HEIGHT * resources.dpr);
  let clipped: Awaited<ReturnType<typeof renderFrame>>;
  let clippedQuality: ReturnType<typeof assertBitmapTextPixels>;
  try {
    target.setSize(clippedPhysicalWidth, clippedPhysicalHeight);
    camera.right = CLIPPED_WIDTH;
    camera.bottom = -CLIPPED_HEIGHT;
    camera.updateProjectionMatrix();
    line.object.position.set(quarterDevicePosition(-40, resources.dpr), quarterDevicePosition(-4, resources.dpr), 0);
    const clippedReference = composeBitmapReference(
      line,
      resources.reference,
      resources.dpr,
      CLIPPED_WIDTH,
      CLIPPED_HEIGHT,
      true,
    );
    clipped = await renderFrame(resources, clippedPhysicalWidth, clippedPhysicalHeight);
    clippedQuality = assertBitmapTextPixels(
      clipped.bytes,
      clippedPhysicalWidth,
      clippedPhysicalHeight,
      clippedReference,
      true,
    );
    if (!clippedQuality.touchesBoundary || clippedQuality.inkPixels >= quality.inkPixels) {
      throw new Error('bitmap Text resize did not produce a smaller clipped frame');
    }
  } finally {
    line.object.position.copy(originalPosition);
    target.setSize(physicalWidth, physicalHeight);
    camera.right = WIDTH;
    camera.bottom = -HEIGHT;
    camera.updateProjectionMatrix();
  }
  return {
    bytes: full.bytes.byteLength,
    hash: await sha256(full.bytes),
    metrics: {
      fixtureIsInter: resources.fontFixture === 'inter' ? 1 : 0,
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      glyphCount: line.glyphCount,
      missingGlyphCount: line.missingGlyphCount,
      drawCount: line.drawCount,
      strikePpem: line.strikePpem,
      cssFontSize: line.cssFontSize,
      renderedPpem: line.cssFontSize * resources.dpr,
      scaleRatio: (line.cssFontSize * resources.dpr) / line.strikePpem,
      atlasGpuBytes: resources.atlasGpuBytes,
      renderTargetGpuBytes: full.bytes.byteLength,
      totalGpuBytes: resources.atlasGpuBytes + full.bytes.byteLength,
      litPixels: quality.litPixels,
      inkPixels: quality.inkPixels,
      inkMinX: quality.inkMinX,
      inkMinY: quality.inkMinY,
      inkMaxX: quality.inkMaxX,
      inkMaxY: quality.inkMaxY,
      renderMs: full.renderMs,
      clippedRenderMs: clipped.renderMs,
      clippedInkPixels: clippedQuality.inkPixels,
      clippedTouchesBoundary: clippedQuality.touchesBoundary ? 1 : 0,
      resizedWidth: CLIPPED_WIDTH,
      resizedHeight: CLIPPED_HEIGHT,
      firstDrawMs: resources.firstDrawMs,
      referenceMismatchBytes: quality.referenceMismatchBytes,
      unsnappedOriginFraction,
    },
  };
}

async function renderFrame(
  resources: BitmapTextResources,
  physicalWidth: number,
  physicalHeight: number,
): Promise<{ readonly bytes: Uint8Array; readonly renderMs: number }> {
  const { renderer, target, scene, camera } = resources;
  return withRendererStateRestored(renderer, async () => {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const renderStarted = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - renderStarted;
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, physicalWidth, physicalHeight);
    return {
      bytes: compactRgba8Readback(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        physicalWidth,
        physicalHeight,
        resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
      ),
      renderMs,
    };
  });
}

async function disposeBitmapTextResources(resources: BitmapTextResources): Promise<void> {
  disposeBitmapLine(resources.line);
  resources.font.dispose();
  resources.target.dispose();
  if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
}

export function assertBitmapTextPixels(
  bytes: Uint8Array,
  width: number,
  height: number,
  referenceBytes?: Uint8Array,
  allowBoundary = false,
): {
  readonly litPixels: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly inkPixels: number;
  readonly inkMinX: number;
  readonly inkMinY: number;
  readonly inkMaxX: number;
  readonly inkMaxY: number;
  readonly touchesBoundary: boolean;
  readonly referenceMismatchBytes: number;
} {
  if (bytes.byteLength !== width * height * 4) {
    throw new Error('bitmap text readback length does not match its target');
  }
  const referenceMismatchBytes = referenceBytes === undefined ? 0 : assertExactReference(bytes, referenceBytes, width);
  let litPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;
  let inkMinX = width;
  let inkMinY = height;
  let inkMaxX = -1;
  let inkMaxY = -1;
  let touchesBoundary = false;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const coverage = Math.max(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0);
    if (coverage === 0) continue;
    litPixels += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      touchesBoundary = true;
      if (!allowBoundary) throw new Error('bitmap text touches the render boundary');
    }
    if (coverage >= 128) {
      inkPixels += 1;
      inkMinX = Math.min(inkMinX, x);
      inkMinY = Math.min(inkMinY, y);
      inkMaxX = Math.max(inkMaxX, x);
      inkMaxY = Math.max(inkMaxY, y);
    }
  }
  if (litPixels < 100) throw new Error('bitmap text did not produce enough visible coverage');
  if (inkPixels < 100) throw new Error('bitmap text did not produce enough half-coverage ink');
  return {
    litPixels,
    minX,
    minY,
    maxX,
    maxY,
    inkPixels,
    inkMinX,
    inkMinY,
    inkMaxX,
    inkMaxY,
    touchesBoundary,
    referenceMismatchBytes,
  };
}

function composeBitmapReference(
  line: BitmapLine,
  resource: BitmapReferenceResource,
  dpr: number,
  cssWidth: number,
  cssHeight: number,
  allowClipping = false,
): Uint8Array {
  const physicalWidth = Math.round(cssWidth * dpr);
  const physicalHeight = Math.round(cssHeight * dpr);
  const output = new Uint8Array(physicalWidth * physicalHeight * 4);
  for (let alpha = 3; alpha < output.byteLength; alpha += 4) output[alpha] = 255;

  const strike = resource.strikes.find(({ ppem }) => ppem === line.strikePpem);
  if (strike === undefined) throw new Error('bitmap reference is missing the selected strike');
  const records = new DataView(strike.records.buffer, strike.records.byteOffset, strike.records.byteLength);
  const { layout } = line;
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== 0) continue;
    const glyphId = layout.glyphIds[glyphIndex];
    const fontSize = layout.glyphFontSizes[glyphIndex];
    if (glyphId === undefined || fontSize === undefined) continue;
    const record = glyphId * 20;
    const pageIndex = records.getUint16(record + 16, true);
    if (pageIndex === 0xffff) continue;
    const page = strike.pages[pageIndex];
    if (page === undefined) throw new Error('bitmap reference record points to a missing page');
    const texels = page.texels;
    const scale = fontSize / strike.planeUnitsPerEm;
    if (scale * dpr !== 1) {
      throw new Error('exact bitmap reference requires one atlas texel per device pixel');
    }
    const planeLeft = records.getInt16(record, true);
    const planeTop = records.getInt16(record + 6, true);
    const atlasLeft = records.getUint16(record + 8, true);
    const atlasTop = records.getUint16(record + 10, true);
    const atlasRight = records.getUint16(record + 12, true);
    const atlasBottom = records.getUint16(record + 14, true);
    const left = Math.round((line.object.position.x + layout.x[glyphIndex]! + planeLeft * scale) * dpr);
    const top = Math.round(-(line.object.position.y - layout.y[glyphIndex]! + planeTop * scale) * dpr);
    for (let atlasY = atlasTop; atlasY < atlasBottom; atlasY += 1) {
      for (let atlasX = atlasLeft; atlasX < atlasRight; atlasX += 1) {
        const x = left + atlasX - atlasLeft;
        const y = top + atlasY - atlasTop;
        if (x < 0 || y < 0 || x >= physicalWidth || y >= physicalHeight) {
          if (allowClipping) continue;
          throw new Error('bitmap reference glyph exceeds the framebuffer');
        }
        const coverage = texels[atlasY * page.width + atlasX]!;
        const destination = (y * physicalWidth + x) * 4;
        const previous = output[destination]!;
        const composed = coverage + Math.round((previous * (255 - coverage)) / 255);
        output[destination] = composed;
        output[destination + 1] = composed;
        output[destination + 2] = composed;
      }
    }
  }
  return output;
}

function assertExactReference(actual: Uint8Array, expected: Uint8Array, width: number): number {
  if (actual.byteLength !== expected.byteLength) {
    throw new Error('bitmap CPU reference length does not match the GPU readback');
  }
  const samples: string[] = [];
  let mismatchBytes = 0;
  let maximumDifference = 0;
  for (let index = 0; index < actual.byteLength; index += 1) {
    if (actual[index] === expected[index]) continue;
    mismatchBytes += 1;
    maximumDifference = Math.max(maximumDifference, Math.abs(actual[index]! - expected[index]!));
    if (samples.length < 8) {
      const pixel = Math.floor(index / 4);
      samples.push(
        `(${String(pixel % width)},${String(Math.floor(pixel / width))},${String(index % 4)}):` +
          `${String(actual[index])}/${String(expected[index])}`,
      );
    }
  }
  if (mismatchBytes !== 0) {
    const actualBounds = coverageBounds(actual, width);
    const expectedBounds = coverageBounds(expected, width);
    throw new Error(
      `bitmap GPU readback differs from its CPU atlas reference in ${String(mismatchBytes)} bytes ` +
        `(max delta ${String(maximumDifference)}; actual bounds ${actualBounds}; ` +
        `expected bounds ${expectedBounds}; actual/expected ${samples.join(', ')})`,
    );
  }
  return mismatchBytes;
}

function coverageBounds(bytes: Uint8Array, width: number): string {
  let minX = width;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < bytes.byteLength / 4; pixel += 1) {
    if ((bytes[pixel * 4] ?? 0) === 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return `[${String(minX)},${String(minY)},${String(maxX)},${String(maxY)}]`;
}

function devicePixelFraction(value: number): number {
  return Math.abs(value - Math.round(value));
}

function quarterDevicePosition(value: number, dpr: number): number {
  return (Math.floor(value * dpr) + 0.25) / dpr;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
