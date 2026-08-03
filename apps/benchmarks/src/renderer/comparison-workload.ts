import { FontRegistry, type AnyRasterInput, type ParagraphLayout, type RegisteredFont } from '@pmndrs/text';
import * as THREE from 'three/webgpu';
import { selectBitmapStrikePpem } from '@pmndrs/text/raster/bitmap';

import type { BenchmarkFontFixture, RasterConformanceSpecimen } from '../benchmark/font-fixtures';
import { ICON_GRID_FONT_FIXTURE } from '../benchmark/font-fixtures';
import type { FontDelivery, RasterTechnique } from '../benchmark/url-state';
import {
  comparisonWorkloadDefinition,
  comparisonWorkloadRequiresIconWindowSuspension as registryRequiresIconWindowSuspension,
  comparisonWorkloadUpdateKind as registryUpdateKind,
} from '../workloads/registry';
import { DYNAMIC_LAYOUT_TEXT, dynamicLayoutWidths } from '../workloads/dynamic-layout';
import {
  ICON_GRID_ITEMS,
  ICON_GRID_LABEL_SIZE,
  ICON_GRID_OVERSCAN_COLUMNS,
  ICON_GRID_OVERSCAN_ROWS,
  advanceIconGridAutoPan,
  createIconGridEntries,
  iconGridAssignments,
  iconGridAutoPanStart,
  iconGridCenteredScroll,
  iconGridContent,
  iconGridLabel,
  iconGridLayout,
  iconGridVirtualWindow,
  positionIconGridEntry,
  resizeIconGridEntries,
  smoothIconGridFrameDelta,
  type IconGridAutoPanState,
  type IconGridFrameDeltaState,
  type IconGridLayout,
  type IconGridVirtualWindow,
} from '../workloads/icon-grid';
import type { MutableTextLadderScenePosition } from '../workloads/text-ladder';
import { ZOOM_TEXT_BASE_CSS_PX } from '../workloads/zoom-text';
import type { ZoomTextAnimationState } from '../workloads/zoom-text';
import type {
  ComparisonWorkloadAnimationScratch,
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadId,
} from '../workloads/contracts';
import { committedTextLayout, type ComparisonWorkloadEntry } from '../workloads/factory-contracts';
import { loadBitmapFont, registeredBitmapAtlas, type BitmapTextLiveStats } from './bitmap-text';
import { createCanvasSurface } from './canvas-surface';
import { createGpuFrameTimer, type GpuFrameTimer } from './gpu-frame-timer';
import { createLiveFrameTelemetry, type LiveFrameTelemetrySnapshot } from './live-frame-telemetry';
import { createTextUpdateTelemetry } from './text-update-telemetry';
import type { FontDeliveryMetrics } from './font-delivery';
import { benchmarkContentWidth } from '../workloads/shared/text-style';
import {
  loadMtsdfFont,
  registeredMtsdfConfiguration,
  type MtsdfRasterConfiguration,
  type MtsdfTextLiveStats,
} from './mtsdf-text';
import type { SlugRasterConfiguration, SlugTextLiveStats } from './slug-text';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from './webgpu-renderer';
import type {
  PersistentRenderFrameContext,
  PersistentRenderScene,
  PersistentRenderSceneContext,
  PersistentRenderViewport,
} from './persistent-render-host';
import { createPersistentSceneActivation } from './persistent-scene-activation';
import { createRetainedFontFixtureController, type RetainedFontFixtureController } from './retained-font-fixture';

type WorkloadEntry = ComparisonWorkloadEntry;

export type { ComparisonWorkloadConfiguration, ComparisonWorkloadId, IconGridView } from '../workloads/contracts';
export type { MutableTextLadderScenePosition } from '../workloads/text-ladder';
export {
  advanceIconGridAutoPan,
  iconGridAssignmentSignature,
  iconGridAutoPanStart,
  iconGridCenteredScroll,
  iconGridLayout,
  iconGridVirtualWindow,
  iconGridViewportUpdateKind,
  smoothIconGridFrameDelta,
} from '../workloads/icon-grid';
export type { IconGridAutoPanState } from '../workloads/icon-grid';
export {
  dynamicLayoutWidths,
  ladderCssSizes,
  OFF_AXIS_SPANS,
  OFF_AXIS_TEXT,
  paintWordHue,
  setTextLadderScenePosition,
  shuffleZoomTextPhrases,
  textLadderScenePosition,
  ZOOM_TEXT_BASE_CSS_PX,
  ZOOM_TEXT_CORPUS,
  ZOOM_TEXT_PHRASES,
  zoomTextAnimationState,
  zoomTextMaximumScale,
} from '../workloads/index';

export type ComparisonWorkloadStats = (BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats) & {
  readonly configurationRevision: number;
  readonly appliedFontFixture: BenchmarkFontFixture;
  readonly cameraKind: 'orthographic' | 'perspective';
  readonly workload: ComparisonWorkloadId;
  readonly appliedAmount: number;
  readonly appliedAnimationEnabled: boolean;
  readonly appliedAnimationSpeed: number;
  readonly appliedFontSize: number;
  readonly appliedLayoutWidthRatio: number;
  readonly appliedPaintOpacity: number;
  readonly appliedPaintShadowEnabled: boolean;
  readonly appliedPaintStrokeWidth: number;
  readonly appliedShowLayoutBounds: boolean;
  readonly reflowCount: number;
  readonly lastReflowMs: number;
  readonly paintRevision: number;
  readonly lastPaintUpdateMs: number;
  readonly sourceTextLength: number;
  readonly iconItemCount: number;
  readonly iconLabelCount: number;
  readonly iconColumnCount: number;
  readonly iconRowCount: number;
  readonly iconGridWidth: number;
  readonly iconGridHeight: number;
  readonly iconLabelSize: number;
  readonly iconPoolCapacity: number;
  readonly iconAssignedCount: number;
  readonly iconRenderVisibleCount: number;
  readonly iconAssignmentSignature: string;
  readonly iconFirstVisibleIndex: number;
  readonly iconLastVisibleIndex: number;
  readonly iconRecycleCount: number;
  readonly iconWindowRevision: number;
  readonly iconOverscanRows: number;
  readonly iconOverscanColumns: number;
  readonly iconScrollX: number;
  readonly iconScrollY: number;
  readonly iconMaximumScrollX: number;
  readonly iconMaximumScrollY: number;
  readonly zoomText: string | undefined;
  readonly zoomLanguage: string | undefined;
  readonly zoomPhraseIndex: number;
  readonly zoomPhraseRevision: number;
  readonly zoomBaseCssPx: number;
  readonly zoomEffectiveCssPx: number;
  readonly zoomMaximumCssPx: number;
  readonly zoomScale: number;
  readonly zoomMaximumScale: number;
};

export interface ComparisonWorkloadPreview {
  resize(width: number, height: number): void;
  panBy(deltaX: number, deltaY: number): { readonly deltaX: number; readonly deltaY: number } | void;
  resetView(): void;
  zoomBy(factor: number): void;
  update(configuration: ComparisonWorkloadConfiguration): Promise<void>;
  dispose(): Promise<void>;
}

export interface ComparisonWorkloadPreviewOptions {
  readonly amount: number;
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly fontSize: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly delivery: FontDelivery;
  readonly height: number;
  readonly layoutWidthRatio: number;
  readonly paintOpacity: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokeWidth: number;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly textLadderExitEnabled: boolean;
  readonly signal?: AbortSignal;
  readonly slugBakedArtifact?: import('./slug-text').SlugBakedArtifactSource;
  readonly technique: RasterTechnique;
  readonly textLadderSpecimen?: RasterConformanceSpecimen;
  readonly width: number;
  readonly workload: ComparisonWorkloadId;
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: ComparisonWorkloadStats) => void;
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener;
}

export type ComparisonWorkloadPersistentSceneOptions = Omit<
  ComparisonWorkloadPreviewOptions,
  'canvas' | 'dpr' | 'height' | 'signal' | 'width'
> & { readonly id?: string };

export interface ComparisonWorkloadPersistentScene extends PersistentRenderScene {
  panBy(deltaX: number, deltaY: number): { readonly deltaX: number; readonly deltaY: number } | void;
  resetView(): void;
  zoomBy(factor: number): void;
  update(configuration: ComparisonWorkloadConfiguration): Promise<void>;
}

interface MutableVisibleEntryMetrics {
  drawCount: number;
  glyphCount: number;
  layoutHeight: number;
  layoutWidth: number;
  lineCount: number;
  missingGlyphCount: number;
  sourceTextLength: number;
}

interface MutableLoadedFontMetrics {
  artifactBytes: number;
  atlasGpuBytes: number;
  coreArtifactBytes: number;
  coreBakeMs: number;
  fontLoadMs: number;
  rasterArtifactBytes: number;
  rasterBakeMs: number;
  slugCurveGpuBytes: number;
  slugCurveTexelCount: number;
  slugGpuBytes: number;
  slugHeaderCount: number;
  slugHeaderGpuBytes: number;
  slugPageCount: number;
  slugReferenceCount: number;
  slugReferenceGpuBytes: number;
  sourceFontBytes: number;
}

interface LoadedTechniqueFont {
  readonly artifactBytes: number;
  readonly atlasGpuBytes: number;
  readonly atlasPages: BitmapTextLiveStats['atlasPages'];
  readonly bitmapStrikes: readonly { readonly ppem: number }[];
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  readonly metrics: FontDeliveryMetrics;
  readonly mtsdfConfiguration?: MtsdfRasterConfiguration;
  readonly slugConfiguration?: SlugRasterConfiguration;
  readonly raster: AnyRasterInput;
}

