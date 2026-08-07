import {
  FontRegistry,
  Text,
  type BakeProgressListener,
  type FontFeature,
  type ParagraphLayout,
  type RegisteredFont,
} from '@pmndrs/text/v0';
import * as THREE from 'three/webgpu';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery } from '../../benchmark/url-state';
import { createCanvasSurface } from '../../renderer/canvas-surface';
import { finiteCanvasDelta } from '../../renderer/canvas-view';
import { loadSlugFontAsset } from '../../workloads/font-assets/slug';
import type { LiveFrameHistoryCursor } from '../../renderer/live-frame-telemetry';
import {
  benchmarkContentWidth,
  LIVE_TEXT_COLOR,
  LIVE_TEXT_LINE_HEIGHT,
  liveTextPosition,
  type LiveTextAnchor,
} from '../../workloads/shared/text-style';
import { createTextUpdateTelemetry, type TextUpdateTimingSummary } from '../../renderer/text-update-telemetry';
import { type PersistentRenderScene, type PersistentRenderViewport } from '../../renderer/persistent-render-host';
import { createPersistentSceneActivation } from '../../renderer/persistent-scene-activation';
import {
  createRetainedFontFixtureController,
  type LiveFontFixtureUpdate,
  type RetainedFontFixtureController,
} from '../../renderer/retained-font-fixture';
import type { RendererBackend } from '../../renderer/webgpu-renderer';
import { slugDataConfiguration, type SlugRasterConfiguration } from './metadata';

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

export interface SlugTextSceneUpdate extends LiveFontFixtureUpdate {
  readonly anchor: LiveTextAnchor;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
  readonly fontSize: number;
  readonly language: string;
  readonly layoutWidthRatio: number;
  readonly text: string;
  readonly textAlign: 'start' | 'center';
}

export interface SlugTextPersistentSceneOptions {
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
  readonly loaded: Awaited<ReturnType<typeof loadSlugFontAsset>>;
  readonly rasterConfiguration: SlugRasterConfiguration;
}

export interface SlugTextPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  update(update: SlugTextSceneUpdate): Promise<void>;
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
  let fontSize = positiveViewportSize(options.fontSize, 'Slug scene font size');
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
      throw new DOMException('The Slug scene is not active', 'InvalidStateError');
    }
    return { canvasSurface, camera, line, scene };
  };

  const resizeScene = (viewport: PersistentRenderViewport): void => {
    if (closing || disposed || line === undefined || camera === undefined || canvasSurface === undefined) return;
    width = positiveViewportSize(viewport.width, 'Slug scene width');
    height = positiveViewportSize(viewport.height, 'Slug scene height');
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
    id: `slug-text-scene-${backend}`,
    async activate(context) {
      if (disposed) throw new DOMException('The Slug scene is disposed', 'InvalidStateError');
      if (scene !== undefined) throw new DOMException('The Slug scene is already active', 'InvalidStateError');
      context.signal.throwIfAborted();
      activationSignal = context.signal;
      rendererInitMs = context.rendererInitMs;
      width = positiveViewportSize(context.viewport.width, 'Slug scene width');
      height = positiveViewportSize(context.viewport.height, 'Slug scene height');
      committedContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
      committedRasterPixelRatio = context.viewport.dpr;
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000);
      camera.position.z = 500;
      camera.updateProjectionMatrix();
      // CanvasSurface consumes only render-state methods; the host still withholds renderer lifecycle ownership.
      canvasSurface = createCanvasSurface(context.renderer as THREE.WebGPURenderer, width, height, gridVisible);
      const fontStarted = performance.now();
      const loaded = await loadSlugFontAsset({
        technique: 'slug',
        fixture: initialFontFixture,
        delivery,
        registry,
        signal: context.signal,
        ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
      });
      font = loaded.font;
      const fontLoadMs = performance.now() - fontStarted;
      context.signal.throwIfAborted();
      const rasterConfiguration = slugDataConfiguration(loaded.loaded.data);
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
        slugCurveGpuBytes: currentFontFixture.rasterConfiguration.curveBytes,
        slugHeaderCount: currentFontFixture.rasterConfiguration.headerCount,
        slugHeaderGpuBytes: currentFontFixture.rasterConfiguration.headerBytes,
        slugReferenceCount: currentFontFixture.rasterConfiguration.referenceCount,
        slugReferenceGpuBytes: currentFontFixture.rasterConfiguration.referenceBytes,
        slugGpuBytes: currentFontFixture.rasterConfiguration.resourceBytes,
        atlasGpuBytes: currentFontFixture.rasterConfiguration.resourceBytes,
        framebufferGpuBytes,
        totalGpuBytes: currentFontFixture.rasterConfiguration.resourceBytes + framebufferGpuBytes,
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
      activeScene.position.x += finiteCanvasDelta(deltaX, 'Slug scene horizontal pan');
      activeScene.position.y -= finiteCanvasDelta(deltaY, 'Slug scene vertical pan');
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
      if (closing || disposed) throw new DOMException('The Slug scene is disposed', 'AbortError');
      const activeLine = activeResources().line;
      const activeFontFixture = fontFixture;
      const signal = activationSignal;
      if (activeFontFixture === undefined || signal === undefined) {
        throw new DOMException('The Slug scene is not active', 'InvalidStateError');
      }
      const updateStartedAt = performance.now();
      const nextFontSize = positiveViewportSize(next.fontSize, 'Slug scene font size');
      assertLayoutWidthRatio(next.layoutWidthRatio);
      const revision = ++updateRevision;
      const nextContentWidth = benchmarkContentWidth(width, next.layoutWidthRatio);
      let updateScheduledAt = updateStartedAt;
      await activeFontFixture.update({
        fixture: next.fontFixture ?? activeFontFixture.current.fixture,
        isCurrent: () => !closing && !disposed && revision === updateRevision,
        load: async (fixture, fixtureRegistry) => {
          const fontStartedAt = performance.now();
          const loaded = await loadSlugFontAsset({
            technique: 'slug',
            fixture,
            delivery,
            registry: fixtureRegistry,
            signal,
            ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
          });
          try {
            const rasterConfiguration = slugDataConfiguration(loaded.loaded.data);
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
        throw new DOMException('The Slug scene update was superseded', 'AbortError');
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
    throw new RangeError('Slug scene layout width ratio must be in (0, 1]');
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
