import {
  FontLoader,
  FontRegistry,
  Text,
  type BakeProgressListener,
  type FontFeature,
  type ParagraphLayout,
  type RegisteredFont,
  type TextSpan,
} from '@pmndrs/text';
import { slug, slugDescriptorRasterKey, type SlugModule, type SlugResource } from '@pmndrs/text/raster/slug';
import * as THREE from 'three/webgpu';

import type { BenchmarkTarget } from '../benchmark/contracts';
import { rasterConformanceSpecimen, type BenchmarkFontFixture } from '../benchmark/font-fixtures';
import type { FontDelivery } from '../benchmark/url-state';
import { createCanvasSurface } from './canvas-surface';
import { finiteCanvasDelta } from './canvas-view';
import { loadSlugFontAsset } from '../workloads/font-assets/slug';
import type { BakedSlugArtifactSource as SlugBakedArtifactSource } from '../workloads/font-assets';
import type { LiveFrameHistoryCursor } from './live-frame-telemetry';
import {
  benchmarkContentWidth,
  LIVE_TEXT_COLOR,
  LIVE_TEXT_LINE_HEIGHT,
  liveTextPosition,
  type LiveTextAnchor,
} from '../workloads/shared/text-style';
import { createTextUpdateTelemetry, type TextUpdateTimingSummary } from './text-update-telemetry';
import { compareRgba8Coverage } from '../benchmark/low-level/raster/mtsdf-cpu-reference';
import {
  createPersistentRenderHost,
  type PersistentRenderScene,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from './persistent-render-host';
import { createPersistentSceneActivation } from './persistent-scene-activation';
import { withRendererStateRestored } from './renderer-state-transaction';
import {
  createRetainedFontFixtureController,
  type LiveFontFixtureUpdate,
  type RetainedFontFixtureController,
} from './retained-font-fixture';
import { renderFlatSlugCpuReference } from '../benchmark/low-level/raster/slug-cpu-reference';
import type {
  SlugAffineRoleSceneDefinition,
  SlugProjectionZoomSceneDefinition,
  SlugRoleSceneDefinition,
} from './slug-role-scenes';
import {
  captureSourceOutlineFidelity,
  type SourceOutlineFidelityCapture,
} from '../benchmark/low-level/raster/source-outline-reference';
import { compactRgba8Readback } from '../benchmark/low-level/raster/rgba-readback';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from './webgpu-renderer';

const WIDTH = 512;
const FLAT_CONFORMANCE_HEIGHT = 512;

export { preloadSlugFontAssets } from '../workloads/font-assets/slug';
export type { BakedSlugArtifactSource as SlugBakedArtifactSource } from '../workloads/font-assets/slug';

export interface SlugRasterConfiguration {
  readonly planeUnitsPerEm: number;
  readonly pageCount: number;
  readonly curveTexelCount: number;
  readonly curveGpuBytes: number;
  readonly headerCount: number;
  readonly headerGpuBytes: number;
  readonly referenceCount: number;
  readonly referenceGpuBytes: number;
  readonly gpuBytes: number;
}

export interface SlugTextConformanceCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly meanAbsoluteError: number;
  readonly maximumError: number;
  readonly errorPixels: number;
  readonly severeErrorPixels: number;
  readonly glyphCount: number;
  readonly evaluatedCurves: number;
  readonly viewportClipped: boolean;
  readonly renderSubmitMs: number;
}

export interface SlugRoleSceneCapture {
  readonly scene: SlugRoleSceneDefinition;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly cpuReference: Uint8Array;
  readonly sourceReference: Uint8Array;
  readonly cpuMeanAbsoluteError: number;
  readonly cpuMaximumError: number;
  readonly cpuErrorPixels: number;
  readonly cpuSevereErrorPixels: number;
  readonly sourceMeanAbsoluteError: number;
  readonly sourceMaximumError: number;
  readonly sourceErrorPixels: number;
  readonly glyphCount: number;
  readonly evaluatedCurves: number;
  readonly boundaryInkPixels: number;
  readonly viewportClipped: boolean;
  readonly renderSubmitMs: number;
}

export interface SlugAffineRoleSceneCapture {
  readonly scene: SlugAffineRoleSceneDefinition;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly sourceReference: Uint8Array;
  readonly sourceMeanAbsoluteError: number;
  readonly sourceMaximumError: number;
  readonly sourceErrorPixels: number;
  readonly boundaryInkPixels: number;
  readonly renderSubmitMs: number;
}

export interface SlugProjectionZoomCapture {
  readonly zoom: 1 | 8;
  readonly candidate: Uint8Array;
  readonly sourceReference: Uint8Array;
  readonly sourceMeanAbsoluteError: number;
  readonly sourceMaximumError: number;
  readonly sourceErrorPixels: number;
  readonly fringeWidth: number;
  readonly fringeSampleY: number;
  readonly fringeInkMinX: number;
  readonly fringeInkMaxX: number;
  readonly leftFringeWidth: number;
  readonly rightFringeWidth: number;
  readonly inkPixels: number;
  readonly renderSubmitMs: number;
}

export interface SlugProjectionZoomRoleSceneCapture {
  readonly scene: SlugProjectionZoomSceneDefinition;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly captures: readonly [SlugProjectionZoomCapture, SlugProjectionZoomCapture];
}

interface FlatSlugConformanceResources {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly ownedRenderer?: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly font: RegisteredFont;
  readonly line: Text;
  readonly resource: SlugResource;
  readonly sourceTypes?: SlugRasterSourceTypes;
}

export interface SlugRasterSourceTypes {
  readonly raster: 'embedded' | 'external';
  readonly curve: 'bufferView' | 'external';
  readonly headers: 'bufferView' | 'external';
  readonly references: 'bufferView' | 'external';
}

export interface SlugExternalRenderParityCapture {
  readonly backend: RendererBackend;
  readonly width: number;
  readonly height: number;
  readonly embedded: Uint8Array;
  readonly external: Uint8Array;
  readonly externalSourceTypes: SlugRasterSourceTypes;
  readonly embeddedGlyphCount: number;
  readonly externalGlyphCount: number;
  readonly embeddedEvaluatedCurves: number;
  readonly externalEvaluatedCurves: number;
  readonly embeddedRenderSubmitMs: number;
  readonly externalRenderSubmitMs: number;
}