interface PendingConfigurationUpdate {
  configuration: ComparisonWorkloadConfiguration;
  viewportChanged: boolean;
  readonly waiters: Array<{
    readonly resolve: () => void;
    readonly reject: (reason: unknown) => void;
  }>;
}

const ICON_GRID_AUTO_PAN_PX_PER_SECOND = 160;

interface ComparisonWorkloadRuntime extends ComparisonWorkloadPreview {
  persistentFrame(context: PersistentRenderFrameContext): void;
  persistentTelemetry(snapshot: LiveFrameTelemetrySnapshot, viewport: PersistentRenderViewport): void;
}

type ComparisonWorkloadRuntimeOptions = Omit<ComparisonWorkloadPreviewOptions, 'canvas'> & {
  readonly canvas?: HTMLCanvasElement;
};

export function createComparisonWorkloadPersistentScene(
  options: ComparisonWorkloadPersistentSceneOptions,
): ComparisonWorkloadPersistentScene {
  let runtime: ComparisonWorkloadRuntime | undefined;
  let activated = false;
  let deactivated = false;
  const activation = createPersistentSceneActivation<ComparisonWorkloadRuntime>();
  const active = (): ComparisonWorkloadRuntime => {
    if (runtime === undefined || deactivated) {
      throw new DOMException('The comparison workload scene is not active', 'InvalidStateError');
    }
    return runtime;
  };
  return {
    id: options.id ?? `comparison-${options.technique}-${options.workload}`,
    async activate(context) {
      if (activated)
        throw new DOMException('The comparison workload scene cannot be activated twice', 'InvalidStateError');
      activated = true;
      try {
        runtime = await createComparisonWorkloadRuntime(
          {
            ...options,
            dpr: context.viewport.dpr,
            height: context.viewport.height,
            signal: context.signal,
            width: context.viewport.width,
          },
          context,
        );
        activation.resolve(runtime);
      } catch (error) {
        activation.reject(error);
        throw error;
      }
    },
    frame(context) {
      active().persistentFrame(context);
    },
    telemetry(snapshot, viewport) {
      active().persistentTelemetry(snapshot, viewport);
    },
    resize(viewport) {
      active().resize(viewport.width, viewport.height);
    },
    async deactivate() {
      if (deactivated) return;
      deactivated = true;
      activation.reject(new DOMException('The comparison workload scene was deactivated', 'AbortError'));
      await runtime?.dispose();
      runtime = undefined;
    },
    panBy(deltaX, deltaY) {
      return active().panBy(deltaX, deltaY);
    },
    resetView() {
      active().resetView();
    },
    zoomBy(factor) {
      active().zoomBy(factor);
    },
    update(configuration) {
      return activation.wait().then((activatedRuntime) => activatedRuntime.update(configuration));
    },
  };
}

export async function createComparisonWorkloadPreview(
  options: ComparisonWorkloadPreviewOptions,
): Promise<ComparisonWorkloadPreview> {
  return createComparisonWorkloadRuntime(options);
}

