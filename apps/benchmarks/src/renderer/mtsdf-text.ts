import { FontRegistry, Text, type FontFeature, type ParagraphLayout, type RegisteredFont } from '@pmndrs/text';
import { msdf, msdfDescriptorRasterKey, type MsdfResource } from '@pmndrs/text/raster/msdf';
import * as THREE from 'three/webgpu';

import { conformanceText, type BenchmarkFontFixture, type SelectableFontFixture } from '../benchmark/font-fixtures';
import type { BenchmarkTarget } from '../benchmark/contracts';
import type { FontDelivery } from '../benchmark/url-state';
import { createCanvasSurface, type CanvasSurface } from './canvas-surface';
import { finiteCanvasDelta } from './canvas-view';
import type { LiveFrameHistoryCursor } from './live-frame-telemetry';
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
import { compareRgba8Coverage, renderFlatMtsdfCpuReference } from '../benchmark/low-level/raster/mtsdf-cpu-reference';
import {
  captureSourceOutlineFidelity,
  type SourceOutlineFidelityCapture,
} from '../benchmark/low-level/raster/source-outline-reference';
import { compactRgba8Readback } from '../benchmark/low-level/raster/rgba-readback';
import { createConfiguredRenderer, disposeConfiguredRenderer, type RendererBackend } from './webgpu-renderer';
import {
  createPersistentRenderHost,
  type PersistentRenderScene,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from './persistent-render-host';
import { createPersistentSceneActivation } from './persistent-scene-activation';
import { withRendererStateRestored } from './renderer-state-transaction';
import { loadMtsdfFontAsset, MTSDF_FIXTURE_ARTIFACT_BYTE_LIMIT } from '../workloads/font-assets/mtsdf';

const WIDTH = 512;
const FLAT_CONFORMANCE_HEIGHT = 512;

export { preloadMtsdfFontAssets } from '../workloads/font-assets/mtsdf';

export interface MtsdfTextLiveStats {
  readonly technique: 'mtsdf';
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly rasterEmSize: number;
  readonly rasterPixelRange: number;
  readonly renderedPpem: number;
  readonly scaleRatio: number;
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

export interface MtsdfTextPreviewUpdate extends LiveFontFixtureUpdate {
  readonly anchor: LiveTextAnchor;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
  readonly fontSize: number;
  readonly language: string;
  readonly layoutWidthRatio: number;
  readonly text: string;
  readonly textAlign: 'start' | 'center';
}

export interface MtsdfTextPreview {
  resize(width: number, height: number): void;
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(update: MtsdfTextPreviewUpdate): Promise<void>;
  dispose(): Promise<void>;
}

export interface MtsdfTextPreviewOptions {
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
  readonly onStats: (stats: MtsdfTextLiveStats) => void;
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener;
}

export type MtsdfTextPersistentSceneOptions = Omit<
  MtsdfTextPreviewOptions,
  'canvas' | 'dpr' | 'height' | 'signal' | 'width'
> & {
  readonly id?: string;
};

export interface MtsdfTextPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(update: MtsdfTextPreviewUpdate): Promise<void>;
}

interface MtsdfPersistentActivation {
  readonly camera: THREE.OrthographicCamera;
  readonly canvasSurface: CanvasSurface;
  committedContentWidth: number;
  committedDpr: number;
  firstDrawMs: number;
  readonly fontFixture: RetainedFontFixtureController<MtsdfPersistentFontFixture>;
  readonly gpuTimingSupported: boolean;
  readonly line: Text;
  readonly rendererInitMs: number;
  readonly scene: THREE.Scene;
  readonly signal: AbortSignal;
  readonly startupMs: number;
  readonly textReadyMs: number;
  viewport: PersistentRenderViewport;
}

interface MtsdfPersistentFontFixture {
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  readonly loaded: Awaited<ReturnType<typeof loadMtsdfFont>>;
  readonly rasterConfiguration: MtsdfRasterConfiguration;
}

export interface MtsdfTextConformanceCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly meanAbsoluteError: number;
  readonly maximumError: number;
  readonly errorPixels: number;
  readonly glyphCount: number;
  readonly renderSubmitMs: number;
}