export interface SlugTextLiveStats {
  readonly technique: 'slug';
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly renderedPpem: number;
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
  readonly slugPageCount: number;
  readonly slugCurveTexelCount: number;
  readonly slugCurveGpuBytes: number;
  readonly slugHeaderCount: number;
  readonly slugHeaderGpuBytes: number;
  readonly slugReferenceCount: number;
  readonly slugReferenceGpuBytes: number;
  readonly slugGpuBytes: number;
  readonly atlasGpuBytes: number;
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

export interface SlugTextPreviewUpdate extends LiveFontFixtureUpdate {
  readonly anchor: LiveTextAnchor;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
  readonly fontSize: number;
  readonly language: string;
  readonly layoutWidthRatio: number;
  readonly text: string;
  readonly textAlign: 'start' | 'center';
}

export interface SlugTextPreview {
  resize(width: number, height: number): void;
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(update: SlugTextPreviewUpdate): Promise<void>;
  dispose(): Promise<void>;
}

export function createSlugConformanceTarget(backend: RendererBackend): BenchmarkTarget {
  let resources: FlatSlugConformanceResources | undefined;
  let fontFixture: BenchmarkFontFixture = 'inter';
  return {
    id: `slug-conformance-${backend}`,
    label: backend === 'webgpu' ? 'Slug sampling conformance · WebGPU' : 'Slug sampling conformance · WebGL',
    detail: 'GPU TSL candidate · independent scalar CPU reconstruction · visual difference',
    color: backend === 'webgpu' ? 'green' : 'amber',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    configure: (input) => {
      fontFixture = input.fontFixture ?? 'inter';
    },
    status: () => 'ready',
    load: async (controls, context) => {
      resources ??= await createFlatSlugConformanceResources(
        backend,
        controls.dpr,
        fontFixture,
        context?.signal,
        'baked',
        undefined,
        undefined,
        undefined,
        context?.renderer,
      );
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (resources === undefined) throw new Error('Slug conformance target was not loaded');
      const capture = await captureFlatSlugConformance(resources);
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: resources.dpr,
          fixtureIsInter: fontFixture === 'inter' ? 1 : 0,
          fixtureIsDotGothic: fontFixture === 'dot-gothic-16' ? 1 : 0,
          pixelCount: capture.width * capture.height,
          glyphCount: capture.glyphCount,
          evaluatedCurves: capture.evaluatedCurves,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          severeErrorPixels: capture.severeErrorPixels,
          renderMs: capture.renderSubmitMs,
        },
      };
    },
    dispose: async () => {
      const current = resources;
      resources = undefined;
      if (current !== undefined) await disposeFlatSlugConformanceResources(current);
    },
  };
}

interface SlugTextPersistentSceneOptions {
  readonly anchor?: LiveTextAnchor;
  readonly backend: RendererBackend;
  readonly direction?: 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
  readonly fontSize: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly delivery?: FontDelivery;
  readonly showGrid: boolean;
  readonly language?: string;
  readonly layoutWidthRatio: number;
  readonly text: string;
  readonly textAlign?: 'start' | 'center';
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: SlugTextLiveStats) => void;
  readonly onBakeProgress?: BakeProgressListener;
}

interface SlugPersistentFontFixture {
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  readonly loaded: Awaited<ReturnType<typeof loadSlugFont>>;
  readonly rasterConfiguration: SlugRasterConfiguration;
}

export interface SlugTextPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(update: SlugTextPreviewUpdate): Promise<void>;
}