async function createComparisonWorkloadRuntime(
  options: ComparisonWorkloadRuntimeOptions,
  persistentContext?: PersistentRenderSceneContext,
): Promise<ComparisonWorkloadRuntime> {
  const persistent = persistentContext !== undefined;
  const { backend, onError, onStats, technique } = options;
  const signal = persistentContext?.signal ?? options.signal;
  const dpr = persistentContext?.viewport.dpr ?? options.dpr;
  signal?.throwIfAborted();
  if (options.slugBakedArtifact !== undefined && technique !== 'slug') {
    throw new TypeError('a Slug candidate artifact requires the Slug technique');
  }
  if (options.slugBakedArtifact !== undefined && options.delivery !== 'baked') {
    throw new TypeError('a retained Slug candidate artifact requires baked delivery');
  }
  let width = positive(persistentContext?.viewport.width ?? options.width, 'comparison workload width');
  let height = positive(persistentContext?.viewport.height ?? options.height, 'comparison workload height');
  let configuration = validateConfiguration(options);
  const startupStarted = performance.now();
  const rendererStarted = performance.now();
  if (!persistent && options.canvas === undefined) {
    throw new TypeError('a standalone comparison workload requires a canvas');
  }
  const renderer =
    persistentContext === undefined
      ? await createConfiguredRenderer({
          backend,
          canvas: options.canvas!,
          dpr,
          height,
          trackGpuTimestamps: backend === 'webgpu',
          width,
        })
      : (persistentContext.renderer as THREE.WebGPURenderer);
  let rendererViewport =
    persistentContext === undefined
      ? readRendererViewportState(renderer)
      : {
          drawingBufferHeight: persistentContext.viewport.drawingBufferHeight,
          drawingBufferWidth: persistentContext.viewport.drawingBufferWidth,
          pixelRatio: persistentContext.viewport.dpr,
        };
  const canvasSurface = createCanvasSurface(renderer, width, height, configuration.showGrid);
  let gpuFrameTimer: GpuFrameTimer | undefined;
  const rendererInitMs = persistentContext?.rendererInitMs ?? performance.now() - rendererStarted;
  let font: LoadedTechniqueFont | undefined;
  let iconFont: LoadedTechniqueFont | undefined;
  let selectedFontController: RetainedFontFixtureController<LoadedTechniqueFont> | undefined;
  let entries: readonly WorkloadEntry[] = [];
  let revision = 0;
  let disposed = false;
  let closing = false;
  let firstDrawMs = 0;
  let uploadFrameGpuMs: number | undefined;
  let uploadFrameCompleteMs: number | undefined;
  let textReadyMs = 0;
  let disposal: Promise<void> | undefined;
  let reflowCount = 0;
  let lastReflowMs = 0;
  let animationEpoch = performance.now();
  const zoomAnimationState: ZoomTextAnimationState = { phraseIndex: 0, phraseRevision: 0, progress: 0 };
  const textLadderPositionScratch: MutableTextLadderScenePosition = { x: 0, y: 0 };
  const dynamicWidthsScratch = new Float64Array(DYNAMIC_LAYOUT_TEXT.length);
  const workloadAnimationScratch: ComparisonWorkloadAnimationScratch = {
    dynamicWidths: dynamicWidthsScratch,
    textLadderPosition: textLadderPositionScratch,
    zoomText: zoomAnimationState,
  };
  const iconAutoPanState: IconGridAutoPanState = { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };
  const iconFrameDeltaState: IconGridFrameDeltaState = { smoothedElapsedMs: undefined };
  let iconAutoPanTimestamp: number | undefined;
  let iconWindowRequestScrollX = 0;
  let iconWindowRequestScrollY = 0;
  const scene = new THREE.Scene();
  let camera = createWorkloadCamera(configuration.workload, width, height);
  gpuFrameTimer = persistent ? undefined : createGpuFrameTimer({ backend, renderer, onError });
  const telemetry = persistent
    ? undefined
    : createLiveFrameTelemetry({ gpuTimingSupported: gpuFrameTimer?.supported ?? false });
  const textUpdateTelemetry = createTextUpdateTelemetry();
  const visibleEntryMetrics: MutableVisibleEntryMetrics = {
    drawCount: 0,
    glyphCount: 0,
    layoutHeight: 0,
    layoutWidth: 0,
    lineCount: 0,
    missingGlyphCount: 0,
    sourceTextLength: 0,
  };
  const visibleGeometryScratch = new Set<THREE.InstancedBufferGeometry>();
  const loadedFontMetrics: MutableLoadedFontMetrics = {
    artifactBytes: 0,
    atlasGpuBytes: 0,
    coreArtifactBytes: 0,
    coreBakeMs: 0,
    fontLoadMs: 0,
    rasterArtifactBytes: 0,
    rasterBakeMs: 0,
    slugCurveGpuBytes: 0,
    slugCurveTexelCount: 0,
    slugGpuBytes: 0,
    slugHeaderCount: 0,
    slugHeaderGpuBytes: 0,
    slugPageCount: 0,
    slugReferenceCount: 0,
    slugReferenceGpuBytes: 0,
    sourceFontBytes: 0,
  };
  let gpuTimingSupported = renderer.hasFeature('timestamp-query');
  let persistentSnapshot: LiveFrameTelemetrySnapshot | undefined;

  try {
    const sharedRegistry = new FontRegistry({ maxArtifactBytes: 64 * 1024 * 1024 });
    font = await loadTechniqueFont(
      technique,
      configuration.fontFixture,
      options.delivery,
      signal,
      options.onBakeProgress,
      options.slugBakedArtifact,
      sharedRegistry,
    );
    if (configuration.workload === 'icon-grid') {
      iconFont = await loadTechniqueFont(
        technique,
        ICON_GRID_FONT_FIXTURE,
        options.delivery,
        signal,
        options.onBakeProgress,
        undefined,
        sharedRegistry,
      );
    }
    selectedFontController = createRetainedFontFixtureController(
      sharedRegistry,
      { fixture: configuration.fontFixture, asset: font },
      {
        // The selected label fixture and fixed icon fixture can deduplicate to one registry font. In that case the
        // fixed icon owner releases the shared handle at teardown; a label switch must not invalidate its Texts.
        dispose: (loaded) => {
          if (loaded.font !== iconFont?.font) loaded.font.dispose();
        },
      },
    );
    const activeSelectedFont = selectedFontController;
    const activeFont = (): LoadedTechniqueFont => activeSelectedFont.current.asset;
    const loadedFontsScratch: LoadedTechniqueFont[] = [];
    const loadedFonts = (): readonly LoadedTechniqueFont[] => {
      loadedFontsScratch[0] = activeFont();
      if (iconFont === undefined) loadedFontsScratch.length = 1;
      else {
        loadedFontsScratch[1] = iconFont;
        loadedFontsScratch.length = 2;
      }
      return loadedFontsScratch;
    };
    let cachedBitmapAtlasPrimary: LoadedTechniqueFont | undefined;
    let cachedBitmapAtlasSecondary: LoadedTechniqueFont | undefined;
    let cachedBitmapAtlasPages: BitmapTextLiveStats['atlasPages'] = [];
    const bitmapAtlasPages = (fonts: readonly LoadedTechniqueFont[]): BitmapTextLiveStats['atlasPages'] => {
      const primary = fonts[0];
      const secondary = fonts[1];
      if (primary !== cachedBitmapAtlasPrimary || secondary !== cachedBitmapAtlasSecondary) {
        cachedBitmapAtlasPrimary = primary;
        cachedBitmapAtlasSecondary = secondary;
        cachedBitmapAtlasPages = combineBitmapAtlasPages(fonts);
      }
      return cachedBitmapAtlasPages;
    };
    const statsFont = (): LoadedTechniqueFont => iconFont ?? activeFont();
    let iconRecycleCount = 0;
    let iconWindowRevision = 0;
    let iconAssignmentSignature = '[]';
    let settledIconWindow: IconGridVirtualWindow | undefined;
    let pendingIconWindow: IconGridVirtualWindow | undefined;
    let iconWindowRefreshing = false;
    let iconWindowSuspended = false;
    let iconWindowRefreshDeferred = false;
    let fontFixtureSwitching = false;
    let fontFixtureCommitting = false;
    let committedContentWidth = comparisonWorkloadContentWidth(configuration, width);
    const desiredIconEpochs = new Uint32Array(ICON_GRID_ITEMS.length);
    const retainedIconEpochs = new Uint32Array(ICON_GRID_ITEMS.length);
    const availableIconEntries: WorkloadEntry[] = [];
    const pendingIconEntries: WorkloadEntry[] = [];
    const missingIconIndices: number[] = [];
    let iconAssignmentEpoch = 0;

    async function switchSelectedFontFixture(nextFixture: BenchmarkFontFixture): Promise<void> {
      if (nextFixture === activeSelectedFont.current.fixture) return;
      const targetTexts =
        configuration.workload === 'icon-grid'
          ? entries.flatMap(({ labelText }) => (labelText === undefined ? [] : [labelText]))
          : entries.map(({ text }) => text);
      const updateStartedAt = performance.now();
      let scheduledAt = updateStartedAt;
      fontFixtureSwitching = true;
      try {
        await activeSelectedFont.update({
          fixture: nextFixture,
          isCurrent: () => !closing && !disposed,
          load: (fixture, registry) =>
            loadTechniqueFont(
              technique,
              fixture,
              options.delivery,
              signal,
              options.onBakeProgress,
              options.slugBakedArtifact,
              registry,
            ),
          commit: async (nextFont) => {
            scheduledAt = performance.now();
            fontFixtureCommitting = true;
            try {
              applyRetainedTextFontFixture(targetTexts, activeSelectedFont.current.asset, nextFont);
            } finally {
              fontFixtureCommitting = false;
            }
          },
        });
      } finally {
        fontFixtureSwitching = false;
      }
      const finishedAt = performance.now();
      textReadyMs = finishedAt - updateStartedAt;
      textUpdateTelemetry.record({
        scheduleMs: scheduledAt - updateStartedAt,
        readyMs: finishedAt - scheduledAt,
        sceneMs: 0,
        totalMs: finishedAt - updateStartedAt,
      });
    }

    async function commit(next: ComparisonWorkloadConfiguration): Promise<void> {
      const workloadChanged = next.workload !== configuration.workload;
      const nextCamera = workloadChanged ? createWorkloadCamera(next.workload, width, height) : camera;
      if (next.workload === 'icon-grid' && iconFont === undefined) {
        iconFont = await loadTechniqueFont(
          technique,
          ICON_GRID_FONT_FIXTURE,
          options.delivery,
          signal,
          options.onBakeProgress,
          undefined,
          sharedRegistry,
        );
      }
      if (next.workload === 'icon-grid' && !workloadChanged) {
        clampIconGridScene(scene, next.fontSize, width, height);
      }
      const commitRevision = ++revision;
      const readyStarted = performance.now();
      const initialIconWindow =
        workloadChanged && next.workload === 'icon-grid'
          ? iconGridVirtualWindow(ICON_GRID_ITEMS.length, next.fontSize, width, height, 0, 0)
          : undefined;
      const initialIconPan =
        initialIconWindow === undefined
          ? undefined
          : iconGridAutoPanStart(
              next.iconGridView ?? 'origin',
              initialIconWindow.maximumScrollX,
              initialIconWindow.maximumScrollY,
            );
      const nextEntries = createEntries(
        activeFont().font,
        activeFont().raster,
        technique,
        next,
        rendererViewport.pixelRatio,
        width,
        height,
        workloadChanged ? 0 : performance.now() - animationEpoch,
        options.textLadderSpecimen,
        iconFont,
        initialIconPan?.scrollX ?? (workloadChanged ? 0 : -scene.position.x),
        initialIconPan?.scrollY ?? (workloadChanged ? 0 : scene.position.y),
      );
      const scheduledAt = performance.now();
      try {
        await Promise.all(nextEntries.flatMap(entryReadyPromises));
        const readyAt = performance.now();
        if (disposed || commitRevision !== revision) {
          disposeEntries(nextEntries);
          return;
        }
        const sceneStartedAt = performance.now();
        layoutEntries(nextEntries, next, width, height);
        const previous = entries;
        entries = nextEntries;
        configuration = next;
        committedContentWidth = comparisonWorkloadContentWidth(next, width);
        if (workloadChanged) {
          scene.position.set(-(initialIconPan?.scrollX ?? 0), initialIconPan?.scrollY ?? 0, 0);
          camera = nextCamera;
          animationEpoch = performance.now();
          zoomAnimationState.phraseIndex = 0;
          zoomAnimationState.phraseRevision = 0;
          zoomAnimationState.progress = 0;
          iconAutoPanState.directionX = initialIconPan?.directionX ?? 1;
          iconAutoPanState.directionY = initialIconPan?.directionY ?? 1;
          iconAutoPanState.scrollX = initialIconPan?.scrollX ?? 0;
          iconAutoPanState.scrollY = initialIconPan?.scrollY ?? 0;
          iconAutoPanTimestamp = undefined;
          iconFrameDeltaState.smoothedElapsedMs = undefined;
          iconWindowRequestScrollX = initialIconPan?.scrollX ?? 0;
          iconWindowRequestScrollY = initialIconPan?.scrollY ?? 0;
          settledIconWindow = undefined;
        }
        scene.clear();
        for (const { node } of entries) scene.add(node);
        disposeEntries(previous);
        const finishedAt = performance.now();
        textReadyMs = finishedAt - readyStarted;
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - readyStarted,
          readyMs: readyAt - scheduledAt,
          sceneMs: finishedAt - sceneStartedAt,
          totalMs: finishedAt - readyStarted,
        });
        if (next.workload === 'icon-grid') {
          settleIconWindow(
            iconGridVirtualWindow(
              ICON_GRID_ITEMS.length,
              next.fontSize,
              width,
              height,
              -scene.position.x,
              scene.position.y,
            ),
          );
        }
      } catch (error) {
        disposeEntries(nextEntries);
        throw error;
      }
    }

    function applyIconWindow(window: IconGridVirtualWindow): void {
      if (iconFont === undefined || configuration.workload !== 'icon-grid') return;
      if (window.poolCapacity !== entries.length) {
        throw new Error('icon grid pool capacity changed without a scene rebuild');
      }
      let recycled = 0;
      iconAssignmentEpoch = (iconAssignmentEpoch + 1) >>> 0;
      if (iconAssignmentEpoch === 0) {
        desiredIconEpochs.fill(0);
        retainedIconEpochs.fill(0);
        iconAssignmentEpoch = 1;
      }
      availableIconEntries.length = 0;
      pendingIconEntries.length = 0;
      missingIconIndices.length = 0;
      for (const index of window.indices) desiredIconEpochs[index] = iconAssignmentEpoch;
      for (const entry of entries) {
        const iconIndex = entry.virtualIconIndex;
        if (
          iconIndex !== undefined &&
          desiredIconEpochs[iconIndex] === iconAssignmentEpoch &&
          retainedIconEpochs[iconIndex] !== iconAssignmentEpoch
        ) {
          retainedIconEpochs[iconIndex] = iconAssignmentEpoch;
          continue;
        }
        availableIconEntries.push(entry);
      }
      for (const index of window.indices) {
        if (retainedIconEpochs[index] !== iconAssignmentEpoch) missingIconIndices.push(index);
      }
      if (missingIconIndices.length > availableIconEntries.length) {
        throw new Error('icon grid window exceeds its recyclable tile pool');
      }
      for (const [missingIndex, iconIndex] of missingIconIndices.entries()) {
        const entry = availableIconEntries[missingIndex]!;
        const { glyph } = iconGridContent(iconIndex);
        // Keep the old assignment visible while every warm replacement is staged. The Three.js lifecycle publishes
        // the staged generations together below; no consumer promise coordinates ordinary warm recycling.
        entry.text.setProperties({ text: glyph });
        entry.labelText?.setProperties({ text: iconGridLabel(iconIndex) });
        recycled += 1;
        pendingIconEntries.push(entry);
      }
      publishEntryUpdates(pendingIconEntries);
      if (closing || disposed) return;
      for (const [index, entry] of pendingIconEntries.entries()) {
        if (entry.disposed) continue;
        const iconIndex = missingIconIndices[index]!;
        const { content } = iconGridContent(iconIndex);
        entry.virtualIconIndex = iconIndex;
        entry.sourceText = content;
        const column = iconIndex % window.layout.columns;
        const row = Math.floor(iconIndex / window.layout.columns);
        positionIconGridEntry(entry, window.layout, column, row, configuration.fontSize);
      }
      for (let index = missingIconIndices.length; index < availableIconEntries.length; index += 1) {
        const entry = availableIconEntries[index]!;
        entry.node.visible = false;
        delete entry.virtualIconIndex;
      }
      iconRecycleCount += recycled;
      settleIconWindow(window);
    }

    async function resizeIconPool(poolCapacity: number, iconSize: number, layout: IconGridLayout): Promise<void> {
      if (iconFont === undefined) throw new Error('icon grid lost its icon font fixture');
      if (poolCapacity > entries.length) {
        const additions = createIconGridEntries({
          count: poolCapacity - entries.length,
          dpr: rendererViewport.pixelRatio,
          iconFont,
          iconSize,
          labelFont: activeFont().font,
          labelRaster: activeFont().raster,
        });
        try {
          await Promise.all(additions.flatMap(entryReadyPromises));
        } catch (error) {
          disposeEntries(additions);
          throw error;
        }
        if (closing || disposed) {
          disposeEntries(additions);
          return;
        }
        entries = [...entries, ...additions];
        for (const { node } of additions) scene.add(node);
      } else if (poolCapacity < entries.length) {
        const removed = entries.slice(poolCapacity);
        entries = entries.slice(0, poolCapacity);
        for (const { node } of removed) scene.remove(node);
        disposeEntries(removed);
      }
      resizeIconGridEntries(entries, iconSize, layout);
    }

    function settleIconWindow(window: IconGridVirtualWindow): void {
      const assignments = iconGridAssignments(entries);
      if (
        assignments.length !== window.indices.length ||
        assignments.some(({ index }, assignmentIndex) => index !== window.indices[assignmentIndex])
      ) {
        throw new Error('icon grid cannot publish a window before every assignment is coherent');
      }
      // The scene keeps moving while offscreen replacements shape asynchronously. Publish their assignment against
      // the live scroll position; using the request-time window here flashes the visible set one frame backward.
      updateIconGridEntryVisibility(entries, window.layout, -scene.position.x, scene.position.y, width, height);
      settledIconWindow = window;
      iconAssignmentSignature = JSON.stringify(assignments);
      iconWindowRevision += 1;
    }

    function requestIconWindowRefresh(): void {
      if (configuration.workload !== 'icon-grid' || closing || disposed) return;
      iconWindowRequestScrollX = -scene.position.x;
      iconWindowRequestScrollY = scene.position.y;
      if (iconWindowSuspended) {
        iconWindowRefreshDeferred = true;
        return;
      }
      pendingIconWindow = iconGridVirtualWindow(
        ICON_GRID_ITEMS.length,
        configuration.fontSize,
        width,
        height,
        -scene.position.x,
        scene.position.y,
      );
      if (iconWindowRefreshing) return;
      iconWindowRefreshing = true;
      try {
        while (pendingIconWindow !== undefined) {
          if (closing || disposed) break;
          const nextWindow = pendingIconWindow;
          pendingIconWindow = undefined;
          applyIconWindow(nextWindow);
        }
      } catch (error) {
        onError(error);
      } finally {
        iconWindowRefreshing = false;
      }
      if (pendingIconWindow !== undefined && !closing && !disposed) requestIconWindowRefresh();
    }

    await commit(configuration);
    signal?.throwIfAborted();
    let requestedConfiguration = configuration;
    let pendingUpdate: PendingConfigurationUpdate | undefined;
    let updateDrain: Promise<void> | undefined;

    async function applyConfiguration(next: ComparisonWorkloadConfiguration, viewportChanged: boolean): Promise<void> {
      canvasSurface.setGridVisible(next.showGrid);
      if (next.fontFixture !== configuration.fontFixture) await switchSelectedFontFixture(next.fontFixture);
      if (configuration.workload === 'zoom-text' && next.workload === 'zoom-text' && viewportChanged) {
        configuration = next;
        committedContentWidth = undefined;
        revision += 1;
        comparisonWorkloadDefinition('zoom-text').layout(entries, {
          configuration,
          viewportHeight: height,
          viewportWidth: width,
        });
        applyRetainedConfiguration(entries, technique, configuration);
        return;
      }
      if (
        configuration.workload === 'icon-grid' &&
        next.workload === 'icon-grid' &&
        (viewportChanged ||
          next.fontSize !== configuration.fontSize ||
          next.iconGridView !== configuration.iconGridView)
      ) {
        const viewChanged = next.iconGridView !== configuration.iconGridView;
        const [requestedScrollX, requestedScrollY] = viewChanged
          ? (() => {
              const origin = iconGridVirtualWindow(ICON_GRID_ITEMS.length, next.fontSize, width, height, 0, 0);
              const start = iconGridAutoPanStart(
                next.iconGridView ?? 'origin',
                origin.maximumScrollX,
                origin.maximumScrollY,
              );
              iconAutoPanState.directionX = start.directionX;
              iconAutoPanState.directionY = start.directionY;
              iconFrameDeltaState.smoothedElapsedMs = undefined;
              return [start.scrollX, start.scrollY] as const;
            })()
          : next.fontSize === configuration.fontSize
            ? [-scene.position.x, scene.position.y]
            : iconGridCenteredScroll(
                ICON_GRID_ITEMS.length,
                configuration.fontSize,
                next.fontSize,
                width,
                height,
                -scene.position.x,
                scene.position.y,
              );
        const nextWindow = iconGridVirtualWindow(
          ICON_GRID_ITEMS.length,
          next.fontSize,
          width,
          height,
          requestedScrollX,
          requestedScrollY,
        );
        await resizeIconPool(nextWindow.poolCapacity, next.fontSize, nextWindow.layout);
        // Pool growth is genuinely cold and stays detached while it loads. Publish size, position, and assignments
        // in one continuation so the live scene never exposes new camera coordinates with the old tile defaults.
        scene.position.set(-nextWindow.scrollX, nextWindow.scrollY, 0);
        await applyIconWindow(nextWindow);
        configuration = next;
        committedContentWidth = undefined;
        revision += 1;
        applyRetainedConfiguration(entries, technique, configuration);
        return;
      }
      const nextContentWidth = comparisonWorkloadContentWidth(next, width);
      const contentWidthChanged = nextContentWidth !== committedContentWidth;
      const fontSizeChanged = next.fontSize !== configuration.fontSize;
      if (comparisonWorkloadUpdateKind(configuration, next, contentWidthChanged) === 'rebuild') {
        await commit(next);
        return;
      }
      if (contentWidthChanged || fontSizeChanged) {
        const readyStarted = performance.now();
        const retainedWidths = contentWidthChanged
          ? next.workload === 'dynamic-layout'
            ? dynamicLayoutWidths(next, width, performance.now() - animationEpoch)
            : nextContentWidth === undefined
              ? undefined
              : entries.map(() => nextContentWidth)
          : undefined;
        if (next.workload === 'dynamic-layout' && retainedWidths !== undefined) {
          for (const [index, entry] of entries.entries()) {
            entry.lastWidth = retainedWidths[index]!;
            if (entry.widthUpdate === undefined) {
              throw new Error('dynamic layout entry is missing its retained width update');
            }
            entry.widthUpdate.width = retainedWidths[index]!;
          }
        }
        const scheduledAt = performance.now();
        applyRetainedTextLayout(
          entries.map(({ text }) => text),
          retainedWidths,
          fontSizeChanged ? next.fontSize : undefined,
        );
        const readyAt = performance.now();
        const sceneStartedAt = performance.now();
        layoutEntries(entries, next, width, height);
        const finishedAt = performance.now();
        textReadyMs = finishedAt - readyStarted;
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - readyStarted,
          readyMs: readyAt - scheduledAt,
          sceneMs: finishedAt - sceneStartedAt,
          totalMs: finishedAt - readyStarted,
        });
        recordReflow(finishedAt - readyStarted);
      } else if (viewportChanged) {
        layoutEntries(entries, next, width, height);
      }
      configuration = next;
      committedContentWidth = nextContentWidth;
      revision += 1;
      applyRetainedConfiguration(entries, technique, configuration);
    }

    function startUpdateDrain(): void {
      if (updateDrain !== undefined) return;
      updateDrain = (async () => {
        while (pendingUpdate !== undefined) {
          if (closing || disposed) break;
          const current = pendingUpdate;
          pendingUpdate = undefined;
          try {
            await applyConfiguration(current.configuration, current.viewportChanged);
            for (const waiter of current.waiters) waiter.resolve();
          } catch (error) {
            for (const waiter of current.waiters) waiter.reject(error);
            if (pendingUpdate === undefined) requestedConfiguration = configuration;
          }
        }
      })().finally(() => {
        updateDrain = undefined;
        if (pendingUpdate !== undefined && !closing && !disposed) {
          startUpdateDrain();
          return;
        }
        if (iconWindowSuspended) {
          iconWindowSuspended = false;
          if (iconWindowRefreshDeferred) {
            iconWindowRefreshDeferred = false;
            requestIconWindowRefresh();
          }
        }
      });
    }

    function enqueueUpdate(next: ComparisonWorkloadConfiguration, viewportChanged = false): Promise<void> {
      if (closing || disposed) {
        return Promise.reject(new DOMException('The comparison preview is disposed', 'AbortError'));
      }
      requestedConfiguration = next;
      if (
        comparisonWorkloadRequiresIconWindowSuspension(configuration, next) ||
        comparisonWorkloadUpdateKind(configuration, next, viewportChanged) === 'rebuild' ||
        next.fontFixture !== configuration.fontFixture
      ) {
        iconWindowSuspended = true;
        iconWindowRefreshDeferred = true;
      }
      return new Promise<void>((resolve, reject) => {
        if (pendingUpdate === undefined) {
          pendingUpdate = { configuration: next, viewportChanged, waiters: [{ resolve, reject }] };
        } else {
          pendingUpdate.configuration = next;
          pendingUpdate.viewportChanged ||= viewportChanged;
          pendingUpdate.waiters.push({ resolve, reject });
        }
        startUpdateDrain();
      });
    }
    const uploadFrameStarted = performance.now();
    if (!persistent) {
      canvasSurface.render(scene, camera);
      firstDrawMs = performance.now() - uploadFrameStarted;
      if (backend === 'webgpu' && gpuTimingSupported) {
        uploadFrameGpuMs = await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
        uploadFrameCompleteMs = performance.now() - uploadFrameStarted;
      }
    }
    const startupMs = performance.now() - startupStarted;
    const recordReflow = (duration: number): void => {
      reflowCount += 1;
      lastReflowMs = duration;
    };

    const renderFrame = (timestamp: number, renderScene = true): void => {
      if (closing || disposed) return;
      try {
        const cpuFrameStarted = performance.now();
        if (gpuFrameTimer !== undefined) {
          for (const measurement of gpuFrameTimer.poll()) {
            if (measurement.durationMs === undefined) telemetry?.discardGpu(measurement.frameId);
            else telemetry?.recordGpu(measurement.frameId, measurement.durationMs);
          }
        }
        const frameId = telemetry?.beginFrame(timestamp);
        if (renderScene && configuration.workload === 'icon-grid') {
          const elapsedMs = iconAutoPanTimestamp === undefined ? 0 : Math.max(0, timestamp - iconAutoPanTimestamp);
          iconAutoPanTimestamp = timestamp;
          const window = settledIconWindow;
          if (configuration.animationEnabled && window !== undefined) {
            // Keep the per-frame path to numeric motion, transforms, and visibility toggles. Content reassignment is
            // requested only after crossing a complete cell pitch and commits against the overscanned pool.
            advanceIconGridAutoPan(
              iconAutoPanState,
              -scene.position.x,
              scene.position.y,
              window.maximumScrollX,
              window.maximumScrollY,
              smoothIconGridFrameDelta(iconFrameDeltaState, elapsedMs),
              ICON_GRID_AUTO_PAN_PX_PER_SECOND * animationRate(configuration),
            );
            scene.position.set(-iconAutoPanState.scrollX, iconAutoPanState.scrollY, 0);
            updateIconGridEntryVisibility(
              entries,
              window.layout,
              iconAutoPanState.scrollX,
              iconAutoPanState.scrollY,
              width,
              height,
            );
            const pitchX = window.layout.cellWidth + window.layout.gap;
            const pitchY = window.layout.cellHeight + window.layout.gap;
            if (
              Math.abs(iconAutoPanState.scrollX - iconWindowRequestScrollX) >= pitchX ||
              Math.abs(iconAutoPanState.scrollY - iconWindowRequestScrollY) >= pitchY
            ) {
              requestIconWindowRefresh();
            }
          }
        } else if (renderScene) {
          iconAutoPanTimestamp = undefined;
          iconFrameDeltaState.smoothedElapsedMs = undefined;
        }
        if (
          renderScene &&
          !fontFixtureSwitching &&
          (configuration.workload === 'text-ladder' || configuration.workload === 'paragraph-stress')
        ) {
          animateEntries(
            entries,
            configuration,
            Math.max(0, timestamp - animationEpoch),
            width,
            height,
            scene,
            workloadAnimationScratch,
            onError,
            recordReflow,
          );
        }
        if (renderScene && !fontFixtureCommitting) {
          if (
            !fontFixtureSwitching &&
            configuration.workload !== 'text-ladder' &&
            configuration.workload !== 'paragraph-stress'
          ) {
            animateEntries(
              entries,
              configuration,
              Math.max(0, timestamp - animationEpoch),
              width,
              height,
              scene,
              workloadAnimationScratch,
              onError,
              recordReflow,
            );
          }
          const started = performance.now();
          if (frameId !== undefined && telemetry?.gpuTimingSupported === true) gpuFrameTimer?.beginFrame(frameId);
          try {
            canvasSurface.render(scene, camera);
          } finally {
            if (frameId !== undefined && telemetry?.gpuTimingSupported === true) gpuFrameTimer?.endFrame();
          }
          const submitMs = performance.now() - started;
          if (firstDrawMs === 0) firstDrawMs = submitMs;
        }
        const cpuFrameMs = performance.now() - cpuFrameStarted;
        const snapshot = frameId === undefined ? persistentSnapshot : telemetry?.endFrame(frameId, cpuFrameMs);
        if (snapshot === undefined) return;
        if (persistent) persistentSnapshot = undefined;
        const activeZoomEntry =
          configuration.workload === 'zoom-text' ? entries[zoomAnimationState.phraseIndex] : undefined;
        const zoomScale = activeZoomEntry?.node.scale.x ?? 1;
        measureVisibleEntries(entries, zoomScale, visibleEntryMetrics, visibleGeometryScratch);
        const effectiveCssFontSize =
          configuration.workload === 'zoom-text' ? ZOOM_TEXT_BASE_CSS_PX * zoomScale : configuration.fontSize;
        const framebufferGpuBytes = rendererViewport.drawingBufferWidth * rendererViewport.drawingBufferHeight * 4;
        const currentLoadedFonts = loadedFonts();
        measureLoadedFonts(currentLoadedFonts, loadedFontMetrics);
        const currentStatsFont = statsFont();
        let paintRevision = 0;
        let lastPaintUpdateMs = 0;
        for (const entry of entries) {
          paintRevision = Math.max(paintRevision, entry.paintRevision ?? 0);
          lastPaintUpdateMs = Math.max(lastPaintUpdateMs, entry.lastPaintUpdateMs ?? 0);
        }
        const cameraKind: ComparisonWorkloadStats['cameraKind'] =
          camera instanceof THREE.PerspectiveCamera ? 'perspective' : 'orthographic';
        const common = {
          backend,
          dpr: rendererViewport.pixelRatio,
          showGrid: configuration.showGrid,
          ...snapshot,
          glyphCount: visibleEntryMetrics.glyphCount,
          missingGlyphCount: visibleEntryMetrics.missingGlyphCount,
          drawCount: visibleEntryMetrics.drawCount,
          layoutWidth: visibleEntryMetrics.layoutWidth,
          layoutHeight: visibleEntryMetrics.layoutHeight,
          lineCount: visibleEntryMetrics.lineCount,
          atlasGpuBytes: loadedFontMetrics.atlasGpuBytes,
          framebufferGpuBytes,
          totalGpuBytes: loadedFontMetrics.atlasGpuBytes + framebufferGpuBytes,
          artifactBytes: loadedFontMetrics.artifactBytes,
          delivery: activeFont().metrics.delivery,
          sourceFontBytes: loadedFontMetrics.sourceFontBytes,
          coreArtifactBytes: loadedFontMetrics.coreArtifactBytes,
          coreBakeMs: loadedFontMetrics.coreBakeMs,
          rasterArtifactBytes: loadedFontMetrics.rasterArtifactBytes,
          rasterBakeMs: loadedFontMetrics.rasterBakeMs,
          rendererInitMs,
          fontLoadMs: loadedFontMetrics.fontLoadMs,
          textReadyMs,
          firstDrawMs,
          ...(uploadFrameGpuMs === undefined ? {} : { uploadFrameGpuMs }),
          ...(uploadFrameCompleteMs === undefined ? {} : { uploadFrameCompleteMs }),
          startupMs,
          gpuTimingSupported,
          textUpdateTimings: textUpdateTelemetry.summary(),
          configurationRevision: revision,
          appliedFontFixture: configuration.fontFixture,
          cameraKind,
          workload: configuration.workload,
          appliedAmount: configuration.amount,
          appliedAnimationEnabled: configuration.animationEnabled,
          appliedAnimationSpeed: configuration.animationSpeed,
          appliedFontSize: configuration.workload === 'zoom-text' ? ZOOM_TEXT_BASE_CSS_PX : configuration.fontSize,
          appliedLayoutWidthRatio: configuration.layoutWidthRatio,
          appliedPaintOpacity: configuration.paintOpacity,
          appliedPaintShadowEnabled: technique === 'mtsdf' && configuration.paintShadowEnabled,
          appliedPaintStrokeWidth: technique === 'mtsdf' ? configuration.paintStrokeWidth : 0,
          appliedShowLayoutBounds: configuration.showLayoutBounds,
          reflowCount,
          lastReflowMs,
          paintRevision,
          lastPaintUpdateMs,
          sourceTextLength: visibleEntryMetrics.sourceTextLength,
          zoomText: activeZoomEntry?.sourceText,
          zoomLanguage: activeZoomEntry?.zoomLanguage,
          zoomPhraseIndex: activeZoomEntry?.zoomPhraseIndex ?? -1,
          zoomPhraseRevision: configuration.workload === 'zoom-text' ? zoomAnimationState.phraseRevision : 0,
          zoomBaseCssPx: configuration.workload === 'zoom-text' ? ZOOM_TEXT_BASE_CSS_PX : 0,
          zoomEffectiveCssPx: configuration.workload === 'zoom-text' ? effectiveCssFontSize : 0,
          zoomMaximumCssPx:
            configuration.workload === 'zoom-text'
              ? ZOOM_TEXT_BASE_CSS_PX * (activeZoomEntry?.zoomMaximumScale ?? 1)
              : 0,
          zoomScale: configuration.workload === 'zoom-text' ? zoomScale : 0,
          zoomMaximumScale: configuration.workload === 'zoom-text' ? (activeZoomEntry?.zoomMaximumScale ?? 1) : 0,
          ...iconGridStats(
            configuration,
            width,
            height,
            -scene.position.x,
            scene.position.y,
            entries,
            iconRecycleCount,
            iconWindowRevision,
            iconAssignmentSignature,
            settledIconWindow,
          ),
        };
        if (technique === 'bitmap') {
          const strikePpem = selectBitmapStrikePpem(
            currentStatsFont.bitmapStrikes,
            configuration.workload === 'zoom-text' ? ZOOM_TEXT_BASE_CSS_PX : configuration.fontSize,
            rendererViewport.pixelRatio,
          );
          onStats({
            technique,
            ...common,
            strikePpem,
            cssFontSize: effectiveCssFontSize,
            renderedPpem: effectiveCssFontSize * rendererViewport.pixelRatio,
            scaleRatio: (effectiveCssFontSize * rendererViewport.pixelRatio) / strikePpem,
            atlasPages: bitmapAtlasPages(currentLoadedFonts),
          });
        } else if (technique === 'mtsdf') {
          const mtsdfConfiguration = currentStatsFont.mtsdfConfiguration;
          if (mtsdfConfiguration === undefined) {
            throw new Error('MTSDF workload is missing its registered raster configuration');
          }
          const renderedPpem = effectiveCssFontSize * rendererViewport.pixelRatio;
          onStats({
            technique,
            ...common,
            rasterEmSize: mtsdfConfiguration.emSize,
            rasterPixelRange: mtsdfConfiguration.pixelRange,
            renderedPpem,
            scaleRatio: renderedPpem / mtsdfConfiguration.emSize,
          });
        } else {
          const slugConfiguration = currentStatsFont.slugConfiguration;
          if (slugConfiguration === undefined) {
            throw new Error('Slug workload is missing its registered raster configuration');
          }
          const renderedPpem = effectiveCssFontSize * rendererViewport.pixelRatio;
          onStats({
            technique,
            ...common,
            renderedPpem,
            slugPageCount: loadedFontMetrics.slugPageCount,
            slugCurveTexelCount: loadedFontMetrics.slugCurveTexelCount,
            slugCurveGpuBytes: loadedFontMetrics.slugCurveGpuBytes,
            slugHeaderCount: loadedFontMetrics.slugHeaderCount,
            slugHeaderGpuBytes: loadedFontMetrics.slugHeaderGpuBytes,
            slugReferenceCount: loadedFontMetrics.slugReferenceCount,
            slugReferenceGpuBytes: loadedFontMetrics.slugReferenceGpuBytes,
            slugGpuBytes: loadedFontMetrics.slugGpuBytes,
          });
        }
      } catch (error) {
        onError(error);
      }
    };
    animationEpoch = performance.now();
    if (!persistent) await renderer.setAnimationLoop((timestamp) => renderFrame(timestamp));

    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return;
        const validatedWidth = positive(nextWidth, 'comparison workload width');
        const validatedHeight = positive(nextHeight, 'comparison workload height');
        if (validatedWidth === width && validatedHeight === height) return;
        width = validatedWidth;
        height = validatedHeight;
        if (!persistent) {
          renderer.setSize(width, height, false);
          rendererViewport = readRendererViewportState(renderer);
        }
        canvasSurface.resize(width, height);
        resizeWorkloadCamera(camera, width, height);
        void enqueueUpdate(requestedConfiguration, true).catch(onError);
      },
      panBy(deltaX, deltaY) {
        if (closing || disposed) return;
        const horizontal = finite(deltaX, 'workload horizontal pan');
        const vertical = finite(deltaY, 'workload vertical pan');
        if (configuration.workload === 'icon-grid') {
          const previousX = scene.position.x;
          const previousY = scene.position.y;
          scene.position.x += horizontal;
          scene.position.y -= vertical;
          clampIconGridScene(scene, configuration.fontSize, width, height);
          requestIconWindowRefresh();
          return {
            deltaX: scene.position.x - previousX,
            deltaY: previousY - scene.position.y,
          };
        }
        scene.position.x += horizontal;
        scene.position.y -= vertical;
      },
      resetView() {
        scene.position.set(0, 0, 0);
        iconAutoPanState.directionX = 1;
        iconAutoPanState.directionY = 1;
        iconAutoPanState.scrollX = 0;
        iconAutoPanState.scrollY = 0;
        iconFrameDeltaState.smoothedElapsedMs = undefined;
        camera.zoom = 1;
        camera.updateProjectionMatrix();
        requestIconWindowRefresh();
      },
      zoomBy(factor) {
        if (closing || disposed || configuration.workload !== 'off-axis-3d') return;
        camera.zoom = Math.min(4, Math.max(0.25, camera.zoom * finite(factor, 'camera zoom')));
        camera.updateProjectionMatrix();
      },
      update(next) {
        return enqueueUpdate(validateConfiguration(next));
      },
      persistentFrame(context) {
        if (!persistent) return;
        renderFrame(context.timestamp);
      },
      persistentTelemetry(snapshot, viewport) {
        if (!persistent) return;
        rendererViewport = {
          drawingBufferHeight: viewport.drawingBufferHeight,
          drawingBufferWidth: viewport.drawingBufferWidth,
          pixelRatio: viewport.dpr,
        };
        gpuTimingSupported ||= snapshot.gpuFrameMs !== undefined;
        persistentSnapshot = snapshot;
        renderFrame(performance.now(), false);
      },
      dispose() {
        if (disposal !== undefined) return disposal;
        closing = true;
        revision += 1;
        const stopRendering = persistent ? Promise.resolve() : renderer.setAnimationLoop(null);
        const disposalReason = new DOMException('The comparison preview is disposed', 'AbortError');
        for (const waiter of pendingUpdate?.waiters ?? []) waiter.reject(disposalReason);
        pendingUpdate = undefined;
        disposal = (async () => {
          await stopRendering;
          await updateDrain;
          disposed = true;
          await gpuFrameTimer?.dispose();
          if (!persistent) {
            renderer.setRenderTarget(null);
            renderer.clear();
          }
          disposeEntries(entries);
          entries = [];
          activeSelectedFont.dispose();
          iconFont?.font.dispose();
          canvasSurface.dispose();
          if (!persistent) await disposeConfiguredRenderer(renderer);
        })();
        return disposal;
      },
    };
  } catch (error) {
    await gpuFrameTimer?.dispose();
    disposeEntries(entries);
    iconFont?.font.dispose();
    if (selectedFontController === undefined) font?.font.dispose();
    else selectedFontController.dispose();
    canvasSurface.dispose();
    if (!persistent) await disposeConfiguredRenderer(renderer);
    throw error;
  }
}

