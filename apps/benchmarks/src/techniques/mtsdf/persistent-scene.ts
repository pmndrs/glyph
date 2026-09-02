import {
  createFontLibrary,
  type Constraints,
  type FontFeature,
  type Font,
  type ParagraphLayout,
  type ParagraphLayoutSummary,
  type TextStyle,
} from '@pmndrs/glyph';
import type { msdf as mtsdf } from '@pmndrs/glyph/three/msdf';
import type { Text, ThreeRoot } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery } from '../../benchmark/url-state';
import { createCanvasSurface, type CanvasSurface } from '../../renderer/canvas-surface';
import { finiteCanvasDelta } from '../../renderer/canvas-view';
import type { LiveFrameHistoryCursor } from '../../renderer/live-frame-telemetry';
import { createTextUpdateTelemetry, type TextUpdateTimingSummary } from '../../renderer/text-update-telemetry';
import {
  createRetainedFontFixtureController,
  type LiveFontFixtureUpdate,
  type RetainedFontFixtureController,
} from '../../renderer/retained-font-fixture';
import {
  benchmarkContentWidth,
  LIVE_TEXT_COLOR_CSS,
  LIVE_TEXT_LINE_HEIGHT,
  liveTextPosition,
  type LiveTextAnchor,
} from '../../workloads/shared/text-style';
import { type RendererBackend } from '../../renderer/webgpu-renderer';
import {
  type PersistentRenderFrameContext,
  type PersistentRenderScene,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from '../../renderer/persistent-render-host';
import { createPersistentSceneActivation } from '../../renderer/persistent-scene-activation';
import { loadMtsdfFontAsset, MTSDF_FIXTURE_ARTIFACT_BYTE_LIMIT } from '../../workloads/font-assets/mtsdf';
import {
  captureGlyphOriginsForPresentation,
  createFrameDrivenGlyphTransition,
  snapGlyphOrigins,
  transitionPresentation,
  type FrameDrivenGlyphTransition,
  type GlyphOriginPresentation,
  type GlyphOriginSnapshot,
  type ShapedTextIdentity,
} from '../shared/glyph-origin-transition';
import { mtsdfDataConfiguration, type MtsdfRasterConfiguration } from './metadata';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from '../../three-root';

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
  readonly animatePresentation: boolean;
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
  readonly onBakeProgress?: import('@pmndrs/glyph').BakeProgressListener;
  readonly id?: string;
}

export interface MtsdfTextPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  setGridVisible(visible: boolean): void;
  /** Whether `update` can commit `fixture` in the caller's own turn, or a `loadFontFixture` has to precede it. */
  hasFontFixture(fixture: BenchmarkFontFixture): boolean;
  /** Fetches and decodes a replacement fixture behind the visible text. The only asynchronous step a live update has. */
  loadFontFixture(fixture: BenchmarkFontFixture): Promise<void>;
  /**
   * Applies and shapes one generation in the caller's own turn. Nothing here is deferred: an ordinary text, font-size,
   * layout-width, anchor, or DPR change is visible on the next frame the host draws, which is the contract this
   * harness exists to demonstrate. Only a fixture the scene has not loaded is refused, and `loadFontFixture` is how
   * that is resolved.
   */
  update(update: MtsdfTextSceneUpdate): GlyphOriginPresentation;
}

/** The inputs one committed generation of the live paragraph was built from. */
interface MtsdfTextState {
  readonly font: Font<typeof mtsdf>;
  /** The shaped-run inputs this generation committed, kept beside the style so a rollback restores both together. */
  readonly identity: ShapedTextIdentity;
  readonly constraints: Constraints;
  readonly layout: ParagraphLayout;
  readonly style: TextStyle;
  readonly rasterPixelRatio: number;
}

