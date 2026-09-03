import {
  type BakeProgressListener,
  type Constraints,
  type FontFeature,
  type Font,
  type ParagraphLayout,
  type ParagraphLayoutSummary,
  type TextStyle,
} from '@pmndrs/glyph';
import type { slug } from '@pmndrs/glyph/raster/slug';
import type { Text, ThreeRoot } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery } from '../../benchmark/url-state';
import { createCanvasSurface } from '../../renderer/canvas-surface';
import { finiteCanvasDelta } from '../../renderer/canvas-view';
import { loadSlugFontAsset } from '../../workloads/font-assets/slug';
import type { LiveFrameHistoryCursor } from '../../renderer/live-frame-telemetry';
import {
  benchmarkContentWidth,
  LIVE_TEXT_COLOR_CSS,
  LIVE_TEXT_LINE_HEIGHT,
  liveTextPosition,
  type LiveTextAnchor,
} from '../../workloads/shared/text-style';
import { createTextUpdateTelemetry, type TextUpdateTimingSummary } from '../../renderer/text-update-telemetry';
import {
  type PersistentRenderFrameContext,
  type PersistentRenderScene,
  type PersistentRenderViewport,
} from '../../renderer/persistent-render-host';
import { createPersistentSceneActivation } from '../../renderer/persistent-scene-activation';
import {
  createRetainedFontFixtureController,
  type LiveFontFixtureUpdate,
  type RetainedFontFixtureController,
} from '../../renderer/retained-font-fixture';
import type { RendererBackend } from '../../renderer/webgpu-renderer';
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
import { slugDataConfiguration, type SlugRasterConfiguration } from './metadata';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from '../../three-root';

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
  readonly font: Font<typeof slug>;
  readonly fontLoadMs: number;
  readonly loaded: Awaited<ReturnType<typeof loadSlugFontAsset>>;
  readonly loadedFont: Font<typeof slug>;
  readonly rasterConfiguration: SlugRasterConfiguration;
}

/** The inputs one committed generation of the live paragraph was built from. */
interface SlugTextState {
  readonly font: Font<typeof slug>;
  /** The shaped-run inputs this generation committed, kept beside the style so a rollback restores both together. */
  readonly identity: ShapedTextIdentity;
  readonly constraints: Constraints;
  readonly layout: ParagraphLayout;
  readonly style: TextStyle;
  readonly rasterPixelRatio: number;
}

/** Presentation-only motion the scene drives from its own frame clock, because its surface does not drive progress. */
interface SlugPresentation {
  readonly transition: FrameDrivenGlyphTransition;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export interface SlugTextPersistentScene extends PersistentRenderScene {
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
  update(update: SlugTextSceneUpdate): GlyphOriginPresentation;
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
    textAlign: initialTextAlign = 'start',
    fontFixture: initialFontFixture = 'inter',
    delivery = 'baked',
  } = options;
  assertLayoutWidthRatio(options.layoutWidthRatio);
  const startupStarted = performance.now();
  let width = 0;
  let height = 0;
  let fontSize = positiveViewportSize(options.fontSize, 'Slug scene font size');
  let anchor = options.anchor ?? 'center';
  let textAlign = initialTextAlign;
  let layoutWidthRatio = options.layoutWidthRatio;
  let committedContentWidth = 0;
  let gridVisible = options.showGrid;
  const textUpdateTelemetry = createTextUpdateTelemetry();
  let rendererInitMs = 0;
  let textReadyMs = 0;
  let startupMs = 0;
  let firstDrawMs = 0;
  let firstDrawRecorded = false;
  let fontFixture: RetainedFontFixtureController<SlugPersistentFontFixture> | undefined;
  let activationSignal: AbortSignal | undefined;
  let canvasSurface: ReturnType<typeof createCanvasSurface> | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.OrthographicCamera | undefined;
  let loadedFont: Font<typeof slug> | undefined;
  let line: Text<typeof slug> | undefined;
  let glyphRoot: ThreeRoot | undefined;
  let committedState: SlugTextState | undefined;
  let presentation: SlugPresentation | undefined;
  let closing = false;
  let disposed = false;
  let updateRevision = 0;
  const activationGate = createPersistentSceneActivation<void>();