function createEntries(
  font: RegisteredFont,
  raster: AnyRasterInput,
  technique: RasterTechnique,
  configuration: ComparisonWorkloadConfiguration,
  dpr: number,
  viewportWidth: number,
  viewportHeight: number,
  animationElapsedMs: number,
  textLadderSpecimen?: RasterConformanceSpecimen,
  iconFont?: LoadedTechniqueFont,
  iconScrollX = 0,
  iconScrollY = 0,
): readonly WorkloadEntry[] {
  return comparisonWorkloadDefinition(configuration.workload).create({
    animationElapsedMs,
    configuration,
    dpr,
    font,
    ...(iconFont === undefined ? {} : { iconFont }),
    iconScrollX,
    iconScrollY,
    raster,
    technique,
    ...(textLadderSpecimen === undefined ? {} : { textLadderSpecimen }),
    viewportHeight,
    viewportWidth,
  });
}

function entryReadyPromises(entry: WorkloadEntry): readonly Promise<void>[] {
  return entry.labelText === undefined ? [entry.text.ready] : [entry.text.ready, entry.labelText.ready];
}

function publishEntryUpdates(entries: readonly WorkloadEntry[]): void {
  for (const { node } of entries) node.updateMatrixWorld(true);
}

function layoutEntries(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  width: number,
  height: number,
): void {
  comparisonWorkloadDefinition(configuration.workload).layout(entries, {
    configuration,
    viewportHeight: height,
    viewportWidth: width,
  });
}

