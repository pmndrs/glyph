import {
  FontRegistry,
  type FontFeature,
  type LoadedFont,
  type ParagraphContentBox,
  type ParagraphLayoutSummary,
  type ParagraphStyle,
  type RegisteredFont,
} from '@pmndrs/text';
import { selectBitmapStrikePpem, type bitmap } from '@pmndrs/text/three/bitmap';
import { Text } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery } from '../../benchmark/url-state';
import { createCanvasSurface } from '../../renderer/canvas-surface';
import { finiteCanvasDelta } from '../../renderer/canvas-view';
import { type LiveFrameHistoryCursor } from '../../renderer/live-frame-telemetry';
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
  type PersistentRenderSceneContext,
  type PersistentRenderViewport,
} from '../../renderer/persistent-render-host';
import { createPersistentSceneActivation } from '../../renderer/persistent-scene-activation';
import { loadBitmapFontAsset, type BitmapFontAsset } from '../../workloads/font-assets/bitmap';
import {
  captureGlyphOrigins,
  createGlyphOriginTransition,
  glyphOriginPolicy,
  snapGlyphOrigins,
  transitionPresentation,
  type GlyphOriginPresentation,
  type GlyphOriginTransition,
  type ShapedTextIdentity,
} from '../shared/glyph-origin-transition';
import { registeredBitmapAtlas, type BitmapAtlasPageStats } from './metadata';

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

export interface BitmapTextSceneUpdate extends LiveFontFixtureUpdate {
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

export interface BitmapTextSceneSnapshot extends GlyphOriginPresentation {
  readonly revision: number;
  readonly presentationProgress: number;
  readonly glyphCount: number;
  readonly lineCount: number;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
}

type BitmapTextPresentation =
  | {
      readonly kind: 'transitioning';
      readonly revision: number;
      readonly transition: GlyphOriginTransition;
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
      readonly presented: GlyphOriginPresentation;
      progress: number;
    }
  | {
      readonly kind: 'settled';
      readonly revision: number;
      readonly presented: GlyphOriginPresentation;
    };

export interface BitmapTextPersistentSceneOptions {
  readonly anchor?: LiveTextAnchor;
  readonly backend: RendererBackend;
  readonly fontSize: number;
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
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: BitmapTextLiveStats) => void;
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener;
  readonly id?: string;
}

export interface BitmapTextPersistentScene extends PersistentRenderScene {
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
  update(options: BitmapTextSceneUpdate): BitmapTextSceneSnapshot;
  setPresentationProgress(revision: number, progress: number): BitmapTextSceneSnapshot;
  finishPresentation(revision: number): BitmapTextSceneSnapshot;
}

/** The shaping and box inputs one committed generation of the live paragraph was built from. */
interface BitmapTextState {
  readonly font: LoadedFont<typeof bitmap>;
  readonly text: string;
  readonly contentBox: ParagraphContentBox;
  readonly style: ParagraphStyle;
}