  const activeResources = (): {
    readonly canvasSurface: ReturnType<typeof createCanvasSurface>;
    readonly camera: THREE.OrthographicCamera;
    readonly line: Text<typeof slug>;
    readonly scene: THREE.Scene;
    readonly state: SlugTextState;
  } => {
    if (
      canvasSurface === undefined ||
      camera === undefined ||
      line === undefined ||
      scene === undefined ||
      committedState === undefined
    ) {
      throw new DOMException('The Slug scene is not active', 'InvalidStateError');
    }
    return { canvasSurface, camera, line, scene, state: committedState };
  };

  const releaseActivationResources = (): void => {
    updateRevision += 1;
    presentation?.transition.dispose();
    presentation = undefined;
    line?.removeFromParent();
    line?.dispose();
    if (glyphRoot !== undefined) disposeBenchmarkThreeRoot(glyphRoot);
    if (fontFixture === undefined) loadedFont?.dispose();
    else fontFixture.dispose();
    canvasSurface?.dispose();
    line = undefined;
    glyphRoot = undefined;
    loadedFont = undefined;
    committedState = undefined;
    fontFixture = undefined;
    activationSignal = undefined;
    canvasSurface = undefined;
    camera = undefined;
    scene = undefined;
  };

  /** Commits one validated generation; `Text.set()` leaves desired state unchanged when it rejects. */
  const commitState = (activeLine: Text<typeof slug>, next: SlugTextState): void => {
    applyState(activeLine, next);
    committedState = next;
  };

