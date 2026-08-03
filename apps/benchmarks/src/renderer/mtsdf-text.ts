import { FontRegistry, Text, type FontFeature, type ParagraphLayout, type RegisteredFont } from '@pmndrs/text';
import * as THREE from 'three/webgpu';

import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';
import {
  registeredMtsdfConfiguration,
  type MtsdfRasterConfiguration,
} from '../benchmark/low-level/raster/mtsdf-configuration';
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
import { type RendererBackend } from './webgpu-renderer';
import {
  type PersistentRenderScene,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from './persistent-render-host';
import { createPersistentSceneActivation } from './persistent-scene-activation';
import { loadMtsdfFontAsset, MTSDF_FIXTURE_ARTIFACT_BYTE_LIMIT } from '../workloads/font-assets/mtsdf';

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

export interface MtsdfTextSceneUpdate extends LiveFontFixtureUpdate {
  readonly anchor: LiveTextAnchor;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
  readonly fontSize: number;
  readonly language: string;
  readonly layoutWidthRatio: number;
  readonly text: string;
  readonly textAlign: 'start' | 'center';
}

export interface MtsdfTextPersistentSceneOptions {
  readonly anchor?: LiveTextAnchor;
  readonly backend: RendererBackend;
  readonly direction?: 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
  readonly fontSize: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly delivery?: FontDelivery;
  readonly showGrid: boolean;
  readonly language?: string;
  readonly layoutWidth: number;
  readonly layoutWidthRatio?: number;
  readonly text: string;
  readonly textAlign?: 'start' | 'center';
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: MtsdfTextLiveStats) => void;
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener;
  readonly id?: string;
}

export interface MtsdfTextPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(update: MtsdfTextSceneUpdate): Promise<void>;
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
  readonly loaded: Awaited<ReturnType<typeof loadMtsdfFontAsset>>;
  readonly rasterConfiguration: MtsdfRasterConfiguration;
}

export function createMtsdfTextPersistentScene(options: MtsdfTextPersistentSceneOptions): MtsdfTextPersistentScene {
  let fontSize = positiveViewportSize(options.fontSize, 'MSDF scene font size');
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
        const loaded = await loadMtsdfFontAsset({
          technique: 'mtsdf',
          fixture: options.fontFixture ?? 'inter',
          delivery: options.delivery ?? 'baked',
          registry,
          signal: context.signal,
          ...(options.onBakeProgress === undefined ? {} : { onProgress: options.onBakeProgress }),
        });
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
      resources.scene.position.x += finiteCanvasDelta(deltaX, 'MSDF scene horizontal pan');
      resources.scene.position.y -= finiteCanvasDelta(deltaY, 'MSDF scene vertical pan');
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
      const nextFontSize = positiveViewportSize(next.fontSize, 'MSDF scene font size');
      assertLayoutWidthRatio(next.layoutWidthRatio);
      const revision = ++updateRevision;
      const nextContentWidth = benchmarkContentWidth(resources.viewport.width, next.layoutWidthRatio);
      let scheduledAt = updateStartedAt;
      await resources.fontFixture.update({
        fixture: next.fontFixture ?? resources.fontFixture.current.fixture,
        isCurrent: () => !disposed && activation === resources && revision === updateRevision,
        load: async (fixture, registry) => {
          const fontStartedAt = performance.now();
          const loaded = await loadMtsdfFontAsset({
            technique: 'mtsdf',
            fixture,
            delivery: options.delivery ?? 'baked',
            registry,
            signal: resources.signal,
            ...(options.onBakeProgress === undefined ? {} : { onProgress: options.onBakeProgress }),
          });
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
        throw new DOMException('The MSDF scene update was superseded', 'AbortError');
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
    throw new RangeError('MSDF scene layout width ratio must be in (0, 1]');
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