interface FlatMtsdfConformanceResources {
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
  readonly resource: MsdfResource;
}

export function createMtsdfConformanceTarget(backend: RendererBackend): BenchmarkTarget {
  let resources: FlatMtsdfConformanceResources | undefined;
  let fontFixture: BenchmarkFontFixture = 'inter';
  return {
    id: `mtsdf-conformance-${backend}`,
    label: backend === 'webgpu' ? 'MTSDF sampling conformance · WebGPU' : 'MTSDF sampling conformance · WebGL',
    detail: 'GPU TSL candidate · independent scalar CPU reconstruction · visual difference',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    configure: (input) => {
      fontFixture = input.fontFixture ?? 'inter';
    },
    status: () => 'ready',
    load: async (controls, context) => {
      resources ??= await createFlatMtsdfConformanceResources(
        backend,
        controls.dpr,
        fontFixture,
        context?.signal,
        'baked',
        context?.renderer,
      );
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (resources === undefined) throw new Error('MTSDF conformance target was not loaded');
      const capture = await captureFlatMtsdfConformance(resources);
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: resources.dpr,
          fixtureIsInter: fontFixture === 'inter' ? 1 : 0,
          pixelCount: capture.width * capture.height,
          glyphCount: capture.glyphCount,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          renderMs: capture.renderSubmitMs,
        },
      };
    },
    dispose: async () => {
      const current = resources;
      resources = undefined;
      if (current !== undefined) await disposeFlatMtsdfConformanceResources(current);
    },
  };
}

