import { FontRegistry, type FontFeature, type ParagraphLayout, type RegisteredFont } from '@pmndrs/text';
import {
  captureBitmapGlyphPositions,
  createBitmapGlyphPositionTransition,
  selectBitmapStrikePpem,
  type BitmapGlyphPositionSnapshot,
  type BitmapGlyphPositionTransition,
} from '@pmndrs/text/raster/bitmap/v0';
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
import { benchmarkContentWidth, liveTextPosition, type LiveTextAnchor } from '../../workloads/shared/text-style';
import { type RendererBackend } from '../../renderer/webgpu-renderer';
import {
  type PersistentRenderFrameContext,
  type PersistentRenderScene,
  type PersistentRenderSceneContext,
  type PersistentRenderViewport,
} from '../../renderer/persistent-render-host';
import { createPersistentSceneActivation } from '../../renderer/persistent-scene-activation';
import { loadBitmapFontAsset } from '../../workloads/font-assets/bitmap';
import { createBitmapLine, disposeBitmapLine, type BitmapLine } from './line';
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

export interface BitmapTextSceneSnapshot {
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
  update(options: BitmapTextSceneUpdate): Promise<BitmapTextSceneSnapshot>;
  setPresentationProgress(revision: number, progress: number): BitmapTextSceneSnapshot;
  finishPresentation(revision: number): BitmapTextSceneSnapshot;
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
  finishPresentation(revision: number): BitmapTextSceneSnapshot;
  frame(context: PersistentRenderFrameContext): void;
  panBy(deltaX: number, deltaY: number): void;
  resetView(): void;
  resize(viewport: PersistentRenderViewport): void;
  setGridVisible(visible: boolean): void;
  setPresentationProgress(revision: number, progress: number): BitmapTextSceneSnapshot;
  telemetry(
    snapshot: Parameters<NonNullable<PersistentRenderScene['telemetry']>>[0],
    viewport: PersistentRenderViewport,
  ): void;
  update(options: BitmapTextSceneUpdate): Promise<BitmapTextSceneSnapshot>;
  dispose(): void;
}

interface BitmapPersistentFontFixture {
  readonly atlas: Awaited<ReturnType<typeof registeredBitmapAtlas>>;
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  readonly loaded: Awaited<ReturnType<typeof loadBitmapFontAsset>>;
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
    const loadedFont = await loadBitmapFontAsset({
      technique: 'bitmap',
      fixture: fontFixture,
      delivery,
      bitmapDensity: 'live',
      registry,
      signal: context.signal,
      ...(onBakeProgress === undefined ? {} : { onProgress: onBakeProgress }),
    });
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
    const presentationSnapshot = (): BitmapTextSceneSnapshot => {
      const layout = activeLine.object.layout;
      if (layout === undefined) throw new Error('bitmap scene lost its committed layout');
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
    const reflowToViewport = (update?: BitmapTextSceneUpdate): Promise<BitmapTextSceneSnapshot> => {
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
                throw new DOMException('The bitmap scene update was superseded', 'AbortError');
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
            throw new DOMException('The bitmap scene update was superseded', 'AbortError');
          }
          if (activeLine.object.layout === undefined) throw new Error('bitmap scene update did not commit a layout');
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
      update(next) {
        if (closing || disposed) {
          return Promise.reject(new DOMException('The bitmap scene is disposed', 'AbortError'));
        }
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

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