interface BitmapTextShaping {
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
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

function countMissingGlyphs(layout: ParagraphLayoutSummary): number {
  return layout.missingGlyphCount;
}

function bitmapContentBox(width: number, textAlign: 'start' | 'center'): ParagraphContentBox {
  return { width: { mode: 'exact', size: width }, wrap: 'word', align: textAlign, overflow: 'visible' };
}

function bitmapStyle(fontSize: number, shaping: BitmapTextShaping): ParagraphStyle {
  return {
    fontSize,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    language: shaping.language,
    direction: shaping.direction,
    features: shaping.features,
  };
}

interface ActiveBitmapTextPersistentScene {
  finishPresentation(revision: number): BitmapTextSceneSnapshot;
  frame(context: PersistentRenderFrameContext): void;
  hasFontFixture(fixture: BenchmarkFontFixture): boolean;
  loadFontFixture(fixture: BenchmarkFontFixture): Promise<void>;
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  resize(viewport: PersistentRenderViewport): void;
  setGridVisible(visible: boolean): void;
  setPresentationProgress(revision: number, progress: number): BitmapTextSceneSnapshot;
  telemetry(
    snapshot: Parameters<NonNullable<PersistentRenderScene['telemetry']>>[0],
    viewport: PersistentRenderViewport,
  ): void;
  update(options: BitmapTextSceneUpdate): BitmapTextSceneSnapshot;
  dispose(): void;
}

interface BitmapPersistentFontFixture {
  readonly atlas: Awaited<ReturnType<typeof registeredBitmapAtlas>>;
  /** The registry-scoped font the atlas metadata is read from; the controller keys ownership on it. */
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  readonly loaded: BitmapFontAsset;
  readonly loadedFont: LoadedFont<typeof bitmap>;
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
    hasFontFixture(fixture) {
      return runtime !== undefined && !deactivated && runtime.hasFontFixture(fixture);
    },
    loadFontFixture(fixture) {
      return activation.wait().then((activatedRuntime) => activatedRuntime.loadFontFixture(fixture));
    },
    update(update) {
      return active().update(update);
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
  let currentTextAlign: 'start' | 'center' = textAlign;
  let currentShaping: BitmapTextShaping = { language, direction, features };
  let layoutWidthRatio = options.layoutWidthRatio ?? layoutWidth / width;
  let committedContentWidth = layoutWidth;
  let gridVisible = options.showGrid;
  // PersistentRenderSceneRenderer removes lifecycle methods at the type boundary. CanvasSurface uses only borrowed
  // render commands, so restore the concrete type locally without transferring renderer ownership.
  const renderer = context.renderer as THREE.WebGPURenderer;
  const canvasSurface = createCanvasSurface(renderer, width, viewportHeight, gridVisible);
  const textUpdateTelemetry = createTextUpdateTelemetry();
  const registry = new FontRegistry();
  let loadedFont: LoadedFont<typeof bitmap> | undefined;
  let fontFixtureController: RetainedFontFixtureController<BitmapPersistentFontFixture> | undefined;
  let line: Text<typeof bitmap> | undefined;
  try {
    const fontStarted = performance.now();
    const loadedAsset = await loadBitmapFontAsset({
      technique: 'bitmap',
      fixture: fontFixture,
      delivery,
      bitmapDensity: 'live',
      registry,
      signal: context.signal,
      ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
    });
    loadedFont = loadedAsset.loaded;
    const fontLoadMs = performance.now() - fontStarted;
    context.signal.throwIfAborted();
    const scene = new THREE.Scene();
    const textStarted = performance.now();
    let committedState: BitmapTextState = {
      font: loadedFont,
      text,
      contentBox: bitmapContentBox(layoutWidth, currentTextAlign),
      style: bitmapStyle(fontSize, currentShaping),
    };
    line = new Text({
      font: committedState.font,
      text: committedState.text,
      contentBox: committedState.contentBox,
      style: committedState.style,
      paint: { color: LIVE_TEXT_COLOR_CSS },
      rasterPixelRatio: context.viewport.dpr,
    });
    const activeText = line;
    const scheduledAt = performance.now();
    // `Text` reconciles while it is parented, so attaching and forcing one world update is what commits the layout.
    scene.add(activeText);
    activeText.updateMatrixWorld(true);
    if (activeText.error !== undefined) throw activeText.error;
    const readyAt = performance.now();
    const committedLayout = (): ParagraphLayoutSummary => {
      const layout = activeText.measureLayout();
      if (layout === undefined) throw new Error('live bitmap Text lost its committed layout');
      return layout;
    };
    const initialLayout = committedLayout();
    if (expectedGlyphCount !== undefined) {
      const missing = countMissingGlyphs(initialLayout);
      if (missing !== 0) throw new Error(`benchmark specimen contains ${missing} missing glyphs`);
      const glyphCount = countRenderedGlyphs(activeText);
      if (glyphCount !== expectedGlyphCount) {
        throw new Error(`live workload rendered ${glyphCount} glyphs; expected ${expectedGlyphCount}`);
      }
    }
    const textReadyMs = performance.now() - textStarted;
    updateBitmapDrawVisibility(activeText);
    const atlas = await registeredBitmapAtlas(loadedAsset.loaded.font, 'live');
    fontFixtureController = createRetainedFontFixtureController(
      registry,
      {
        fixture: fontFixture,
        asset: { atlas, font: loadedAsset.loaded.font, fontLoadMs, loaded: loadedAsset, loadedFont },
      },
      // The loaded font owns the registered font, its decoded raster, and the runtime entry; releasing only the
      // registered font would strand the raster this technique still holds.
      { dispose: (asset) => asset.loadedFont.dispose() },
    );
    const activeFontFixture = fontFixtureController;
    context.signal.throwIfAborted();
    textUpdateTelemetry.record({
      scheduleMs: scheduledAt - textStarted,
      readyMs: readyAt - scheduledAt,
      sceneMs: performance.now() - readyAt,
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
      const layout = committedLayout();
      const currentLayoutWidth = anchor === 'center' ? layout.width : benchmarkContentWidth(width, layoutWidthRatio);
      return liveTextPosition(anchor, width, viewportHeight, currentLayoutWidth, layout.height);
    };
    const initialPosition = targetLinePosition();
    activeText.position.set(initialPosition[0], initialPosition[1], 0);
    /**
     * Commits one generation of shaping inputs. A rejected generation is rolled back to the committed one so the
     * failed candidate font is left unleased, which is what lets the fixture controller dispose it.
     */
    const applyState = (next: BitmapTextState): void => {
      activeText.set({ font: next.font, text: next.text, contentBox: next.contentBox, style: next.style });
      activeText.updateMatrixWorld(true);
      if (activeText.error !== undefined) throw activeText.error;
    };
    const commitState = (next: BitmapTextState): void => {
      try {
        applyState(next);
      } catch (error) {
        try {
          applyState(committedState);
        } catch {
          // The rollback cannot improve on the original failure; report the failure the caller asked about.
        }
        throw error;
      }
      committedState = next;
    };
    let presentation: BitmapTextPresentation = {
      kind: 'settled',
      revision: 0,
      presented: { transitioned: false, matchedGlyphs: 0, targetGlyphs: countRenderedGlyphs(activeText) },
    };
    const disposePresentation = (): void => {
      if (presentation.kind !== 'transitioning') return;
      presentation.transition.dispose();
    };
    const presentationSnapshot = (): BitmapTextSceneSnapshot => {
      const layout = committedLayout();
      return {
        ...presentation.presented,
        revision: presentation.revision,
        presentationProgress: presentation.kind === 'settled' ? 1 : presentation.progress,
        glyphCount: countRenderedGlyphs(activeText),
        lineCount: layout.lineCount,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
      };
    };
    const setPresentationProgress = (revision: number, progress: number): BitmapTextSceneSnapshot => {
      if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
        throw new RangeError('bitmap scene presentation progress must be in [0, 1]');
      }
      if (closing || disposed || presentation.revision !== revision) {
        throw new DOMException('The bitmap scene presentation is stale', 'AbortError');
      }
      if (presentation.kind === 'settled') {
        if (progress !== 1) {
          throw new DOMException('The bitmap scene presentation is settled', 'InvalidStateError');
        }
        return presentationSnapshot();
      }
      presentation.transition.setProgress(progress);
      updateBitmapDrawVisibility(activeText);
      activeText.position.set(
        presentation.fromX + (presentation.toX - presentation.fromX) * progress,
        presentation.fromY + (presentation.toY - presentation.fromY) * progress,
        0,
      );
      presentation.progress = progress;
      if (progress === 1) {
        presentation.transition.finish();
        updateBitmapDrawVisibility(activeText);
        presentation = { kind: 'settled', revision: presentation.revision, presented: presentation.presented };
      }
      return presentationSnapshot();
    };
    const loadFixtureAsset = async (
      fixture: BenchmarkFontFixture,
      fixtureRegistry: FontRegistry,
    ): Promise<BitmapPersistentFontFixture> => {
      const fontStartedAt = performance.now();
      const loaded = await loadBitmapFontAsset({
        technique: 'bitmap',
        fixture,
        delivery,
        bitmapDensity: 'live',
        registry: fixtureRegistry,
        signal: context.signal,
        ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
      });
      try {
        const nextAtlas = await registeredBitmapAtlas(loaded.loaded.font, 'live');
        return {
          atlas: nextAtlas,
          font: loaded.loaded.font,
          fontLoadMs: performance.now() - fontStartedAt,
          loaded,
          loadedFont: loaded.loaded,
        };
      } catch (error) {
        if (loaded.loaded !== activeFontFixture.current.asset.loadedFont) loaded.loaded.dispose();
        throw error;
      }
    };
    const committedShapedIdentity = (): ShapedTextIdentity => ({
      fontFixture: activeFontFixture.current.fixture,
      text: committedState.text,
      language: currentShaping.language,
      direction: currentShaping.direction,
      features: currentShaping.features,
    });
    const reflowToViewport = (update?: BitmapTextSceneUpdate): BitmapTextSceneSnapshot => {
      const updateStartedAt = performance.now();
      const revision = ++layoutRevision;
      const fromX = activeText.position.x;
      const fromY = activeText.position.y;
      disposePresentation();
      const targetFontSize = update?.fontSize ?? currentFontSize;
      const targetAnchor = update?.anchor ?? anchor;
      const targetTextAlign = update?.textAlign ?? currentTextAlign;
      const targetShaping: BitmapTextShaping =
        update === undefined
          ? currentShaping
          : { language: update.language, direction: update.direction, features: update.features };
      const targetLayoutWidthRatio = update?.layoutWidthRatio ?? layoutWidthRatio;
      const targetExpectedGlyphCount = update === undefined ? currentExpectedGlyphCount : update.expectedGlyphCount;
      const targetContentWidth = benchmarkContentWidth(width, targetLayoutWidthRatio);
      const targetFixture = update?.fontFixture ?? activeFontFixture.current.fixture;
      const nextText = update?.text ?? committedState.text;
      const policy = glyphOriginPolicy(committedShapedIdentity(), {
        fontFixture: targetFixture,
        text: nextText,
        language: targetShaping.language,
        direction: targetShaping.direction,
        features: targetShaping.features,
      });
      // Capturing origins allocates one map entry per glyph, so a reflow that will snap never pays for the match.
      const previousOrigins = policy === 'transition' ? captureGlyphOrigins(activeText) : undefined;
      const readyUpdateAt = activeFontFixture.commit(targetFixture, (fixture) => {
        if (nextText.length === 0) activeText.visible = false;
        commitState({
          font: fixture.loadedFont,
          text: nextText,
          contentBox: bitmapContentBox(targetContentWidth, targetTextAlign),
          style: bitmapStyle(targetFontSize, targetShaping),
        });
        const committedAt = performance.now();
        updateBitmapDrawVisibility(activeText);
        currentFontSize = targetFontSize;
        currentTextAlign = targetTextAlign;
        currentShaping = targetShaping;
        anchor = targetAnchor;
        layoutWidthRatio = targetLayoutWidthRatio;
        committedContentWidth = targetContentWidth;
        currentExpectedGlyphCount = targetExpectedGlyphCount;
        const committedPosition = targetLinePosition();
        activeText.position.set(committedPosition[0], committedPosition[1], 0);
        return committedAt;
      });
      if (currentExpectedGlyphCount !== undefined && countRenderedGlyphs(activeText) !== currentExpectedGlyphCount) {
        throw new Error(
          `live workload rendered ${countRenderedGlyphs(activeText)} glyphs; expected ${currentExpectedGlyphCount}`,
        );
      }
      const reflowSceneStartedAt = performance.now();
      if (previousOrigins === undefined) {
        presentation = { kind: 'settled', revision, presented: snapGlyphOrigins(activeText) };
      } else {
        const targetPosition = targetLinePosition();
        const transition = createGlyphOriginTransition(activeText, previousOrigins);
        transition.setProgress(0);
        updateBitmapDrawVisibility(activeText);
        activeText.position.set(fromX, fromY, 0);
        presentation = {
          kind: 'transitioning',
          revision,
          transition,
          fromX,
          fromY,
          toX: targetPosition[0],
          toY: targetPosition[1],
          presented: transitionPresentation(transition),
          progress: 0,
        };
      }
      const finishedAt = performance.now();
      textUpdateTelemetry.record({
        scheduleMs: 0,
        readyMs: readyUpdateAt - updateStartedAt,
        sceneMs: finishedAt - reflowSceneStartedAt,
        totalMs: finishedAt - updateStartedAt,
      });
      return presentationSnapshot();
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
        activeText.position.set(targetPosition[0], targetPosition[1], 0);
        return;
      }
      try {
        setPresentationProgress(reflowToViewport().revision, 1);
      } catch (error) {
        if (!closing && !disposed && !(error instanceof DOMException && error.name === 'AbortError')) onError(error);
      }
    };
    return {
      frame() {
        if (closing || disposed) return;
        const startedAt = performance.now();
        updateBitmapDrawVisibility(activeText);
        canvasSurface.render(scene, camera);
        if (firstDrawMs === 0) firstDrawMs = performance.now() - startedAt;
      },
      telemetry(snapshot, viewport) {
        if (closing || disposed) return;
        gpuTimingSupported ||= snapshot.gpuFrameMs !== undefined;
        const currentFontFixture = activeFontFixture.current.asset;
        const layout = committedLayout();
        const strikePpem = selectBitmapStrikePpem(
          currentFontFixture.loadedFont.data.strikes,
          currentFontSize,
          viewport.dpr,
        );
        const framebufferGpuBytes = viewport.drawingBufferWidth * viewport.drawingBufferHeight * 4;
        onStats({
          technique: 'bitmap',
          backend,
          dpr: viewport.dpr,
          showGrid: gridVisible,
          ...snapshot,
          glyphCount: countRenderedGlyphs(activeText),
          missingGlyphCount: countMissingGlyphs(layout),
          drawCount: countDraws(activeText),
          layoutWidth: layout.width,
          layoutHeight: layout.height,
          lineCount: layout.lineCount,
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
        scene.position.x += finiteCanvasDelta(deltaX, 'bitmap scene horizontal pan');
        scene.position.y -= finiteCanvasDelta(deltaY, 'bitmap scene vertical pan');
      },
      resetView() {
        scene.position.set(0, 0, 0);
      },
      setGridVisible(visible) {
        gridVisible = visible;
        canvasSurface.setGridVisible(visible);
      },
      hasFontFixture(fixture) {
        return !closing && !disposed && activeFontFixture.has(fixture);
      },
      loadFontFixture(fixture) {
        if (closing || disposed) {
          return Promise.reject(new DOMException('The bitmap scene is disposed', 'AbortError'));
        }
        return activeFontFixture.load(fixture, loadFixtureAsset);
      },
      update(next) {
        if (closing || disposed) throw new DOMException('The bitmap scene is disposed', 'AbortError');
        positiveViewportSize(next.fontSize, 'bitmap scene font size');
        if (!Number.isFinite(next.layoutWidthRatio) || next.layoutWidthRatio <= 0 || next.layoutWidthRatio > 1) {
          throw new RangeError('bitmap scene layout width ratio must be in (0, 1]');
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
        activeText.removeFromParent();
        activeText.dispose();
        activeFontFixture.dispose();
        canvasSurface.dispose();
      },
    };
  } catch (error) {
    if (line !== undefined) {
      line.removeFromParent();
      line.dispose();
    }
    if (fontFixtureController === undefined) loadedFont?.dispose();
    else fontFixtureController.dispose();
    canvasSurface.dispose();
    throw error;
  }
}

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