export function createMtsdfTextPersistentScene(options: MtsdfTextPersistentSceneOptions): MtsdfTextPersistentScene {
  let fontSize = positiveViewportSize(options.fontSize, 'MSDF preview font size');
  let anchor = options.anchor ?? 'center';
  let layoutWidthRatio = options.layoutWidthRatio ?? 1;
  if (options.layoutWidthRatio !== undefined) assertLayoutWidthRatio(options.layoutWidthRatio);
  let gridVisible = options.showGrid;
  let updateRevision = 0;
  let disposed = false;
  let activation: MtsdfPersistentActivation | undefined;
  const activationGate = createPersistentSceneActivation<MtsdfPersistentActivation>();
  const textUpdateTelemetry = createTextUpdateTelemetry();

  const active = (): MtsdfPersistentActivation => {
    if (disposed || activation === undefined) {
      throw new DOMException('The MSDF scene is not active', 'InvalidStateError');
    }
    return activation;
  };

  const applyViewport = (viewport: PersistentRenderViewport): void => {
    const resources = active();
    resources.viewport = viewport;
    resources.canvasSurface.resize(viewport.width, viewport.height);
    resources.camera.right = viewport.width;
    resources.camera.bottom = -viewport.height;
    resources.camera.updateProjectionMatrix();
    const nextContentWidth = benchmarkContentWidth(viewport.width, layoutWidthRatio);
    const pixelRatioChanged = viewport.dpr !== resources.committedDpr;
    if (nextContentWidth === resources.committedContentWidth && !pixelRatioChanged) {
      positionLiveLine(resources.line, viewport.width, viewport.height, anchor, layoutWidthRatio);
      return;
    }
    const updateStartedAt = performance.now();
    const revision = ++updateRevision;
    resources.line.setProperties({ width: nextContentWidth, rasterPixelRatio: viewport.dpr });
    const scheduledAt = performance.now();
    void resources.line.ready
      .then(() => {
        if (disposed || activation !== resources || revision !== updateRevision) return;
        resources.committedContentWidth = nextContentWidth;
        resources.committedDpr = viewport.dpr;
        const sceneStartedAt = performance.now();
        positionLiveLine(resources.line, viewport.width, viewport.height, anchor, layoutWidthRatio);
        const finishedAt = performance.now();
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - updateStartedAt,
          readyMs: sceneStartedAt - scheduledAt,
          sceneMs: finishedAt - sceneStartedAt,
          totalMs: finishedAt - updateStartedAt,
        });
      })
      .catch((error: unknown) => {
        if (!disposed && activation === resources) options.onError(error);
      });
  };

  return {
    id: options.id ?? 'mtsdf-text',
    async activate(context) {
      if (disposed) throw new DOMException('The MSDF scene is disposed', 'InvalidStateError');
      if (activation !== undefined) throw new DOMException('The MSDF scene is already active', 'InvalidStateError');
      context.signal.throwIfAborted();
      layoutWidthRatio = options.layoutWidthRatio ?? options.layoutWidth / context.viewport.width;
      assertLayoutWidthRatio(layoutWidthRatio);
      const activationStartedAt = performance.now();
      const canvasSurface = createBorrowedCanvasSurface(
        context.renderer,
        context.viewport.width,
        context.viewport.height,
        gridVisible,
      );
      const registry = new FontRegistry({ maxArtifactBytes: MTSDF_FIXTURE_ARTIFACT_BYTE_LIMIT });
      let font: RegisteredFont | undefined;
      let fontFixtureController: RetainedFontFixtureController<MtsdfPersistentFontFixture> | undefined;
      let line: Text | undefined;
      try {
        const fontStartedAt = performance.now();
        const loaded = await loadMtsdfFont(
          context.signal,
          options.fontFixture ?? 'inter',
          options.delivery ?? 'baked',
          options.onBakeProgress,
          registry,
        );
        font = loaded.font;
        const fontLoadMs = performance.now() - fontStartedAt;
        context.signal.throwIfAborted();
        const rasterConfiguration = await registeredMtsdfConfiguration(font, context.signal);
        fontFixtureController = createRetainedFontFixtureController(registry, {
          fixture: options.fontFixture ?? 'inter',
          asset: { font, fontLoadMs, loaded, rasterConfiguration },
        });
        const textStartedAt = performance.now();
        line = new Text({
          text: options.text,
          font,
          raster: loaded.raster,
          fontSize,
          rasterPixelRatio: context.viewport.dpr,
          lineHeight: LIVE_TEXT_LINE_HEIGHT,
          width: benchmarkContentWidth(context.viewport.width, layoutWidthRatio),
          wrap: 'word',
          language: options.language ?? 'en',
          direction: options.direction ?? 'ltr',
          features: options.features ?? [],
          textAlign: options.textAlign ?? 'start',
          color: LIVE_TEXT_COLOR,
        });
        const scheduledAt = performance.now();
        await line.ready;
        updateMtsdfDrawVisibility(line);
        const readyAt = performance.now();
        context.signal.throwIfAborted();
        const textReadyMs = performance.now() - textStartedAt;
        const sceneStartedAt = performance.now();
        positionLiveLine(line, context.viewport.width, context.viewport.height, anchor, layoutWidthRatio);
        const scene = new THREE.Scene();
        scene.add(line);
        const sceneFinishedAt = performance.now();
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - textStartedAt,
          readyMs: readyAt - scheduledAt,
          sceneMs: sceneFinishedAt - sceneStartedAt,
          totalMs: sceneFinishedAt - textStartedAt,
        });
        const camera = new THREE.OrthographicCamera(0, context.viewport.width, 0, -context.viewport.height, 0.1, 1_000);
        camera.position.z = 500;
        camera.updateProjectionMatrix();
        activation = {
          camera,
          canvasSurface,
          committedContentWidth: benchmarkContentWidth(context.viewport.width, layoutWidthRatio),
          committedDpr: context.viewport.dpr,
          firstDrawMs: 0,
          fontFixture: fontFixtureController,
          gpuTimingSupported: persistentGpuTimingSupported(options.backend, context.renderer),
          line,
          rendererInitMs: context.rendererInitMs,
          scene,
          signal: context.signal,
          startupMs: context.rendererInitMs + (performance.now() - activationStartedAt),
          textReadyMs,
          viewport: context.viewport,
        };
      } catch (error) {
        line?.dispose();
        if (fontFixtureController === undefined) font?.dispose();
        else fontFixtureController.dispose();
        canvasSurface.dispose();
        activationGate.reject(error);
        throw error;
      }
      activationGate.resolve(activation);
    },
    frame() {
      const resources = active();
      const startedAt = performance.now();
      updateMtsdfDrawVisibility(resources.line);
      resources.canvasSurface.render(resources.scene, resources.camera);
      if (resources.firstDrawMs === 0) resources.firstDrawMs = performance.now() - startedAt;
    },
    telemetry(snapshot, viewport) {
      const resources = active();
      const fontFixture = resources.fontFixture.current.asset;
      const layout = committedLayout(resources.line);
      const framebufferGpuBytes = viewport.drawingBufferWidth * viewport.drawingBufferHeight * 4;
      const atlasGpuBytes = fontFixture.loaded.metrics.rasterGpuBytes || fontFixture.loaded.atlasGpuBytes;
      options.onStats({
        technique: 'mtsdf',
        backend: options.backend,
        dpr: viewport.dpr,
        rasterEmSize: fontFixture.rasterConfiguration.emSize,
        rasterPixelRange: fontFixture.rasterConfiguration.pixelRange,
        renderedPpem: fontSize * viewport.dpr,
        scaleRatio: (fontSize * viewport.dpr) / fontFixture.rasterConfiguration.emSize,
        showGrid: gridVisible,
        ...snapshot,
        glyphCount: renderedGlyphCount(resources.line),
        missingGlyphCount: missingGlyphCount(layout),
        drawCount: drawCount(resources.line),
        layoutWidth: layout.width,
        layoutHeight: layout.height,
        lineCount: layout.lineGlyphCounts.length,
        atlasGpuBytes,
        framebufferGpuBytes,
        totalGpuBytes: atlasGpuBytes + framebufferGpuBytes,
        artifactBytes: fontFixture.loaded.compressedBytes,
        delivery: options.delivery ?? 'baked',
        sourceFontBytes: fontFixture.loaded.metrics.sourceFontBytes,
        coreArtifactBytes: fontFixture.loaded.metrics.coreArtifactBytes,
        coreBakeMs: fontFixture.loaded.metrics.coreBakeMs,
        rasterArtifactBytes: fontFixture.loaded.metrics.rasterArtifactBytes,
        rasterBakeMs: fontFixture.loaded.metrics.rasterBakeMs,
        rendererInitMs: resources.rendererInitMs,
        fontLoadMs: fontFixture.fontLoadMs,
        textReadyMs: resources.textReadyMs,
        firstDrawMs: resources.firstDrawMs,
        startupMs: resources.startupMs,
        gpuTimingSupported: resources.gpuTimingSupported,
        textUpdateTimings: textUpdateTelemetry.summary(),
      });
    },
    resize(viewport) {
      applyViewport(viewport);
    },
    panBy(deltaX, deltaY) {
      const resources = active();
      resources.scene.position.x += finiteCanvasDelta(deltaX, 'MSDF preview horizontal pan');
      resources.scene.position.y -= finiteCanvasDelta(deltaY, 'MSDF preview vertical pan');
    },
    resetView() {
      active().scene.position.set(0, 0, 0);
    },
    setGridVisible(visible) {
      gridVisible = visible;
      activation?.canvasSurface.setGridVisible(visible);
    },
    async update(next) {
      const resources = await activationGate.wait();
      const updateStartedAt = performance.now();
      const nextFontSize = positiveViewportSize(next.fontSize, 'MSDF preview font size');
      assertLayoutWidthRatio(next.layoutWidthRatio);
      const revision = ++updateRevision;
      const nextContentWidth = benchmarkContentWidth(resources.viewport.width, next.layoutWidthRatio);
      let scheduledAt = updateStartedAt;
      await resources.fontFixture.update({
        fixture: next.fontFixture ?? resources.fontFixture.current.fixture,
        isCurrent: () => !disposed && activation === resources && revision === updateRevision,
        load: async (fixture, registry) => {
          const fontStartedAt = performance.now();
          const loaded = await loadMtsdfFont(
            resources.signal,
            fixture,
            options.delivery ?? 'baked',
            options.onBakeProgress,
            registry,
          );
          try {
            const rasterConfiguration = await registeredMtsdfConfiguration(loaded.font, resources.signal);
            return { font: loaded.font, fontLoadMs: performance.now() - fontStartedAt, loaded, rasterConfiguration };
          } catch (error) {
            if (loaded.font !== resources.fontFixture.current.asset.font) loaded.font.dispose();
            throw error;
          }
        },
        commit: async (fontFixture) => {
          scheduledAt = performance.now();
          const replacingFont = fontFixture.font !== resources.fontFixture.current.asset.font;
          if (replacingFont || next.text.length === 0) resources.line.visible = false;
          resources.line.setProperties({
            text: next.text,
            font: fontFixture.font,
            raster: fontFixture.loaded.raster,
            fontSize: nextFontSize,
            width: nextContentWidth,
            language: next.language,
            direction: next.direction,
            features: next.features,
            textAlign: next.textAlign,
          });
          if (!replacingFont) updateMtsdfDrawVisibility(resources.line);
          await resources.line.ready;
          updateMtsdfDrawVisibility(resources.line);
          fontSize = nextFontSize;
          anchor = next.anchor;
          layoutWidthRatio = next.layoutWidthRatio;
          resources.committedContentWidth = nextContentWidth;
          positionLiveLine(
            resources.line,
            resources.viewport.width,
            resources.viewport.height,
            anchor,
            layoutWidthRatio,
          );
        },
      });
      if (disposed || activation !== resources || revision !== updateRevision) {
        throw new DOMException('The MSDF preview update was superseded', 'AbortError');
      }
      const sceneStartedAt = performance.now();
      positionLiveLine(resources.line, resources.viewport.width, resources.viewport.height, anchor, layoutWidthRatio);
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: scheduledAt - updateStartedAt,
        readyMs: sceneStartedAt - scheduledAt,
        sceneMs: finishedAt - sceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
    },
    deactivate() {
      if (disposed) return;
      disposed = true;
      if (activation === undefined) {
        activationGate.reject(new DOMException('The MSDF persistent scene was deactivated', 'AbortError'));
      }
      updateRevision += 1;
      const resources = activation;
      activation = undefined;
      if (resources === undefined) return;
      resources.line.dispose();
      resources.fontFixture.dispose();
      resources.canvasSurface.dispose();
    },
  };
}