/** Presentation-only motion the scene drives from its own frame clock, because its surface does not drive progress. */
interface MtsdfPresentation {
  readonly transition: FrameDrivenGlyphTransition;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

interface MtsdfPersistentActivation {
  readonly camera: THREE.OrthographicCamera;
  readonly canvasSurface: CanvasSurface;
  committedContentWidth: number;
  firstDrawMs: number;
  readonly fontFixture: RetainedFontFixtureController<MtsdfPersistentFontFixture>;
  readonly gpuTimingSupported: boolean;
  readonly line: Text<typeof mtsdf>;
  readonly root: ThreeRoot;
  presentation: MtsdfPresentation | undefined;
  readonly rendererInitMs: number;
  readonly scene: THREE.Scene;
  readonly signal: AbortSignal;
  state: MtsdfTextState;
  readonly startupMs: number;
  readonly textReadyMs: number;
  viewport: PersistentRenderViewport;
}

interface MtsdfPersistentFontFixture {
  readonly font: Font<typeof mtsdf>;
  readonly fontLoadMs: number;
  readonly loaded: Awaited<ReturnType<typeof loadMtsdfFontAsset>>;
  readonly loadedFont: Font<typeof mtsdf>;
  readonly rasterConfiguration: MtsdfRasterConfiguration;
}

export function createMtsdfTextPersistentScene(options: MtsdfTextPersistentSceneOptions): MtsdfTextPersistentScene {
  let fontSize = positiveViewportSize(options.fontSize, 'MSDF scene font size');
  let anchor = options.anchor ?? 'center';
  let textAlign = options.textAlign ?? 'start';
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

  /** Commits one validated generation; `Text.set()` leaves desired state unchanged when it rejects. */
  const commitState = (resources: MtsdfPersistentActivation, next: MtsdfTextState): void => {
    applyState(resources.line, next);
    resources.state = next;
  };

  /**
   * Presents one committed reflow. `before` is captured only when `glyphOriginPolicy` allows interpolation, so its
   * absence is the decision to snap rather than a missing snapshot.
   */
  const presentReflow = (
    resources: MtsdfPersistentActivation,
    before: GlyphOriginSnapshot | undefined,
  ): GlyphOriginPresentation => {
    const fromX = resources.line.position.x;
    const fromY = resources.line.position.y;
    resources.presentation?.transition.dispose();
    resources.presentation = undefined;
    positionLiveLine(resources.line, resources.viewport.width, resources.viewport.height, anchor, layoutWidthRatio);
    if (before === undefined) return snapGlyphOrigins(resources.line);
    const toX = resources.line.position.x;
    const toY = resources.line.position.y;
    const transition = createFrameDrivenGlyphTransition(resources.line, before);
    resources.line.position.set(fromX, fromY, 0);
    resources.presentation = { transition, fromX, fromY, toX, toY };
    return transitionPresentation(transition);
  };

  /** Captures the origins a reflow may interpolate from, or nothing when the change replaces or reorders glyphs. */
  const originsToInterpolate = (
    resources: MtsdfPersistentActivation,
    next: ShapedTextIdentity,
    animatePresentation = true,
  ): GlyphOriginSnapshot | undefined => {
    return captureGlyphOriginsForPresentation(resources.line, resources.state.identity, next, animatePresentation);
  };

  const applyViewport = (viewport: PersistentRenderViewport): void => {
    const resources = active();
    resources.viewport = viewport;
    resources.canvasSurface.resize(viewport.width, viewport.height);
    resources.camera.right = viewport.width;
    resources.camera.bottom = -viewport.height;
    resources.camera.updateProjectionMatrix();
    const nextContentWidth = benchmarkContentWidth(viewport.width, layoutWidthRatio);
    if (nextContentWidth === resources.committedContentWidth && viewport.dpr === resources.state.rasterPixelRatio) {
      positionLiveLine(resources.line, viewport.width, viewport.height, anchor, layoutWidthRatio);
      return;
    }
    const updateStartedAt = performance.now();
    const revision = ++updateRevision;
    try {
      // A viewport change leaves the shaped run intact, so its glyphs really do move continuously.
      const before = originsToInterpolate(resources, resources.state.identity);
      commitState(resources, {
        ...resources.state,
        constraints: mtsdfConstraints(nextContentWidth),
        layout: mtsdfLayout(textAlign),
        rasterPixelRatio: viewport.dpr,
      });
      if (disposed || activation !== resources || revision !== updateRevision) return;
      resources.committedContentWidth = nextContentWidth;
      const sceneStartedAt = performance.now();
      presentReflow(resources, before);
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: 0,
        readyMs: sceneStartedAt - updateStartedAt,
        sceneMs: finishedAt - sceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
    } catch (error) {
      if (!disposed && activation === resources) options.onError(error);
    }
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
      const library = createFontLibrary({ maxArtifactBytes: MTSDF_FIXTURE_ARTIFACT_BYTE_LIMIT });
      let loadedFont: Font<typeof mtsdf> | undefined;
      let fontFixtureController: RetainedFontFixtureController<MtsdfPersistentFontFixture> | undefined;
      let line: Text<typeof mtsdf> | undefined;
      const glyphRoot = createBenchmarkThreeRoot(options.id ?? 'mtsdf-text');
      try {
        const fontStartedAt = performance.now();
        const loaded = await loadMtsdfFontAsset({
          technique: 'mtsdf',
          fixture: options.fontFixture ?? 'inter',
          delivery: options.delivery ?? 'baked',
          library,
          signal: context.signal,
          ...(options.onBakeProgress === undefined ? {} : { onProgress: options.onBakeProgress }),
        });
        loadedFont = loaded.loaded;
        const fontLoadMs = performance.now() - fontStartedAt;
        context.signal.throwIfAborted();
        const rasterConfiguration = mtsdfDataConfiguration(loaded.data);
        fontFixtureController = createRetainedFontFixtureController(
          library,
          {
            fixture: options.fontFixture ?? 'inter',
            asset: { font: loaded.loaded, fontLoadMs, loaded, loadedFont, rasterConfiguration },
          },
          // Dispose the application Font lease; live renderer bindings retain their own counted lease.
          { dispose: (asset) => asset.loadedFont.dispose() },
        );
        const textStartedAt = performance.now();
        const identity: ShapedTextIdentity = {
          fontFixture: options.fontFixture ?? 'inter',
          text: options.text,
          language: options.language ?? 'en',
          direction: options.direction ?? 'ltr',
          features: options.features ?? [],
        };
        const state: MtsdfTextState = {
          font: loadedFont,
          identity,
          constraints: mtsdfConstraints(benchmarkContentWidth(context.viewport.width, layoutWidthRatio)),
          layout: mtsdfLayout(textAlign),
          style: mtsdfStyle(fontSize, identity),
          rasterPixelRatio: context.viewport.dpr,
        };
        line = glyphRoot.createText({
          font: state.font,
          text: state.identity.text,
          constraints: state.constraints,
          layout: state.layout,
          style: state.style,
          rasterPixelRatio: state.rasterPixelRatio,
        });
        const activeLine = line;
        const scene = new THREE.Scene();
        const scheduledAt = performance.now();
        // `Text` reconciles while it is parented, so attaching and forcing one world update is what commits the layout.
        scene.add(activeLine);
        activeLine.updateMatrixWorld(true);
        if (activeLine.error !== undefined) throw activeLine.error;
        updateMtsdfDrawVisibility(activeLine);
        const readyAt = performance.now();
        context.signal.throwIfAborted();
        const textReadyMs = performance.now() - textStartedAt;
        const sceneStartedAt = performance.now();
        positionLiveLine(activeLine, context.viewport.width, context.viewport.height, anchor, layoutWidthRatio);
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
          firstDrawMs: 0,
          fontFixture: fontFixtureController,
          gpuTimingSupported: persistentGpuTimingSupported(options.backend, context.renderer),
          line: activeLine,
          root: glyphRoot,
          presentation: undefined,
          rendererInitMs: context.rendererInitMs,
          scene,
          signal: context.signal,
          state,
          startupMs: context.rendererInitMs + (performance.now() - activationStartedAt),
          textReadyMs,
          viewport: context.viewport,
        };
      } catch (error) {
        line?.removeFromParent();
        line?.dispose();
        disposeBenchmarkThreeRoot(glyphRoot);
        if (fontFixtureController === undefined) loadedFont?.dispose();
        else fontFixtureController.dispose();
        canvasSurface.dispose();
        activationGate.reject(error);
        throw error;
      }
      activationGate.resolve(activation);
    },
    frame(context) {
      const resources = active();
      const startedAt = performance.now();
      advancePresentation(resources, context, options.onError);
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
        lineCount: layout.lineCount,
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
    hasFontFixture(fixture) {
      return !disposed && activation !== undefined && activation.fontFixture.has(fixture);
    },
    async loadFontFixture(fixture) {
      const resources = await activationGate.wait();
      await resources.fontFixture.load(fixture, async (requested, library) => {
        const fontStartedAt = performance.now();
        const loaded = await loadMtsdfFontAsset({
          technique: 'mtsdf',
          fixture: requested,
          delivery: options.delivery ?? 'baked',
          library,
          signal: resources.signal,
          ...(options.onBakeProgress === undefined ? {} : { onProgress: options.onBakeProgress }),
        });
        try {
          const rasterConfiguration = mtsdfDataConfiguration(loaded.data);
          return {
            font: loaded.loaded,
            fontLoadMs: performance.now() - fontStartedAt,
            loaded,
            loadedFont: loaded.loaded,
            rasterConfiguration,
          };
        } catch (error) {
          if (loaded.loaded !== resources.fontFixture.current.asset.loadedFont) loaded.loaded.dispose();
          throw error;
        }
      });
    },
    update(next) {
      const resources = active();
      const updateStartedAt = performance.now();
      const nextFontSize = positiveViewportSize(next.fontSize, 'MSDF scene font size');
      assertLayoutWidthRatio(next.layoutWidthRatio);
      updateRevision += 1;
      const nextContentWidth = benchmarkContentWidth(resources.viewport.width, next.layoutWidthRatio);
      const nextFixture = next.fontFixture ?? resources.fontFixture.current.fixture;
      const identity: ShapedTextIdentity = {
        fontFixture: nextFixture,
        text: next.text,
        language: next.language,
        direction: next.direction,
        features: next.features,
      };
      const before = originsToInterpolate(resources, identity, next.animatePresentation);
      resources.fontFixture.commit(nextFixture, (fontFixture) => {
        if (next.text.length === 0) resources.line.visible = false;
        commitState(resources, {
          font: fontFixture.loadedFont,
          identity,
          constraints: mtsdfConstraints(nextContentWidth),
          layout: mtsdfLayout(next.textAlign),
          style: mtsdfStyle(nextFontSize, identity),
          rasterPixelRatio: resources.viewport.dpr,
        });
        updateMtsdfDrawVisibility(resources.line);
        fontSize = nextFontSize;
        anchor = next.anchor;
        textAlign = next.textAlign;
        layoutWidthRatio = next.layoutWidthRatio;
        resources.committedContentWidth = nextContentWidth;
      });
      const sceneStartedAt = performance.now();
      const presented = presentReflow(resources, before);
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: 0,
        readyMs: sceneStartedAt - updateStartedAt,
        sceneMs: finishedAt - sceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
      return presented;
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
      resources.presentation?.transition.dispose();
      resources.line.removeFromParent();
      resources.line.dispose();
      disposeBenchmarkThreeRoot(resources.root);
      resources.fontFixture.dispose();
      resources.canvasSurface.dispose();
    },
  };
}