function animateEntries(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  elapsedMs: number,
  width: number,
  height: number,
  scene: THREE.Scene,
  scratch: ComparisonWorkloadAnimationScratch,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  comparisonWorkloadDefinition(configuration.workload).animate(
    entries,
    configuration,
    elapsedMs,
    width,
    height,
    scene,
    scratch,
    onError,
    onReflow,
  );
}

function applyRetainedConfiguration(
  entries: readonly WorkloadEntry[],
  technique: RasterTechnique,
  configuration: ComparisonWorkloadConfiguration,
): void {
  comparisonWorkloadDefinition(configuration.workload).applyRetainedConfiguration(entries, configuration, technique);
}

export function comparisonWorkloadUpdateKind(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
  _contentWidthChanged = false,
): 'rebuild' | 'retained' {
  return registryUpdateKind(previous, next);
}

export function comparisonWorkloadRequiresIconWindowSuspension(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
): boolean {
  return registryRequiresIconWindowSuspension(previous, next);
}

interface RetainedWidthText {
  setProperties(properties: { readonly fontSize?: number; readonly width?: number }): void;
  updateMatrixWorld(force?: boolean): void;
}

interface RetainedFontText {
  setProperties(properties: { readonly font: RegisteredFont; readonly raster: AnyRasterInput }): void;
  updateMatrixWorld(force?: boolean): void;
}