export async function createMtsdfTextPreview(options: MtsdfTextPreviewOptions): Promise<MtsdfTextPreview> {
  options.signal?.throwIfAborted();
  const width = positiveViewportSize(options.width, 'MSDF preview width');
  const height = positiveViewportSize(options.height, 'MSDF preview height');
  const layoutWidthRatio = options.layoutWidthRatio ?? options.layoutWidth / width;
  assertLayoutWidthRatio(layoutWidthRatio);
  const host = await createPersistentRenderHost({
    backend: options.backend,
    canvas: options.canvas,
    dpr: options.dpr,
    height,
    width,
    onError: options.onError,
  });
  const scene = createMtsdfTextPersistentScene({
    ...options,
    layoutWidthRatio,
  });
  try {
    const lease = await host.replaceScene(scene, options.signal);
    let disposal: Promise<void> | undefined;
    return {
      resize(nextWidth, nextHeight) {
        host.resize(nextWidth, nextHeight);
      },
      panBy(deltaX, deltaY) {
        scene.panBy(deltaX, deltaY);
      },
      resetView() {
        scene.resetView();
      },
      setGridVisible(visible) {
        scene.setGridVisible(visible);
      },
      update(next) {
        return scene.update(next);
      },
      dispose() {
        disposal ??= (async () => {
          await lease.release();
          await host.dispose();
        })();
        return disposal;
      },
    };
  } catch (error) {
    await host.dispose();
    throw error;
  }
}