export function createSlugTextPersistentScene(options: SlugTextPersistentSceneOptions): SlugTextPersistentScene {
  const {
    backend,
    onError,
    onStats,
    onBakeProgress,
    text,
    language = 'en',
    direction = 'ltr',
    features = [],
    textAlign = 'start',
    fontFixture: initialFontFixture = 'inter',
    delivery = 'baked',
  } = options;
  assertLayoutWidthRatio(options.layoutWidthRatio);
  const startupStarted = performance.now();
  let width = 0;
  let height = 0;
  let fontSize = positiveViewportSize(options.fontSize, 'Slug preview font size');
  let anchor = options.anchor ?? 'center';
  let layoutWidthRatio = options.layoutWidthRatio;
  let committedContentWidth = 0;
  let committedRasterPixelRatio = 0;
  let gridVisible = options.showGrid;
  const textUpdateTelemetry = createTextUpdateTelemetry();
  let rendererInitMs = 0;
  let textReadyMs = 0;
  let startupMs = 0;
  let firstDrawMs = 0;
  let firstDrawRecorded = false;
  const registry = new FontRegistry();
  let fontFixture: RetainedFontFixtureController<SlugPersistentFontFixture> | undefined;
  let activationSignal: AbortSignal | undefined;
  let canvasSurface: ReturnType<typeof createCanvasSurface> | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.OrthographicCamera | undefined;
  let font: RegisteredFont | undefined;
  let line: Text | undefined;
  let closing = false;
  let disposed = false;
  let updateRevision = 0;
  const activationGate = createPersistentSceneActivation<void>();

  const activeResources = (): {
    readonly canvasSurface: ReturnType<typeof createCanvasSurface>;
    readonly camera: THREE.OrthographicCamera;
    readonly line: Text;
    readonly scene: THREE.Scene;
  } => {
    if (canvasSurface === undefined || camera === undefined || line === undefined || scene === undefined) {
      throw new DOMException('The Slug preview scene is not active', 'InvalidStateError');
    }
    return { canvasSurface, camera, line, scene };
  };

  const resizeScene = (viewport: PersistentRenderViewport): void => {
    if (closing || disposed || line === undefined || camera === undefined || canvasSurface === undefined) return;
    width = positiveViewportSize(viewport.width, 'Slug preview width');
    height = positiveViewportSize(viewport.height, 'Slug preview height');
    canvasSurface.resize(width, height);
    camera.right = width;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    const nextContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
    if (nextContentWidth === committedContentWidth && viewport.dpr === committedRasterPixelRatio) {
      positionLiveLine(line, width, height, anchor, layoutWidthRatio);
      return;
    }
    const updateStartedAt = performance.now();
    const revision = ++updateRevision;
    line.setProperties({ width: nextContentWidth, rasterPixelRatio: viewport.dpr });
    const resizeScheduledAt = performance.now();
    void line.ready
      .then(() => {
        if (closing || disposed || revision !== updateRevision || line === undefined) return;
        committedContentWidth = nextContentWidth;
        committedRasterPixelRatio = viewport.dpr;
        const resizeSceneStartedAt = performance.now();
        positionLiveLine(line, width, height, anchor, layoutWidthRatio);
        const finishedAt = performance.now();
        textUpdateTelemetry.record({
          scheduleMs: resizeScheduledAt - updateStartedAt,
          readyMs: resizeSceneStartedAt - resizeScheduledAt,
          sceneMs: finishedAt - resizeSceneStartedAt,
          totalMs: finishedAt - updateStartedAt,
        });
      })
      .catch((error: unknown) => {
        if (!closing && !disposed) onError(error);
      });
  };

  return {
    id: `slug-text-preview-${backend}`,
    async activate(context) {
      if (disposed) throw new DOMException('The Slug preview scene is disposed', 'InvalidStateError');
      if (scene !== undefined) throw new DOMException('The Slug preview scene is already active', 'InvalidStateError');
      context.signal.throwIfAborted();
      activationSignal = context.signal;
      rendererInitMs = context.rendererInitMs;
      width = positiveViewportSize(context.viewport.width, 'Slug preview width');
      height = positiveViewportSize(context.viewport.height, 'Slug preview height');
      committedContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
      committedRasterPixelRatio = context.viewport.dpr;
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000);
      camera.position.z = 500;
      camera.updateProjectionMatrix();
      // CanvasSurface consumes only render-state methods; the host still withholds renderer lifecycle ownership.
      canvasSurface = createCanvasSurface(context.renderer as THREE.WebGPURenderer, width, height, gridVisible);
      const fontStarted = performance.now();
      const loaded = await loadSlugFont(context.signal, initialFontFixture, delivery, onBakeProgress, registry);
      font = loaded.font;
      const fontLoadMs = performance.now() - fontStarted;
      context.signal.throwIfAborted();
      const rasterConfiguration = await registeredSlugConfiguration(font, context.signal);
      fontFixture = createRetainedFontFixtureController(registry, {
        fixture: initialFontFixture,
        asset: { font, fontLoadMs, loaded, rasterConfiguration },
      });
      const textStarted = performance.now();
      line = new Text({
        text,
        font,
        raster: loaded.raster,
        fontSize,
        rasterPixelRatio: context.viewport.dpr,
        lineHeight: LIVE_TEXT_LINE_HEIGHT,
        width: committedContentWidth,
        wrap: 'word',
        language,
        direction,
        features,
        textAlign,
        color: LIVE_TEXT_COLOR,
      });
      const scheduledAt = performance.now();
      await line.ready;
      updateSlugDrawVisibility(line);
      const readyAt = performance.now();
      context.signal.throwIfAborted();
      textReadyMs = performance.now() - textStarted;
      const sceneStartedAt = performance.now();
      positionLiveLine(line, width, height, anchor, layoutWidthRatio);
      scene.add(line);
      const sceneFinishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: scheduledAt - textStarted,
        readyMs: readyAt - scheduledAt,
        sceneMs: sceneFinishedAt - sceneStartedAt,
        totalMs: sceneFinishedAt - textStarted,
      });
      startupMs = performance.now() - startupStarted;
      activationGate.resolve();
    },
    frame() {
      if (closing || disposed) return;
      const active = activeResources();
      const startedAt = performance.now();
      updateSlugDrawVisibility(active.line);
      active.canvasSurface.render(active.scene, active.camera);
      if (!firstDrawRecorded) {
        firstDrawMs = performance.now() - startedAt;
        firstDrawRecorded = true;
      }
    },
    telemetry(snapshot, viewport) {
      if (closing || disposed || fontFixture === undefined || line === undefined) return;
      const currentFontFixture = fontFixture.current.asset;
      const layout = committedLayout(line);
      const framebufferGpuBytes = viewport.drawingBufferWidth * viewport.drawingBufferHeight * 4;
      onStats({
        technique: 'slug',
        backend,
        dpr: viewport.dpr,
        renderedPpem: fontSize * viewport.dpr,
        showGrid: gridVisible,
        ...snapshot,
        glyphCount: renderedGlyphCount(line),
        missingGlyphCount: missingGlyphCount(layout),
        drawCount: drawCount(line),
        layoutWidth: layout.width,
        layoutHeight: layout.height,
        lineCount: layout.lineGlyphCounts.length,
        slugPageCount: currentFontFixture.rasterConfiguration.pageCount,
        slugCurveTexelCount: currentFontFixture.rasterConfiguration.curveTexelCount,
        slugCurveGpuBytes: currentFontFixture.rasterConfiguration.curveGpuBytes,
        slugHeaderCount: currentFontFixture.rasterConfiguration.headerCount,
        slugHeaderGpuBytes: currentFontFixture.rasterConfiguration.headerGpuBytes,
        slugReferenceCount: currentFontFixture.rasterConfiguration.referenceCount,
        slugReferenceGpuBytes: currentFontFixture.rasterConfiguration.referenceGpuBytes,
        slugGpuBytes: currentFontFixture.rasterConfiguration.gpuBytes,
        atlasGpuBytes: currentFontFixture.rasterConfiguration.gpuBytes,
        framebufferGpuBytes,
        totalGpuBytes: currentFontFixture.rasterConfiguration.gpuBytes + framebufferGpuBytes,
        artifactBytes: currentFontFixture.loaded.compressedBytes,
        delivery,
        sourceFontBytes: currentFontFixture.loaded.metrics.sourceFontBytes,
        coreArtifactBytes: currentFontFixture.loaded.metrics.coreArtifactBytes,
        coreBakeMs: currentFontFixture.loaded.metrics.coreBakeMs,
        rasterArtifactBytes: currentFontFixture.loaded.metrics.rasterArtifactBytes,
        rasterBakeMs: currentFontFixture.loaded.metrics.rasterBakeMs,
        rendererInitMs,
        fontLoadMs: currentFontFixture.fontLoadMs,
        textReadyMs,
        firstDrawMs,
        startupMs,
        gpuTimingSupported: snapshot.gpuHistoryLength > 0,
        textUpdateTimings: textUpdateTelemetry.summary(),
      });
    },
    resize: resizeScene,
    panBy(deltaX, deltaY) {
      if (closing || disposed) return;
      const activeScene = activeResources().scene;
      activeScene.position.x += finiteCanvasDelta(deltaX, 'Slug preview horizontal pan');
      activeScene.position.y -= finiteCanvasDelta(deltaY, 'Slug preview vertical pan');
    },
    resetView() {
      if (closing || disposed) return;
      activeResources().scene.position.set(0, 0, 0);
    },
    setGridVisible(visible) {
      if (closing || disposed) return;
      gridVisible = visible;
      activeResources().canvasSurface.setGridVisible(visible);
    },
    async update(next) {
      await activationGate.wait();
      if (closing || disposed) throw new DOMException('The Slug preview is disposed', 'AbortError');
      const activeLine = activeResources().line;
      const activeFontFixture = fontFixture;
      const signal = activationSignal;
      if (activeFontFixture === undefined || signal === undefined) {
        throw new DOMException('The Slug preview scene is not active', 'InvalidStateError');
      }
      const updateStartedAt = performance.now();
      const nextFontSize = positiveViewportSize(next.fontSize, 'Slug preview font size');
      assertLayoutWidthRatio(next.layoutWidthRatio);
      const revision = ++updateRevision;
      const nextContentWidth = benchmarkContentWidth(width, next.layoutWidthRatio);
      let updateScheduledAt = updateStartedAt;
      await activeFontFixture.update({
        fixture: next.fontFixture ?? activeFontFixture.current.fixture,
        isCurrent: () => !closing && !disposed && revision === updateRevision,
        load: async (fixture, fixtureRegistry) => {
          const fontStartedAt = performance.now();
          const loaded = await loadSlugFont(signal, fixture, delivery, onBakeProgress, fixtureRegistry);
          try {
            const rasterConfiguration = await registeredSlugConfiguration(loaded.font, signal);
            return { font: loaded.font, fontLoadMs: performance.now() - fontStartedAt, loaded, rasterConfiguration };
          } catch (error) {
            if (loaded.font !== activeFontFixture.current.asset.font) loaded.font.dispose();
            throw error;
          }
        },
        commit: async (fixture) => {
          updateScheduledAt = performance.now();
          const replacingFont = fixture.font !== activeFontFixture.current.asset.font;
          if (replacingFont || next.text.length === 0) activeLine.visible = false;
          activeLine.setProperties({
            text: next.text,
            font: fixture.font,
            raster: fixture.loaded.raster,
            fontSize: nextFontSize,
            width: nextContentWidth,
            language: next.language,
            direction: next.direction,
            features: next.features,
            textAlign: next.textAlign,
          });
          if (!replacingFont) updateSlugDrawVisibility(activeLine);
          await activeLine.ready;
          updateSlugDrawVisibility(activeLine);
          fontSize = nextFontSize;
          anchor = next.anchor;
          layoutWidthRatio = next.layoutWidthRatio;
          committedContentWidth = nextContentWidth;
          positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio);
        },
      });
      if (closing || disposed || revision !== updateRevision) {
        throw new DOMException('The Slug preview update was superseded', 'AbortError');
      }
      const updateSceneStartedAt = performance.now();
      positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio);
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: updateScheduledAt - updateStartedAt,
        readyMs: updateSceneStartedAt - updateScheduledAt,
        sceneMs: finishedAt - updateSceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
    },
    deactivate() {
      if (disposed) return;
      closing = true;
      disposed = true;
      if (line === undefined) {
        activationGate.reject(new DOMException('The Slug persistent scene was deactivated', 'AbortError'));
      }
      updateRevision += 1;
      line?.dispose();
      if (fontFixture === undefined) font?.dispose();
      else fontFixture.dispose();
      canvasSurface?.dispose();
      line = undefined;
      font = undefined;
      fontFixture = undefined;
      activationSignal = undefined;
      canvasSurface = undefined;
      camera = undefined;
      scene = undefined;
    },
  };
}