  /**
   * Presents one committed reflow. `before` is captured only when `glyphOriginPolicy` allows interpolation, so its
   * absence is the decision to snap rather than a missing snapshot.
   */
  const presentReflow = (
    activeLine: Text<typeof slug>,
    before: GlyphOriginSnapshot | undefined,
  ): GlyphOriginPresentation => {
    const fromX = activeLine.position.x;
    const fromY = activeLine.position.y;
    presentation?.transition.dispose();
    presentation = undefined;
    positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio);
    if (before === undefined) return snapGlyphOrigins(activeLine);
    const toX = activeLine.position.x;
    const toY = activeLine.position.y;
    const transition = createFrameDrivenGlyphTransition(activeLine, before);
    activeLine.position.set(fromX, fromY, 0);
    presentation = { transition, fromX, fromY, toX, toY };
    return transitionPresentation(transition);
  };

  /** Captures the origins a reflow may interpolate from, or nothing when the change replaces or reorders glyphs. */
  const originsToInterpolate = (
    activeLine: Text<typeof slug>,
    committed: SlugTextState,
    next: ShapedTextIdentity,
    animatePresentation = true,
  ): GlyphOriginSnapshot | undefined => {
    return captureGlyphOriginsForPresentation(activeLine, committed.identity, next, animatePresentation);
  };

  /**
   * Advances the frame-driven presentation. A superseded transition is a normal outcome of a reflow landing mid-motion,
   * so it retires quietly; anything else is a real failure the surface must see.
   */
  const advancePresentation = (activeLine: Text<typeof slug>, context: PersistentRenderFrameContext): void => {
    const current = presentation;
    if (current === undefined) return;
    try {
      const progress = current.transition.advance(context.timestamp);
      activeLine.position.set(
        current.fromX + (current.toX - current.fromX) * progress,
        current.fromY + (current.toY - current.fromY) * progress,
        0,
      );
      if (progress === 1) presentation = undefined;
    } catch (error) {
      current.transition.dispose();
      presentation = undefined;
      activeLine.position.set(current.toX, current.toY, 0);
      if (!(error instanceof DOMException && error.name === 'AbortError')) onError(error);
    }
  };

  const resizeScene = (viewport: PersistentRenderViewport): void => {
    if (closing || disposed || line === undefined || camera === undefined || canvasSurface === undefined) return;
    const state = committedState;
    if (state === undefined) return;
    const activeLine = line;
    width = positiveViewportSize(viewport.width, 'Slug scene width');
    height = positiveViewportSize(viewport.height, 'Slug scene height');
    canvasSurface.resize(width, height);
    camera.right = width;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    const nextContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
    if (nextContentWidth === committedContentWidth && viewport.dpr === state.rasterPixelRatio) {
      positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio);
      return;
    }
    const updateStartedAt = performance.now();
    const revision = ++updateRevision;
    try {
      // A viewport change leaves the shaped run intact, so its glyphs really do move continuously.
      const before = originsToInterpolate(activeLine, state, state.identity);
      commitState(activeLine, {
        ...state,
        constraints: slugConstraints(nextContentWidth),
        layout: slugLayout(textAlign),
        rasterPixelRatio: viewport.dpr,
      });
      if (closing || disposed || revision !== updateRevision) return;
      committedContentWidth = nextContentWidth;
      const resizeSceneStartedAt = performance.now();
      presentReflow(activeLine, before);
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: 0,
        readyMs: resizeSceneStartedAt - updateStartedAt,
        sceneMs: finishedAt - resizeSceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
    } catch (error) {
      if (!closing && !disposed) onError(error);
    }
  };

  return {
    id: `slug-text-scene-${backend}`,
    async activate(context) {
      if (disposed) throw new DOMException('The Slug scene is disposed', 'InvalidStateError');
      if (scene !== undefined) throw new DOMException('The Slug scene is already active', 'InvalidStateError');
      context.signal.throwIfAborted();
      try {
        activationSignal = context.signal;
        rendererInitMs = context.rendererInitMs;
        width = positiveViewportSize(context.viewport.width, 'Slug scene width');
        height = positiveViewportSize(context.viewport.height, 'Slug scene height');
        committedContentWidth = benchmarkContentWidth(width, layoutWidthRatio);
        scene = new THREE.Scene();
        glyphRoot = createBenchmarkThreeRoot(`slug-text-scene-${backend}`);
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
          signal: context.signal,
          ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
        });
        loadedFont = loaded.loaded;
        const fontLoadMs = performance.now() - fontStarted;
        context.signal.throwIfAborted();
        const rasterConfiguration = slugDataConfiguration(loaded.data);
        fontFixture = createRetainedFontFixtureController(
          {
            fixture: initialFontFixture,
            asset: { font: loaded.loaded, fontLoadMs, loaded, loadedFont, rasterConfiguration },
          },
          // Dispose the application Font lease; live renderer bindings retain their own counted lease.
          { dispose: (asset) => asset.loadedFont.dispose() },
        );
        const textStarted = performance.now();
        const identity: ShapedTextIdentity = { fontFixture: initialFontFixture, text, language, direction, features };
        const state: SlugTextState = {
          font: loadedFont,
          identity,
          constraints: slugConstraints(committedContentWidth),
          layout: slugLayout(textAlign),
          style: slugStyle(fontSize, identity),
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
        const scheduledAt = performance.now();
        // `Text` reconciles while it is parented, so attaching and forcing one world update is what commits the layout.
        scene.add(activeLine);
        activeLine.updateMatrixWorld(true);
        if (activeLine.error !== undefined) throw activeLine.error;
        committedState = state;
        const readyAt = performance.now();
        context.signal.throwIfAborted();
        textReadyMs = performance.now() - textStarted;
        const sceneStartedAt = performance.now();
        positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio);
        const sceneFinishedAt = performance.now();
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - textStarted,
          readyMs: readyAt - scheduledAt,
          sceneMs: sceneFinishedAt - sceneStartedAt,
          totalMs: sceneFinishedAt - textStarted,
        });
        startupMs = performance.now() - startupStarted;
        activationGate.resolve();
      } catch (error) {
        releaseActivationResources();
        activationGate.reject(error);
        throw error;
      }
    },
    frame(context) {
      if (closing || disposed) return;
      const active = activeResources();
      const startedAt = performance.now();
      advancePresentation(active.line, context);
      active.canvasSurface.render(active.scene, active.camera);
      if (!firstDrawRecorded) {
        firstDrawMs = performance.now() - startedAt;
        firstDrawRecorded = true;
      }
    },
    telemetry(snapshot, viewport) {
      if (closing || disposed || fontFixture === undefined || line === undefined || scene === undefined) return;
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
        drawCount: drawCount(scene),
        layoutWidth: layout.width,
        layoutHeight: layout.height,
        lineCount: layout.lineCount,
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
    hasFontFixture(fixture) {
      return !closing && !disposed && fontFixture !== undefined && fontFixture.has(fixture);
    },
    async loadFontFixture(fixture) {
      await activationGate.wait();
      if (closing || disposed) throw new DOMException('The Slug scene is disposed', 'AbortError');
      const activeFontFixture = fontFixture;
      const signal = activationSignal;
      if (activeFontFixture === undefined || signal === undefined) {
        throw new DOMException('The Slug scene is not active', 'InvalidStateError');
      }
      await activeFontFixture.load(fixture, async (requested) => {
        const fontStartedAt = performance.now();
        const loaded = await loadSlugFontAsset({
          technique: 'slug',
          fixture: requested,
          delivery,
          signal,
          ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
        });
        try {
          const rasterConfiguration = slugDataConfiguration(loaded.data);
          return {
            font: loaded.loaded,
            fontLoadMs: performance.now() - fontStartedAt,
            loaded,
            loadedFont: loaded.loaded,
            rasterConfiguration,
          };
        } catch (error) {
          if (loaded.loaded !== activeFontFixture.current.asset.loadedFont) loaded.loaded.dispose();
          throw error;
        }
      });
    },
    update(next) {
      if (closing || disposed) throw new DOMException('The Slug scene is disposed', 'AbortError');
      const active = activeResources();
      const activeLine = active.line;
      const activeFontFixture = fontFixture;
      if (activeFontFixture === undefined) throw new DOMException('The Slug scene is not active', 'InvalidStateError');
      const updateStartedAt = performance.now();
      const nextFontSize = positiveViewportSize(next.fontSize, 'Slug scene font size');
      assertLayoutWidthRatio(next.layoutWidthRatio);
      updateRevision += 1;
      const nextContentWidth = benchmarkContentWidth(width, next.layoutWidthRatio);
      const nextFixture = next.fontFixture ?? activeFontFixture.current.fixture;
      const identity: ShapedTextIdentity = {
        fontFixture: nextFixture,
        text: next.text,
        language: next.language,
        direction: next.direction,
        features: next.features,
      };
      const before = originsToInterpolate(activeLine, active.state, identity, next.animatePresentation);
      activeFontFixture.commit(nextFixture, (fixture) => {
        commitState(activeLine, {
          font: fixture.loadedFont,
          identity,
          constraints: slugConstraints(nextContentWidth),
          layout: slugLayout(next.textAlign),
          style: slugStyle(nextFontSize, identity),
          rasterPixelRatio: active.state.rasterPixelRatio,
        });
        fontSize = nextFontSize;
        anchor = next.anchor;
        textAlign = next.textAlign;
        layoutWidthRatio = next.layoutWidthRatio;
        committedContentWidth = nextContentWidth;
      });
      const updateSceneStartedAt = performance.now();
      const presented = presentReflow(activeLine, before);
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: 0,
        readyMs: updateSceneStartedAt - updateStartedAt,
        sceneMs: finishedAt - updateSceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
      return presented;
    },
    deactivate() {
      if (disposed) return;
      closing = true;
      disposed = true;
      if (line === undefined) {
        activationGate.reject(new DOMException('The Slug persistent scene was deactivated', 'AbortError'));
      }
      releaseActivationResources();
    },
  };
}

function applyState(line: Text<typeof slug>, next: SlugTextState): void {
  line.set({
    font: next.font,
    text: next.identity.text,
    constraints: next.constraints,
    layout: next.layout,
    style: next.style,
    rasterPixelRatio: next.rasterPixelRatio,
  });
  line.visible = next.identity.text.length > 0;
  line.updateMatrixWorld(true);
  if (line.error !== undefined) throw line.error;
}

function slugConstraints(width: number): Constraints {
  return { width: { mode: 'exact', size: width } };
}

function slugLayout(align: 'start' | 'center'): ParagraphLayout {
  return { wrap: 'word', align, overflow: 'visible' };
}

function slugStyle(
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

function positionLiveLine(
  line: Text<typeof slug>,
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

function committedLayout(line: Text<typeof slug>): ParagraphLayoutSummary {
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
    throw new RangeError('Slug scene layout width ratio must be in (0, 1]');
  }
}

function renderedGlyphCount(text: Text<typeof slug>): number {
  return text.measure().glyphCount;
}

function drawCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}