function createBorrowedCanvasSurface(
  renderer: PersistentRenderSceneRenderer,
  width: number,
  height: number,
  gridVisible: boolean,
): CanvasSurface {
  // CanvasSurface's implementation only renders, clears, and configures shared frame state. Its public parameter is
  // broader than that contract, so keep the borrowed-renderer compatibility cast at this single adapter boundary.
  return createCanvasSurface(renderer as THREE.WebGPURenderer, width, height, gridVisible);
}

function persistentGpuTimingSupported(backend: RendererBackend, renderer: PersistentRenderSceneRenderer): boolean {
  if (backend === 'webgpu') return renderer.hasFeature('timestamp-query');
  const context = renderer.domElement.getContext('webgl2');
  return context !== null && context.getExtension('EXT_disjoint_timer_query_webgl2') !== null;
}

export async function loadMtsdfFont(
  signal?: AbortSignal,
  fixture: BenchmarkFontFixture = 'inter',
  delivery: FontDelivery = 'baked',
  onProgress?: import('@pmndrs/text').BakeProgressListener,
  registry?: FontRegistry,
): Promise<Awaited<ReturnType<typeof loadMtsdfFontAsset>>> {
  return loadMtsdfFontAsset({
    technique: 'mtsdf',
    fixture,
    delivery,
    ...(registry === undefined ? {} : { registry }),
    ...(signal === undefined ? {} : { signal }),
    ...(onProgress === undefined ? {} : { onProgress }),
  });
}