export async function createSlugTextPreview(options: {
  readonly anchor?: LiveTextAnchor;
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly direction?: 'ltr' | 'rtl';
  readonly dpr: number;
  readonly features?: readonly FontFeature[];
  readonly fontSize: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly delivery?: FontDelivery;
  readonly height: number;
  readonly showGrid: boolean;
  readonly language?: string;
  readonly layoutWidth: number;
  readonly layoutWidthRatio?: number;
  readonly signal?: AbortSignal;
  readonly text: string;
  readonly textAlign?: 'start' | 'center';
  readonly width: number;
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: SlugTextLiveStats) => void;
  readonly onBakeProgress?: BakeProgressListener;
}): Promise<SlugTextPreview> {
  options.signal?.throwIfAborted();
  const width = positiveViewportSize(options.width, 'Slug preview width');
  const height = positiveViewportSize(options.height, 'Slug preview height');
  const layoutWidthRatio = options.layoutWidthRatio ?? options.layoutWidth / width;
  assertLayoutWidthRatio(layoutWidthRatio);
  const scene = createSlugTextPersistentScene({
    anchor: options.anchor ?? 'center',
    backend: options.backend,
    direction: options.direction ?? 'ltr',
    features: options.features ?? [],
    fontSize: options.fontSize,
    fontFixture: options.fontFixture ?? 'inter',
    delivery: options.delivery ?? 'baked',
    showGrid: options.showGrid,
    language: options.language ?? 'en',
    layoutWidthRatio,
    text: options.text,
    textAlign: options.textAlign ?? 'start',
    onError: options.onError,
    onStats: options.onStats,
    ...(options.onBakeProgress === undefined ? {} : { onBakeProgress: options.onBakeProgress }),
  });
  const host = await createPersistentRenderHost({
    backend: options.backend,
    canvas: options.canvas,
    dpr: options.dpr,
    height,
    width,
    onError: options.onError,
  });
  try {
    const lease = await host.replaceScene(scene, options.signal);
    let disposal: Promise<void> | undefined;
    return {
      resize(nextWidth, nextHeight) {
        host.resize(nextWidth, nextHeight);
      },
      panBy: (deltaX, deltaY) => scene.panBy(deltaX, deltaY),
      resetView: () => scene.resetView(),
      setGridVisible: (visible) => scene.setGridVisible(visible),
      update: (update) => scene.update(update),
      dispose() {
        disposal ??= (async () => {
          try {
            await lease.release();
          } finally {
            await host.dispose();
          }
        })();
        return disposal;
      },
    };
  } catch (error) {
    await host.dispose();
    throw error;
  }
}