export function applyRetainedTextFontFixture(
  texts: readonly RetainedFontText[],
  previous: Pick<LoadedTechniqueFont, 'font' | 'raster'>,
  next: Pick<LoadedTechniqueFont, 'font' | 'raster'>,
): void {
  try {
    for (const text of texts) text.setProperties({ font: next.font, raster: next.raster });
    publishRetainedTexts(texts);
  } catch (error) {
    // A synchronous staging failure may leave earlier siblings queued. Restore the complete fixture before the
    // candidate owner is released so no Text can retain a generation backed by a disposed font.
    for (const text of texts) text.setProperties({ font: previous.font, raster: previous.raster });
    publishRetainedTexts(texts);
    throw new Error('comparison font fixture update failed and was rolled back', { cause: error });
  }
}

export function applyRetainedTextWidths(texts: readonly RetainedWidthText[], widths: ArrayLike<number>): void {
  applyRetainedTextLayout(texts, widths, undefined);
}

function applyRetainedTextLayout(
  texts: readonly RetainedWidthText[],
  widths: ArrayLike<number> | undefined,
  fontSize: number | undefined,
): void {
  if (widths === undefined && fontSize === undefined) return;
  if (widths !== undefined && texts.length !== widths.length) {
    throw new RangeError('retained text widths must match the text entry count');
  }
  for (const [index, text] of texts.entries()) {
    text.setProperties({
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(widths === undefined ? {} : { width: widths[index]! }),
    });
  }
  publishRetainedTexts(texts);
}