export interface MtsdfRasterConfiguration {
  readonly emSize: number;
  readonly pixelRange: number;
}

export async function registeredMtsdfConfiguration(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<MtsdfRasterConfiguration> {
  const rasterKey = await msdfDescriptorRasterKey();
  const raster =
    font.getRaster(rasterKey) ??
    (await font.loadRaster({ kind: 'msdf', rasterKey }, signal === undefined ? undefined : { signal }));
  const extension = raster.extensionData;
  if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) {
    throw new TypeError('MTSDF extension must be an object');
  }
  if (!('emSize' in extension) || !('pixelRange' in extension)) {
    throw new TypeError('MTSDF extension must declare emSize and pixelRange');
  }
  const emSize = extension.emSize;
  const pixelRange = extension.pixelRange;
  if (typeof emSize !== 'number' || !Number.isSafeInteger(emSize) || emSize <= 0) {
    throw new TypeError('MTSDF emSize must be a positive safe integer');
  }
  if (typeof pixelRange !== 'number' || !Number.isFinite(pixelRange) || pixelRange <= 0) {
    throw new TypeError('MTSDF pixelRange must be positive and finite');
  }
  return { emSize, pixelRange };
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
  if (layout === undefined) throw new Error('live MSDF Text lost its committed layout');
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
    throw new RangeError('MSDF preview layout width ratio must be in (0, 1]');
  }
}

export async function captureMtsdfTextConformance(options: {
  readonly backend: RendererBackend;
  readonly delivery?: FontDelivery;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<MtsdfTextConformanceCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatMtsdfConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
    options.delivery,
    options.renderer,
  );
  try {
    options.signal?.throwIfAborted();
    const capture = await captureFlatMtsdfConformance(resources);
    options.signal?.throwIfAborted();
    return capture;
  } finally {
    await disposeFlatMtsdfConformanceResources(resources);
  }
}

export async function captureMtsdfSourceOutlineFidelity(options: {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: SelectableFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatMtsdfConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
    'baked',
    options.renderer,
  );
  try {
    const capture = await captureFlatMtsdfConformance(resources);
    options.signal?.throwIfAborted();
    return await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: 64 / options.dpr,
      direction: 'ltr',
      layout: committedLayout(resources.line),
      originX: resources.line.position.x,
      originY: resources.line.position.y,
      text: conformanceText(),
      renderSubmitMs: capture.renderSubmitMs,
    });
  } finally {
    await disposeFlatMtsdfConformanceResources(resources);
  }
}