export async function captureSlugTextConformance(options: {
  readonly backend: RendererBackend;
  readonly bakedArtifact?: SlugBakedArtifactSource;
  readonly delivery?: FontDelivery;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SlugTextConformanceCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
    options.delivery,
    options.bakedArtifact,
    undefined,
    undefined,
    options.renderer,
  );
  try {
    options.signal?.throwIfAborted();
    const capture = await captureFlatSlugConformance(resources);
    options.signal?.throwIfAborted();
    return capture;
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugExternalRenderParity(options: {
  readonly backend: RendererBackend;
  readonly externalArtifactUrl: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<SlugExternalRenderParityCapture> {
  const embeddedResources = await createFlatSlugConformanceResources(options.backend, 1, 'inter', options.signal);
  let externalResources: FlatSlugConformanceResources | undefined;
  try {
    externalResources = await createFlatSlugConformanceResources(
      options.backend,
      1,
      'inter',
      options.signal,
      'baked',
      undefined,
      undefined,
      (signal) => loadExternalSlugFont(options.externalArtifactUrl, options.fetch, signal),
    );
    const [embedded, external] = await Promise.all([
      captureFlatSlugConformance(embeddedResources),
      captureFlatSlugConformance(externalResources),
    ]);
    if (embedded.width !== external.width || embedded.height !== external.height) {
      throw new Error('Embedded and external Slug parity scenes have different dimensions');
    }
    return {
      backend: options.backend,
      width: embedded.width,
      height: embedded.height,
      embedded: embedded.candidate,
      external: external.candidate,
      externalSourceTypes: requireExternalSlugSources(externalResources.sourceTypes),
      embeddedGlyphCount: embedded.glyphCount,
      externalGlyphCount: external.glyphCount,
      embeddedEvaluatedCurves: embedded.evaluatedCurves,
      externalEvaluatedCurves: external.evaluatedCurves,
      embeddedRenderSubmitMs: embedded.renderSubmitMs,
      externalRenderSubmitMs: external.renderSubmitMs,
    };
  } finally {
    if (externalResources !== undefined) {
      await disposeFlatSlugConformanceResources(externalResources);
    }
    await disposeFlatSlugConformanceResources(embeddedResources);
  }
}

export async function captureSlugSourceOutlineFidelity(options: {
  readonly backend: RendererBackend;
  readonly bakedArtifact?: SlugBakedArtifactSource;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
    'baked',
    options.bakedArtifact,
    undefined,
    undefined,
    options.renderer,
  );
  try {
    const capture = await captureFlatSlugConformance(resources);
    const specimen = rasterConformanceSpecimen(options.fontFixture);
    options.signal?.throwIfAborted();
    return await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: 64 / options.dpr,
      direction: specimen.direction,
      layout: committedLayout(resources.line),
      originX: resources.line.position.x,
      originY: resources.line.position.y,
      text: specimen.text,
      renderSubmitMs: capture.renderSubmitMs,
    });
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugRoleScene(options: {
  readonly backend: RendererBackend;
  readonly dpr: 1 | 2;
  readonly scene: SlugRoleSceneDefinition;
  readonly signal?: AbortSignal;
}): Promise<SlugRoleSceneCapture> {
  const { dpr, scene } = options;
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    dpr,
    scene.fontFixture,
    options.signal,
    'baked',
    undefined,
    {
      width: scene.physicalWidth / dpr,
      height: scene.physicalHeight / dpr,
      fontSize: scene.physicalPpem / dpr,
      layoutWidth: scene.physicalLayoutWidth / dpr,
      originX: scene.physicalOriginX / dpr,
      originY: scene.physicalOriginY / dpr,
      text: scene.text,
      language: scene.language,
      direction: scene.direction,
    },
  );
  try {
    options.signal?.throwIfAborted();
    const cpuCapture = await captureFlatSlugConformance(resources);
    const sourceCapture = await captureSourceOutlineFidelity({
      candidate: cpuCapture.candidate,
      width: cpuCapture.width,
      height: cpuCapture.height,
      dpr,
      fontFixture: scene.fontFixture,
      fontSize: scene.physicalPpem / dpr,
      direction: scene.direction,
      layout: committedLayout(resources.line),
      originX: scene.physicalOriginX / dpr,
      originY: scene.physicalOriginY / dpr,
      text: scene.text,
      renderSubmitMs: cpuCapture.renderSubmitMs,
    });
    return {
      scene,
      dpr,
      width: cpuCapture.width,
      height: cpuCapture.height,
      candidate: cpuCapture.candidate,
      cpuReference: cpuCapture.reference,
      sourceReference: sourceCapture.reference,
      cpuMeanAbsoluteError: cpuCapture.meanAbsoluteError,
      cpuMaximumError: cpuCapture.maximumError,
      cpuErrorPixels: cpuCapture.errorPixels,
      cpuSevereErrorPixels: cpuCapture.severeErrorPixels,
      sourceMeanAbsoluteError: sourceCapture.meanAbsoluteError,
      sourceMaximumError: sourceCapture.maximumError,
      sourceErrorPixels: sourceCapture.errorPixels,
      glyphCount: cpuCapture.glyphCount,
      evaluatedCurves: cpuCapture.evaluatedCurves,
      boundaryInkPixels: countBoundaryInkPixels(cpuCapture.candidate, cpuCapture.width, cpuCapture.height),
      viewportClipped: cpuCapture.viewportClipped,
      renderSubmitMs: cpuCapture.renderSubmitMs,
    };
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugAffineRoleScene(options: {
  readonly backend: RendererBackend;
  readonly dpr: 1 | 2;
  readonly scene: SlugAffineRoleSceneDefinition;
  readonly signal?: AbortSignal;
}): Promise<SlugAffineRoleSceneCapture> {
  const { dpr, scene } = options;
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    dpr,
    scene.fontFixture,
    options.signal,
    'baked',
    undefined,
    {
      width: scene.physicalWidth / dpr,
      height: scene.physicalHeight / dpr,
      fontSize: scene.physicalPpem / dpr,
      layoutWidth: scene.physicalLayoutWidth / dpr,
      originX: 0,
      originY: 0,
      text: scene.text,
      language: scene.language,
      direction: scene.direction,
    },
  );
  try {
    const positionX = scene.physicalPositionX / dpr;
    const positionY = scene.physicalPositionY / dpr;
    resources.line.position.set(positionX, positionY, 0);
    resources.line.rotation.z = scene.rotationRadians;
    resources.line.scale.set(scene.scaleX, scene.scaleY, 1);
    resources.line.updateMatrixWorld(true);
    const capture = await captureFlatSlugCandidate(resources);
    const cosine = Math.cos(scene.rotationRadians);
    const sine = Math.sin(scene.rotationRadians);
    const source = await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr,
      fontFixture: scene.fontFixture,
      fontSize: scene.physicalPpem / dpr,
      direction: scene.direction,
      layout: committedLayout(resources.line),
      originX: 0,
      originY: 0,
      text: scene.text,
      renderSubmitMs: capture.renderSubmitMs,
      transform: {
        a: cosine * scene.scaleX,
        b: -sine * scene.scaleX,
        c: sine * scene.scaleY,
        d: cosine * scene.scaleY,
        e: positionX,
        f: -positionY,
      },
    });
    return {
      scene,
      dpr,
      width: capture.width,
      height: capture.height,
      candidate: capture.candidate,
      sourceReference: source.reference,
      sourceMeanAbsoluteError: source.meanAbsoluteError,
      sourceMaximumError: source.maximumError,
      sourceErrorPixels: source.errorPixels,
      boundaryInkPixels: countBoundaryInkPixels(capture.candidate, capture.width, capture.height),
      renderSubmitMs: capture.renderSubmitMs,
    };
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugProjectionZoomRoleScene(options: {
  readonly backend: RendererBackend;
  readonly dpr: 1 | 2;
  readonly scene: SlugProjectionZoomSceneDefinition;
  readonly signal?: AbortSignal;
}): Promise<SlugProjectionZoomRoleSceneCapture> {
  const { dpr, scene } = options;
  const logicalWidth = scene.physicalWidth / dpr;
  const logicalHeight = scene.physicalHeight / dpr;
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    dpr,
    scene.fontFixture,
    options.signal,
    'baked',
    undefined,
    {
      width: logicalWidth,
      height: logicalHeight,
      fontSize: scene.physicalPpem / dpr,
      layoutWidth: logicalWidth,
      originX: 0,
      originY: 0,
      text: scene.text,
      language: 'en',
      direction: 'ltr',
    },
  );
  try {
    const layout = committedLayout(resources.line);
    const zeroOriginReference = renderFlatSlugCpuReference(resources.resource, layout, {
      width: scene.physicalWidth,
      height: scene.physicalHeight,
      dpr,
    });
    const bounds = zeroOriginReference.unclippedBounds;
    if (bounds === undefined) throw new Error('Slug projection zoom scene contains no glyph bounds');
    const originX = (scene.physicalWidth / 2 - (bounds.minX + bounds.maxX + 1) / 2) / dpr;
    const originY = -((scene.physicalHeight / 2 - (bounds.minY + bounds.maxY + 1) / 2) / dpr);
    resources.line.position.set(originX, originY, 0);
    const captureAtZoom = async (zoom: 1 | 8): Promise<SlugProjectionZoomCapture> => {
      resources.camera.zoom = zoom;
      resources.camera.updateProjectionMatrix();
      const capture = await captureFlatSlugCandidate(resources);
      const source = await captureSourceOutlineFidelity({
        candidate: capture.candidate,
        width: capture.width,
        height: capture.height,
        dpr,
        fontFixture: scene.fontFixture,
        fontSize: scene.physicalPpem / dpr,
        direction: 'ltr',
        layout,
        originX,
        originY,
        text: scene.text,
        renderSubmitMs: capture.renderSubmitMs,
        transform: {
          a: zoom,
          b: 0,
          c: 0,
          d: zoom,
          e: (logicalWidth * (1 - zoom)) / 2,
          f: (logicalHeight * (1 - zoom)) / 2,
        },
      });
      const fringe = horizontalFringeAtCenter(capture.candidate, capture.width, capture.height);
      return {
        zoom,
        candidate: capture.candidate,
        sourceReference: source.reference,
        sourceMeanAbsoluteError: source.meanAbsoluteError,
        sourceMaximumError: source.maximumError,
        sourceErrorPixels: source.errorPixels,
        fringeWidth: fringe.maximumPartialCoverageRun,
        fringeSampleY: fringe.sampleY,
        fringeInkMinX: fringe.inkMinX,
        fringeInkMaxX: fringe.inkMaxX,
        leftFringeWidth: fringe.leftPartialCoverageWidth,
        rightFringeWidth: fringe.rightPartialCoverageWidth,
        inkPixels: countInkPixels(capture.candidate),
        renderSubmitMs: capture.renderSubmitMs,
      };
    };
    // Both captures share one camera, render target, and renderer; the first readback must finish before changing zoom.
    const one = await captureAtZoom(scene.zooms[0]);
    const eight = await captureAtZoom(scene.zooms[1]);
    return {
      scene,
      dpr,
      width: scene.physicalWidth,
      height: scene.physicalHeight,
      captures: [one, eight],
    };
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

interface FlatSlugSceneOptions {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly layoutWidth: number;
  readonly originX: number;
  readonly originY: number;
  readonly text: string;
  readonly spans?: readonly TextSpan[];
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

async function createFlatSlugConformanceResources(
  backend: RendererBackend,
  dpr: number,
  fontFixture: BenchmarkFontFixture = 'inter',
  signal?: AbortSignal,
  delivery: FontDelivery = 'baked',
  bakedArtifact?: SlugBakedArtifactSource,
  sceneOptions?: FlatSlugSceneOptions,
  loadFont?: (signal?: AbortSignal) => Promise<{
    readonly font: RegisteredFont;
    readonly raster: SlugModule;
  }>,
  borrowedRenderer?: PersistentRenderSceneRenderer,
): Promise<FlatSlugConformanceResources> {
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          width: sceneOptions?.width ?? WIDTH,
          height: sceneOptions?.height ?? FLAT_CONFORMANCE_HEIGHT,
          backend,
          dpr,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  let target: THREE.RenderTarget | undefined;
  let font: RegisteredFont | undefined;
  let line: Text | undefined;
  let resource: SlugResource | undefined;
  try {
    const loaded =
      loadFont === undefined
        ? bakedArtifact === undefined
          ? await loadSlugFont(signal, fontFixture, delivery)
          : await loadSlugBakedArtifact(bakedArtifact, signal)
        : await loadFont(signal);
    font = loaded.font;
    const rasterKey = await slugDescriptorRasterKey();
    const specimen = sceneOptions ?? rasterConformanceSpecimen(fontFixture);
    line = new Text({
      text: specimen.text,
      ...(sceneOptions?.spans === undefined ? {} : { spans: sceneOptions.spans }),
      font,
      raster: loaded.raster,
      fontSize: sceneOptions?.fontSize ?? 64 / dpr,
      rasterPixelRatio: dpr,
      lineHeight: 1.2,
      width: sceneOptions?.layoutWidth ?? 476,
      wrap: 'word',
      color: 0xffffff,
      language: specimen.language,
      direction: specimen.direction,
      textAlign: 'start',
    });
    await line.ready;
    const conformanceMissingGlyphCount = committedLayout(line).glyphIds.reduce(
      (count, glyphId) => count + (glyphId === 0 ? 1 : 0),
      0,
    );
    if (conformanceMissingGlyphCount !== 0) {
      throw new Error(
        `${fontFixture} Slug conformance specimen contains ${String(conformanceMissingGlyphCount)} missing glyphs`,
      );
    }
    const raster = await font.loadRaster({ rasterKey, kind: slug.kind }, signal === undefined ? undefined : { signal });
    const sourceTypes =
      loadFont === undefined ? undefined : slugRasterSourceTypes(font, rasterKey, raster.extensionData);
    resource = await loaded.raster.decode(font, raster, signal);
    signal?.throwIfAborted();
    line.position.set(sceneOptions?.originX ?? 18, sceneOptions?.originY ?? -18, 0);
    const scene = new THREE.Scene();
    scene.add(line);
    const logicalWidth = sceneOptions?.width ?? WIDTH;
    const logicalHeight = sceneOptions?.height ?? FLAT_CONFORMANCE_HEIGHT;
    const camera = new THREE.OrthographicCamera(0, logicalWidth, 0, -logicalHeight, 0.1, 1_000);
    camera.position.z = 500;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(Math.round(logicalWidth * dpr), Math.round(logicalHeight * dpr), {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    return {
      backend,
      dpr,
      fontFixture,
      renderer,
      ...(ownedRenderer === undefined ? {} : { ownedRenderer }),
      target,
      scene,
      camera,
      font,
      line,
      resource,
      ...(sourceTypes === undefined ? {} : { sourceTypes }),
    };
  } catch (error) {
    line?.dispose();
    if (resource !== undefined) slug.dispose(resource);
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

async function loadExternalSlugFont(
  artifactUrl: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ readonly font: RegisteredFont; readonly raster: SlugModule }> {
  signal?.throwIfAborted();
  const loader = new FontLoader({ fetch: fetcher });
  const font = await loader.load({ baked: artifactUrl }, signal === undefined ? undefined : { signal });
  return { font, raster: slug };
}

function slugRasterSourceTypes(font: RegisteredFont, rasterKey: string, extensionData: unknown): SlugRasterSourceTypes {
  const reference = font.rasterReferences.find((candidate) => candidate.rasterKey === rasterKey);
  if (reference === undefined) throw new Error('Slug raster reference disappeared after loading');
  const extension = nonArrayObject(extensionData, 'Slug extension');
  if (!Array.isArray(extension.pages) || extension.pages.length !== 1) {
    throw new TypeError('Slug external parity requires exactly one Inter page');
  }
  const page = nonArrayObject(extension.pages[0], 'Slug page');
  const curve = nonArrayObject(page.curve, 'Slug curve');
  if (!Array.isArray(curve.variants) || curve.variants.length !== 1) {
    throw new TypeError('Slug external parity requires exactly one curve variant');
  }
  const curveVariant = nonArrayObject(curve.variants[0], 'Slug curve variant');
  const headerResource = nonArrayObject(page.headerResource, 'Slug header resource');
  const referenceResource = nonArrayObject(page.referenceResource, 'Slug reference resource');
  return {
    raster: reference.source.type,
    curve: resourceSourceType(curveVariant.source, 'Slug curve source'),
    headers: resourceSourceType(headerResource.source, 'Slug header source'),
    references: resourceSourceType(referenceResource.source, 'Slug reference source'),
  };
}

function requireExternalSlugSources(sourceTypes: SlugRasterSourceTypes | undefined): SlugRasterSourceTypes {
  if (
    sourceTypes === undefined ||
    sourceTypes.raster !== 'external' ||
    sourceTypes.curve !== 'external' ||
    sourceTypes.headers !== 'external' ||
    sourceTypes.references !== 'external'
  ) {
    throw new Error(`Slug parity resource was not fully external: ${JSON.stringify(sourceTypes)}`);
  }
  return sourceTypes;
}

function resourceSourceType(value: unknown, label: string): 'bufferView' | 'external' {
  const source = nonArrayObject(value, label);
  if (source.type !== 'bufferView' && source.type !== 'external') {
    throw new TypeError(`${label} has an invalid type`);
  }
  return source.type;
}

function nonArrayObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function captureFlatSlugConformance(
  resources: FlatSlugConformanceResources,
): Promise<SlugTextConformanceCapture> {
  const { candidate, width, height, renderSubmitMs } = await captureFlatSlugCandidate(resources);
  const referenceResult = renderFlatSlugCpuReference(resources.resource, committedLayout(resources.line), {
    width,
    height,
    dpr: resources.dpr,
    originX: resources.line.position.x,
    originY: resources.line.position.y,
  });
  const reference = referenceResult.pixels;
  const comparison = compareRgba8Coverage(candidate, reference);
  const viewportClipped =
    referenceResult.unclippedBounds !== undefined &&
    (referenceResult.unclippedBounds.minX < 0 ||
      referenceResult.unclippedBounds.minY < 0 ||
      referenceResult.unclippedBounds.maxX >= width ||
      referenceResult.unclippedBounds.maxY >= height);
  return {
    width,
    height,
    candidate,
    reference,
    difference: comparison.heatmap,
    meanAbsoluteError: comparison.meanAbsoluteError,
    maximumError: comparison.maximumError,
    errorPixels: comparison.errorPixels,
    severeErrorPixels: comparison.severeErrorPixels,
    glyphCount: referenceResult.glyphCount,
    evaluatedCurves: referenceResult.evaluatedCurves,
    viewportClipped,
    renderSubmitMs,
  };
}

interface FlatSlugCandidateCapture {
  readonly candidate: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly renderSubmitMs: number;
}

async function captureFlatSlugCandidate(resources: FlatSlugConformanceResources): Promise<FlatSlugCandidateCapture> {
  const width = resources.target.width;
  const height = resources.target.height;
  if (resources.ownedRenderer !== undefined) {
    const rendererViewport = readRendererViewportState(resources.ownedRenderer);
    if (rendererViewport.drawingBufferWidth !== width || rendererViewport.drawingBufferHeight !== height) {
      throw new Error(
        `Slug render target ${String(width)}x${String(height)} does not match drawing buffer ${String(rendererViewport.drawingBufferWidth)}x${String(rendererViewport.drawingBufferHeight)}`,
      );
    }
  }
  return withRendererStateRestored(resources.renderer, async () => {
    resources.renderer.setRenderTarget(resources.target);
    resources.renderer.setClearColor(0x000000, 1);
    resources.renderer.clear();
    const started = performance.now();
    resources.renderer.render(resources.scene, resources.camera);
    const renderSubmitMs = performance.now() - started;
    const readback = await resources.renderer.readRenderTargetPixelsAsync(resources.target, 0, 0, width, height);
    return {
      candidate: compactRgba8Readback(
        new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
        width,
        height,
        resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
      ),
      width,
      height,
      renderSubmitMs,
    };
  });
}

function countBoundaryInkPixels(bytes: Uint8Array, width: number, height: number): number {
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    if (pixelHasInk(bytes, x)) count += 1;
    if (height > 1 && pixelHasInk(bytes, (height - 1) * width + x)) count += 1;
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (pixelHasInk(bytes, y * width)) count += 1;
    if (width > 1 && pixelHasInk(bytes, y * width + width - 1)) count += 1;
  }
  return count;
}

function countInkPixels(bytes: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    if (bytes[offset]! > 32 || bytes[offset + 1]! > 32 || bytes[offset + 2]! > 32) count += 1;
  }
  return count;
}

interface HorizontalFringeMeasurement {
  readonly sampleY: number;
  readonly inkMinX: number;
  readonly inkMaxX: number;
  readonly leftPartialCoverageWidth: number;
  readonly rightPartialCoverageWidth: number;
  readonly maximumPartialCoverageRun: number;
}

function horizontalFringeAtCenter(bytes: Uint8Array, width: number, height: number): HorizontalFringeMeasurement {
  let maximum = 0;
  let run = 0;
  const y = Math.floor(height / 2);
  let inkMinX = width;
  let inkMaxX = -1;
  for (let x = 0; x < width; x += 1) {
    const value = bytes[(y * width + x) * 4]!;
    if (value > 8) {
      inkMinX = Math.min(inkMinX, x);
      inkMaxX = x;
    }
    if (value > 8 && value < 247) {
      run += 1;
      maximum = Math.max(maximum, run);
    } else {
      run = 0;
    }
  }
  if (inkMaxX < inkMinX) throw new Error('Slug projection zoom center row contains no ink');
  let leftPartialCoverageWidth = 0;
  for (let x = inkMinX; x <= inkMaxX; x += 1) {
    const value = bytes[(y * width + x) * 4]!;
    if (value <= 8 || value >= 247) break;
    leftPartialCoverageWidth += 1;
  }
  let rightPartialCoverageWidth = 0;
  for (let x = inkMaxX; x >= inkMinX; x -= 1) {
    const value = bytes[(y * width + x) * 4]!;
    if (value <= 8 || value >= 247) break;
    rightPartialCoverageWidth += 1;
  }
  return {
    sampleY: y,
    inkMinX,
    inkMaxX,
    leftPartialCoverageWidth,
    rightPartialCoverageWidth,
    maximumPartialCoverageRun: maximum,
  };
}

function pixelHasInk(bytes: Uint8Array, pixelIndex: number): boolean {
  const offset = pixelIndex * 4;
  return bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0;
}

async function disposeFlatSlugConformanceResources(resources: FlatSlugConformanceResources): Promise<void> {
  resources.line.dispose();
  slug.dispose(resources.resource);
  resources.font.dispose();
  resources.target.dispose();
  if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
}

export async function loadSlugFont(
  signal?: AbortSignal,
  fixture: BenchmarkFontFixture = 'inter',
  delivery: FontDelivery = 'baked',
  onProgress?: BakeProgressListener,
  registry?: FontRegistry,
): Promise<Awaited<ReturnType<typeof loadSlugFontAsset>>> {
  return loadSlugFontAsset(
    delivery === 'runtime'
      ? {
          technique: 'slug',
          fixture,
          delivery,
          ...(registry === undefined ? {} : { registry }),
          ...(signal === undefined ? {} : { signal }),
          ...(onProgress === undefined ? {} : { onProgress }),
        }
      : {
          technique: 'slug',
          fixture,
          delivery,
          ...(registry === undefined ? {} : { registry }),
          ...(signal === undefined ? {} : { signal }),
          ...(onProgress === undefined ? {} : { onProgress }),
        },
  );
}

/** Load a retained non-production Slug candidate through the ordinary registry boundary. */
export async function loadSlugBakedArtifact(
  source: SlugBakedArtifactSource,
  signal?: AbortSignal,
  registry?: FontRegistry,
): Promise<Awaited<ReturnType<typeof loadSlugFontAsset>>> {
  return loadSlugFontAsset({
    technique: 'slug',
    fixture: 'inter',
    delivery: 'baked',
    bakedArtifact: source,
    ...(registry === undefined ? {} : { registry }),
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function registeredSlugConfiguration(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<SlugRasterConfiguration> {
  const rasterKey = await slugDescriptorRasterKey();
  const raster = await font.loadRaster({ kind: slug.kind, rasterKey }, signal === undefined ? undefined : { signal });
  const resource = await slug.decode(font, raster, signal);
  try {
    return slugResourceConfiguration(resource);
  } finally {
    slug.dispose(resource);
  }
}

function slugResourceConfiguration(resource: SlugResource): SlugRasterConfiguration {
  let curveTexelCount = 0;
  let curveGpuBytes = 0;
  let headerCount = 0;
  let headerGpuBytes = 0;
  let referenceCount = 0;
  let referenceGpuBytes = 0;
  for (const page of resource.pages) {
    const curveAllocation = page.curveWidth * page.curveHeight * 8;
    const headerAllocation = page.headerWidth * page.headerHeight * 4;
    const referenceAllocation = page.referenceWidth * page.referenceHeight * 4;
    curveTexelCount += page.curveWidth * page.curveHeight;
    curveGpuBytes += curveAllocation;
    headerCount += page.headerCount;
    headerGpuBytes += headerAllocation;
    referenceCount += page.referenceCount;
    referenceGpuBytes += referenceAllocation;
  }
  const allocationTotal = curveGpuBytes + headerGpuBytes + referenceGpuBytes;
  if (allocationTotal !== resource.gpuBytes) {
    throw new Error('Slug page allocations do not match the decoded resource GPU byte total');
  }
  return {
    planeUnitsPerEm: resource.planeUnitsPerEm,
    pageCount: resource.pages.length,
    curveTexelCount,
    curveGpuBytes,
    headerCount,
    headerGpuBytes,
    referenceCount,
    referenceGpuBytes,
    gpuBytes: resource.gpuBytes,
  };
}

function positionLiveLine(
  line: Text,
  viewportWidth: number,
  viewportHeight: number,
  anchor: LiveTextAnchor = 'center',
  layoutWidthRatio = 1,
): void {
  const layout = committedLayout(line);
  const positionedWidth = anchor === 'center' ? layout.width : benchmarkContentWidth(viewportWidth, layoutWidthRatio);
  const [x, y] = liveTextPosition(anchor, viewportWidth, viewportHeight, positionedWidth, layout.height);
  line.position.set(x, y, 0);
}

function committedLayout(line: Text): ParagraphLayout {
  const layout = line.layout;
  if (layout === undefined) throw new Error('live Slug Text lost its committed layout');
  return layout;
}

function missingGlyphCount(layout: ParagraphLayout): number {
  return layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
}

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

function assertLayoutWidthRatio(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError('Slug preview layout width ratio must be in (0, 1]');
  }
}

function renderedGlyphCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount;
    }
  });
  return count;
}

function updateSlugDrawVisibility(object: THREE.Object3D): void {
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

function drawCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}