export function applyRetainedTextFontSize(texts: readonly RetainedWidthText[], fontSize: number): void {
  applyRetainedTextLayout(texts, undefined, fontSize);
}

function publishRetainedTexts(texts: readonly { updateMatrixWorld(force?: boolean): void }[]): void {
  for (const text of texts) text.updateMatrixWorld(true);
}

export function comparisonWorkloadContentWidth(
  configuration: Pick<ComparisonWorkloadConfiguration, 'layoutWidthRatio' | 'workload'>,
  viewportWidth: number,
): number | undefined {
  const policy = comparisonWorkloadDefinition(configuration.workload).contentWidth;
  if (policy === 'none') return undefined;
  return benchmarkContentWidth(
    viewportWidth,
    configuration.layoutWidthRatio,
    policy.maximumWidth,
    policy.multiplier ?? 1,
  );
}

function animationRate(configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed'>): number {
  return 0.25 + configuration.animationSpeed * 0.0175;
}

function updateIconGridEntryVisibility(
  entries: readonly WorkloadEntry[],
  layout: IconGridLayout,
  scrollX: number,
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const pitchX = layout.cellWidth + layout.gap;
  const pitchY = layout.cellHeight + layout.gap;
  const viewportRight = scrollX + viewportWidth;
  const viewportBottom = scrollY + viewportHeight;
  for (const entry of entries) {
    const index = entry.virtualIconIndex;
    if (index === undefined) {
      entry.node.visible = false;
      continue;
    }
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const left = layout.inset + column * pitchX;
    const top = layout.inset + row * pitchY;
    entry.node.visible =
      left + layout.cellWidth > scrollX &&
      left < viewportRight &&
      top + layout.cellHeight > scrollY &&
      top < viewportBottom;
  }
}

function clampIconGridScene(scene: THREE.Scene, iconSize: number, viewportWidth: number, viewportHeight: number): void {
  const layout = iconGridLayout(ICON_GRID_ITEMS.length, iconSize, viewportWidth);
  const maximumScrollX = Math.max(0, layout.width - viewportWidth);
  const maximumScrollY = Math.max(0, layout.height - viewportHeight);
  scene.position.x = Math.min(0, Math.max(-maximumScrollX, scene.position.x));
  scene.position.y = Math.min(maximumScrollY, Math.max(0, scene.position.y));
}

function iconGridStats(
  configuration: Pick<ComparisonWorkloadConfiguration, 'fontSize' | 'workload'>,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number,
  scrollY: number,
  entries: readonly WorkloadEntry[],
  recycleCount: number,
  windowRevision: number,
  assignmentSignature: string,
  settledWindow: IconGridVirtualWindow | undefined,
): Pick<
  ComparisonWorkloadStats,
  | 'iconItemCount'
  | 'iconLabelCount'
  | 'iconColumnCount'
  | 'iconRowCount'
  | 'iconGridWidth'
  | 'iconGridHeight'
  | 'iconLabelSize'
  | 'iconPoolCapacity'
  | 'iconAssignedCount'
  | 'iconRenderVisibleCount'
  | 'iconAssignmentSignature'
  | 'iconFirstVisibleIndex'
  | 'iconLastVisibleIndex'
  | 'iconRecycleCount'
  | 'iconWindowRevision'
  | 'iconOverscanRows'
  | 'iconOverscanColumns'
  | 'iconScrollX'
  | 'iconScrollY'
  | 'iconMaximumScrollX'
  | 'iconMaximumScrollY'
> {
  if (configuration.workload !== 'icon-grid') {
    return {
      iconItemCount: 0,
      iconLabelCount: 0,
      iconColumnCount: 0,
      iconRowCount: 0,
      iconGridWidth: 0,
      iconGridHeight: 0,
      iconLabelSize: 0,
      iconPoolCapacity: 0,
      iconAssignedCount: 0,
      iconRenderVisibleCount: 0,
      iconAssignmentSignature: '[]',
      iconFirstVisibleIndex: -1,
      iconLastVisibleIndex: -1,
      iconRecycleCount: 0,
      iconWindowRevision: 0,
      iconOverscanRows: 0,
      iconOverscanColumns: 0,
      iconScrollX: 0,
      iconScrollY: 0,
      iconMaximumScrollX: 0,
      iconMaximumScrollY: 0,
    };
  }
  const window =
    settledWindow ??
    iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewportWidth,
      viewportHeight,
      scrollX,
      scrollY,
    );
  let assignedCount = 0;
  let renderVisibleCount = 0;
  for (const entry of entries) {
    if (entry.virtualIconIndex !== undefined) assignedCount += 1;
    if (entry.node.visible) renderVisibleCount += 1;
  }
  return {
    iconItemCount: ICON_GRID_ITEMS.length,
    iconLabelCount: ICON_GRID_ITEMS.length,
    iconColumnCount: window.layout.columns,
    iconRowCount: window.layout.rows,
    iconGridWidth: window.layout.width,
    iconGridHeight: window.layout.height,
    iconLabelSize: ICON_GRID_LABEL_SIZE,
    iconPoolCapacity: entries.length,
    iconAssignedCount: assignedCount,
    iconRenderVisibleCount: renderVisibleCount,
    iconAssignmentSignature: assignmentSignature,
    iconFirstVisibleIndex: window.firstVisibleIndex,
    iconLastVisibleIndex: window.lastVisibleIndex,
    iconRecycleCount: recycleCount,
    iconWindowRevision: windowRevision,
    iconOverscanRows: ICON_GRID_OVERSCAN_ROWS,
    iconOverscanColumns: ICON_GRID_OVERSCAN_COLUMNS,
    iconScrollX: window.scrollX,
    iconScrollY: window.scrollY,
    iconMaximumScrollX: window.maximumScrollX,
    iconMaximumScrollY: window.maximumScrollY,
  };
}

function combineBitmapAtlasPages(fonts: readonly LoadedTechniqueFont[]): BitmapTextLiveStats['atlasPages'] {
  const pagesPerStrike = new Map<number, number>();
  return fonts.flatMap(({ atlasPages }) =>
    atlasPages.map((page) => {
      const pageOffset = pagesPerStrike.get(page.strikePpem) ?? 0;
      pagesPerStrike.set(page.strikePpem, pageOffset + 1);
      return { ...page, pageIndex: pageOffset };
    }),
  );
}