function applyState(line: Text<typeof mtsdf>, next: MtsdfTextState): void {
  line.set({
    font: next.font,
    text: next.identity.text,
    constraints: next.constraints,
    layout: next.layout,
    style: next.style,
    rasterPixelRatio: next.rasterPixelRatio,
  });
  line.updateMatrixWorld(true);
  if (line.error !== undefined) throw line.error;
}

/**
 * Advances the frame-driven presentation. A superseded transition is a normal outcome of a reflow landing mid-motion,
 * so it retires quietly; anything else is a real failure the surface must see.
 */
function advancePresentation(
  resources: MtsdfPersistentActivation,
  context: PersistentRenderFrameContext,
  onError: (error: unknown) => void,
): void {
  const presentation = resources.presentation;
  if (presentation === undefined) return;
  try {
    const progress = presentation.transition.advance(context.timestamp);
    resources.line.position.set(
      presentation.fromX + (presentation.toX - presentation.fromX) * progress,
      presentation.fromY + (presentation.toY - presentation.fromY) * progress,
      0,
    );
    if (progress === 1) resources.presentation = undefined;
  } catch (error) {
    presentation.transition.dispose();
    resources.presentation = undefined;
    resources.line.position.set(presentation.toX, presentation.toY, 0);
    if (!(error instanceof DOMException && error.name === 'AbortError')) onError(error);
  }
}

function mtsdfConstraints(width: number): Constraints {
  return { width: { mode: 'exact', size: width } };
}

function mtsdfLayout(align: 'start' | 'center'): ParagraphLayout {
  return { wrap: 'word', align, overflow: 'visible' };
}

function mtsdfStyle(
  fontSize: number,
  shaping: { readonly language: string; readonly direction: 'ltr' | 'rtl'; readonly features: readonly FontFeature[] },
): TextStyle {
  return {
    fontSize,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    language: shaping.language,
    direction: shaping.direction,
    features: shaping.features,
    color: LIVE_TEXT_COLOR_CSS,
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
  line: Text<typeof mtsdf>,
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

function committedLayout(line: Text<typeof mtsdf>): ParagraphLayoutSummary {
  return line.measure();
}

function missingGlyphCount(layout: ParagraphLayoutSummary): number {
  return layout.missingGlyphCount;
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