async function createFlatMtsdfConformanceResources(
  backend: RendererBackend,
  dpr: number,
  fontFixture: BenchmarkFontFixture = 'inter',
  signal?: AbortSignal,
  delivery: FontDelivery = 'baked',
  borrowedRenderer?: PersistentRenderSceneRenderer,
): Promise<FlatMtsdfConformanceResources> {
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          width: WIDTH,
          height: FLAT_CONFORMANCE_HEIGHT,
          backend,
          dpr,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  let target: THREE.RenderTarget | undefined;
  let font: RegisteredFont | undefined;
  let line: Text | undefined;
  let resource: MsdfResource | undefined;
  try {
    const loaded = await loadMtsdfFont(signal, fontFixture, delivery);
    font = loaded.font;
    const rasterKey = await msdfDescriptorRasterKey();
    line = new Text({
      text: conformanceText(),
      font,
      raster: loaded.raster,
      // Match the baked 64 px/em base level in device pixels. Deep minification
      // is exercised separately with the same authored field and derivative AA.
      fontSize: 64 / dpr,
      rasterPixelRatio: dpr,
      lineHeight: 1.2,
      width: 476,
      wrap: 'word',
      color: 0xffffff,
    });
    await line.ready;
    const raster = await font.loadRaster({ rasterKey, kind: msdf.kind }, signal === undefined ? undefined : { signal });
    resource = await loaded.raster.decode(font, raster, signal);
    signal?.throwIfAborted();
    line.position.set(18, -18, 0);
    const scene = new THREE.Scene();
    scene.add(line);
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -FLAT_CONFORMANCE_HEIGHT, 0.1, 1_000);
    camera.position.z = 500;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(Math.round(WIDTH * dpr), Math.round(FLAT_CONFORMANCE_HEIGHT * dpr), {
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
    };
  } catch (error) {
    line?.dispose();
    if (resource !== undefined) msdf.dispose(resource);
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

async function captureFlatMtsdfConformance(
  resources: FlatMtsdfConformanceResources,
): Promise<MtsdfTextConformanceCapture> {
  const width = Math.round(WIDTH * resources.dpr);
  const height = Math.round(FLAT_CONFORMANCE_HEIGHT * resources.dpr);
  const { bytes, renderSubmitMs } = await withRendererStateRestored(resources.renderer, async () => {
    resources.renderer.setRenderTarget(resources.target);
    resources.renderer.setClearColor(0x000000, 1);
    resources.renderer.clear();
    const started = performance.now();
    resources.renderer.render(resources.scene, resources.camera);
    const submittedIn = performance.now() - started;
    const readback = await resources.renderer.readRenderTargetPixelsAsync(resources.target, 0, 0, width, height);
    return {
      bytes: new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
      renderSubmitMs: submittedIn,
    };
  });
  const candidate = compactRgba8Readback(
    bytes,
    width,
    height,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  );
  const referenceResult = renderFlatMtsdfCpuReference(resources.resource, committedLayout(resources.line), {
    width,
    height,
    dpr: resources.dpr,
    originX: resources.line.position.x,
    originY: resources.line.position.y,
  });
  const reference = referenceResult.pixels;
  const comparison = compareRgba8Coverage(candidate, reference);
  return {
    width,
    height,
    candidate,
    reference,
    difference: comparison.heatmap,
    meanAbsoluteError: comparison.meanAbsoluteError,
    maximumError: comparison.maximumError,
    errorPixels: comparison.errorPixels,
    glyphCount: referenceResult.glyphCount,
    renderSubmitMs,
  };
}

async function disposeFlatMtsdfConformanceResources(resources: FlatMtsdfConformanceResources): Promise<void> {
  resources.line.dispose();
  msdf.dispose(resources.resource);
  resources.font.dispose();
  resources.target.dispose();
  if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
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

function updateMtsdfDrawVisibility(object: THREE.Object3D): void {
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