function measureLoadedFonts(fonts: readonly LoadedTechniqueFont[], metrics: MutableLoadedFontMetrics): void {
  metrics.artifactBytes = 0;
  metrics.atlasGpuBytes = 0;
  metrics.coreArtifactBytes = 0;
  metrics.coreBakeMs = 0;
  metrics.fontLoadMs = 0;
  metrics.rasterArtifactBytes = 0;
  metrics.rasterBakeMs = 0;
  metrics.slugCurveGpuBytes = 0;
  metrics.slugCurveTexelCount = 0;
  metrics.slugGpuBytes = 0;
  metrics.slugHeaderCount = 0;
  metrics.slugHeaderGpuBytes = 0;
  metrics.slugPageCount = 0;
  metrics.slugReferenceCount = 0;
  metrics.slugReferenceGpuBytes = 0;
  metrics.sourceFontBytes = 0;
  for (const font of fonts) {
    metrics.artifactBytes += font.artifactBytes;
    metrics.atlasGpuBytes += font.atlasGpuBytes;
    metrics.coreArtifactBytes += font.metrics.coreArtifactBytes;
    metrics.coreBakeMs += font.metrics.coreBakeMs;
    metrics.fontLoadMs += font.fontLoadMs;
    metrics.rasterArtifactBytes += font.metrics.rasterArtifactBytes;
    metrics.rasterBakeMs += font.metrics.rasterBakeMs;
    metrics.sourceFontBytes += font.metrics.sourceFontBytes;
    const slug = font.slugConfiguration;
    if (slug === undefined) continue;
    metrics.slugCurveGpuBytes += slug.curveGpuBytes;
    metrics.slugCurveTexelCount += slug.curveTexelCount;
    metrics.slugGpuBytes += slug.gpuBytes;
    metrics.slugHeaderCount += slug.headerCount;
    metrics.slugHeaderGpuBytes += slug.headerGpuBytes;
    metrics.slugPageCount += slug.pageCount;
    metrics.slugReferenceCount += slug.referenceCount;
    metrics.slugReferenceGpuBytes += slug.referenceGpuBytes;
  }
}

async function loadTechniqueFont(
  technique: RasterTechnique,
  fontFixture: BenchmarkFontFixture,
  delivery: FontDelivery,
  signal?: AbortSignal,
  onBakeProgress?: import('@pmndrs/text').BakeProgressListener,
  slugBakedArtifact?: import('./slug-text').SlugBakedArtifactSource,
  registry?: FontRegistry,
): Promise<LoadedTechniqueFont> {
  const startedAt = performance.now();
  if (technique === 'bitmap') {
    const loaded = await loadBitmapFont(signal, fontFixture, delivery, 'live', onBakeProgress, registry);
    const atlas = await registeredBitmapAtlas(loaded.font, 'live');
    return {
      artifactBytes: loaded.artifactBytes,
      atlasGpuBytes: atlas.gpuBytes,
      atlasPages: atlas.pages,
      bitmapStrikes: atlas.strikes,
      font: loaded.font,
      fontLoadMs: performance.now() - startedAt,
      metrics: loaded.metrics,
      raster: loaded.raster,
    };
  }
  if (technique === 'mtsdf') {
    const loaded = await loadMtsdfFont(signal, fontFixture, delivery, onBakeProgress, registry);
    const mtsdfConfiguration = await registeredMtsdfConfiguration(loaded.font, signal);
    return {
      artifactBytes: loaded.compressedBytes,
      atlasGpuBytes: loaded.atlasGpuBytes,
      atlasPages: [],
      bitmapStrikes: [],
      font: loaded.font,
      fontLoadMs: performance.now() - startedAt,
      metrics: loaded.metrics,
      mtsdfConfiguration,
      raster: loaded.raster,
    };
  }
  const { loadSlugBakedArtifact, loadSlugFont, registeredSlugConfiguration } = await import('./slug-text');
  const loaded =
    slugBakedArtifact === undefined
      ? await loadSlugFont(signal, fontFixture, delivery, onBakeProgress, registry)
      : await loadSlugBakedArtifact(slugBakedArtifact, signal, registry);
  const slugConfiguration = await registeredSlugConfiguration(loaded.font, signal);
  return {
    artifactBytes: loaded.compressedBytes,
    atlasGpuBytes: slugConfiguration.gpuBytes,
    atlasPages: [],
    bitmapStrikes: [],
    font: loaded.font,
    fontLoadMs: performance.now() - startedAt,
    metrics: loaded.metrics,
    slugConfiguration,
    raster: loaded.raster,
  };
}

function validateConfiguration(configuration: ComparisonWorkloadConfiguration): ComparisonWorkloadConfiguration {
  if (
    configuration.iconGridView !== undefined &&
    configuration.iconGridView !== 'origin' &&
    configuration.iconGridView !== 'alternate'
  ) {
    throw new RangeError('icon grid view must be origin or alternate');
  }
  positive(configuration.fontSize, 'comparison workload font size');
  const maximumLayoutWidthRatio = configuration.workload === 'off-axis-3d' ? 2 : 1;
  if (
    !Number.isFinite(configuration.layoutWidthRatio) ||
    configuration.layoutWidthRatio <= 0 ||
    configuration.layoutWidthRatio > maximumLayoutWidthRatio
  ) {
    throw new RangeError(`comparison workload layout width ratio must be in (0, ${String(maximumLayoutWidthRatio)}]`);
  }
  if (!Number.isFinite(configuration.amount) || configuration.amount < 0 || configuration.amount > 100) {
    throw new RangeError('comparison workload amount must be in [0, 100]');
  }
  if (
    !Number.isFinite(configuration.animationSpeed) ||
    configuration.animationSpeed < 0 ||
    configuration.animationSpeed > 100
  ) {
    throw new RangeError('comparison workload animation speed must be in [0, 100]');
  }
  if (
    !Number.isFinite(configuration.paintOpacity) ||
    configuration.paintOpacity < 0 ||
    configuration.paintOpacity > 1
  ) {
    throw new RangeError('comparison workload paint opacity must be in [0, 1]');
  }
  if (
    !Number.isFinite(configuration.paintStrokeWidth) ||
    configuration.paintStrokeWidth < 0 ||
    configuration.paintStrokeWidth > 1
  ) {
    throw new RangeError('comparison workload paint stroke width must be in [0, 1]');
  }
  if (typeof configuration.showLayoutBounds !== 'boolean') {
    throw new TypeError('comparison workload layout-bounds visibility must be boolean');
  }
  if (typeof configuration.showGrid !== 'boolean') {
    throw new TypeError('comparison workload canvas-grid visibility must be boolean');
  }
  if (typeof configuration.paintShadowEnabled !== 'boolean') {
    throw new TypeError('comparison workload shadow visibility must be boolean');
  }
  return configuration;
}

function disposeEntries(entries: readonly WorkloadEntry[]): void {
  for (const entry of entries) {
    entry.disposed = true;
    entry.text.dispose();
    entry.labelText?.dispose();
    entry.bounds?.geometry.dispose();
    entry.bounds?.material.dispose();
  }
}

function measureVisibleEntries(
  entries: readonly WorkloadEntry[],
  zoomScale: number,
  metrics: MutableVisibleEntryMetrics,
  geometries: Set<THREE.InstancedBufferGeometry>,
): void {
  metrics.drawCount = 0;
  metrics.glyphCount = 0;
  metrics.layoutHeight = 0;
  metrics.layoutWidth = 0;
  metrics.lineCount = 0;
  metrics.missingGlyphCount = 0;
  metrics.sourceTextLength = 0;
  for (const entry of entries) {
    if (!entry.node.visible) continue;
    geometries.clear();
    measureVisibleObject(entry.node, metrics, geometries);
    measureVisibleLayout(committedTextLayout(entry.text), zoomScale, metrics);
    if (entry.labelText !== undefined) measureVisibleLayout(committedTextLayout(entry.labelText), zoomScale, metrics);
    metrics.sourceTextLength += entry.sourceText.length;
  }
}

function measureVisibleObject(
  object: THREE.Object3D,
  metrics: MutableVisibleEntryMetrics,
  geometries: Set<THREE.InstancedBufferGeometry>,
): void {
  if (!object.visible) return;
  if (object instanceof THREE.Mesh) {
    metrics.drawCount += 1;
    if (object.geometry instanceof THREE.InstancedBufferGeometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      metrics.glyphCount += object.geometry.instanceCount;
    }
  }
  for (const child of object.children) measureVisibleObject(child, metrics, geometries);
}

function measureVisibleLayout(layout: ParagraphLayout, scale: number, metrics: MutableVisibleEntryMetrics): void {
  metrics.layoutWidth = Math.max(metrics.layoutWidth, layout.width * scale);
  metrics.layoutHeight += layout.height * scale;
  metrics.lineCount += layout.lineGlyphCounts.length;
  for (const glyphId of layout.glyphIds) if (glyphId === 0) metrics.missingGlyphCount += 1;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function createWorkloadCamera(
  workload: ComparisonWorkloadId,
  width: number,
  height: number,
): THREE.OrthographicCamera | THREE.PerspectiveCamera {
  if (comparisonWorkloadDefinition(workload).cameraKind === 'perspective') {
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 4_000);
    resizeWorkloadCamera(camera, width, height);
    return camera;
  }
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000);
  camera.position.z = 500;
  camera.updateProjectionMatrix();
  return camera;
}

function resizeWorkloadCamera(
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  width: number,
  height: number,
): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = width / height;
    camera.position.set(width / 2, -height / 2, height / (2 * Math.tan(THREE.MathUtils.degToRad(22.5))));
    camera.lookAt(width / 2, -height / 2, 0);
  } else {
    camera.right = width;
    camera.bottom = -height;
  }
  camera.updateProjectionMatrix();
}
