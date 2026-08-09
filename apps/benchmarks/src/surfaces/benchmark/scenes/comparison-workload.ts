import { FontRegistry, type AnyRasterTechnique, type ParagraphLayout, type RegisteredFont } from '@pmndrs/text';
import { TextGroup } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';
import { selectBitmapStrikePpem } from '@pmndrs/text/three/bitmap';

import type { BenchmarkFontFixture, RasterConformanceSpecimen } from '../../../benchmark/font-fixtures';
import type { RuntimeLiveStats } from '../../../benchmark/runtime-world';
import type { FontDelivery, RasterTechnique } from '../../../benchmark/url-state';
import { benchmarkWorkloadDefinition } from '../../../workloads/catalog';
import { workloadCompanionFontFixtures } from '../../../workloads/shared/definition';
import {
  comparisonWorkloadDefinition,
  comparisonWorkloadRequiresIconWindowSuspension as registryRequiresIconWindowSuspension,
  comparisonWorkloadUpdateKind as registryUpdateKind,
} from '../../../workloads/comparison/registry';
import { DYNAMIC_LAYOUT_TEXT, dynamicLayoutWidths } from '../../../workloads/dynamic-layout/scene';
import {
  ICON_GRID_ITEMS,
  ICON_GRID_LABEL_SIZE,
  ICON_GRID_OVERSCAN_COLUMNS,
  ICON_GRID_OVERSCAN_ROWS,
  createIconGridWorkloadInstance,
  createIconGridEntries,
  resizeIconGridEntries,
  type IconGridEntryPool,
  type IconGridWorkloadInstance,
} from '../../../workloads/icon-grid/scene';
import type { MutableTextLadderScenePosition } from '../../../workloads/text-ladder/scene';
import { ZOOM_TEXT_BASE_CSS_PX, type ZoomTextAnimationState } from '../../../workloads/zoom-text/scene';
import type {
  ComparisonWorkloadAnimationScratch,
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadId,
} from '../../../workloads/comparison/contracts';
import {
  committedTextLayout,
  exactWidth,
  publishWorkloadTexts,
  type ComparisonWorkloadEntry,
  type WorkloadFont,
  type WorkloadText,
} from '../../../workloads/shared/scene-entry';
import { registeredBitmapAtlas, type BitmapAtlasPageStats } from '../../../techniques/bitmap/metadata';
import { registeredMtsdfConfiguration, type MtsdfRasterConfiguration } from '../../../techniques/mtsdf/metadata';
import { slugDataConfiguration, type SlugRasterConfiguration } from '../../../techniques/slug/metadata';
import { createCanvasSurface } from '../../../renderer/canvas-surface';
import type { LiveFrameTelemetrySnapshot } from '../../../renderer/live-frame-telemetry';
import { createTextUpdateTelemetry } from '../../../renderer/text-update-telemetry';
import {
  loadBenchmarkFontAsset,
  type BakedSlugArtifactSource,
  type FontDeliveryMetrics,
} from '../../../workloads/font-assets';
import { benchmarkContentWidth } from '../../../workloads/shared/text-style';
import type { RendererBackend } from '../../../renderer/webgpu-renderer';
import type {
  PersistentRenderFrameContext,
  PersistentRenderScene,
  PersistentRenderSceneContext,
  PersistentRenderViewport,
} from '../../../renderer/persistent-render-host';
import { createPersistentSceneActivation } from '../../../renderer/persistent-scene-activation';
import {
  createRetainedFontFixtureController,
  type RetainedFontFixtureController,
} from '../../../renderer/retained-font-fixture';

type WorkloadEntry = ComparisonWorkloadEntry;

export type {
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadId,
  IconGridView,
} from '../../../workloads/comparison/contracts';
export type { MutableTextLadderScenePosition } from '../../../workloads/text-ladder/scene';
export {
  advanceIconGridAutoPan,
  iconGridAssignmentSignature,
  iconGridAutoPanStart,
  iconGridCenteredScroll,
  iconGridLayout,
  iconGridVirtualWindow,
  iconGridViewportUpdateKind,
  smoothIconGridFrameDelta,
} from '../../../workloads/icon-grid/scene';
export type { IconGridAutoPanState } from '../../../workloads/icon-grid/scene';
export { dynamicLayoutWidths } from '../../../workloads/dynamic-layout/scene';
export {
  ladderCssSizes,
  setTextLadderScenePosition,
  textLadderScenePosition,
} from '../../../workloads/text-ladder/scene';
export { OFF_AXIS_SPANS, OFF_AXIS_TEXT } from '../../../workloads/off-axis-3d/scene';
export { paintWordHue } from '../../../workloads/paint-effects/scene';
export {
  shuffleZoomTextPhrases,
  ZOOM_TEXT_BASE_CSS_PX,
  ZOOM_TEXT_CORPUS,
  ZOOM_TEXT_PHRASES,
  zoomTextAnimationState,
  zoomTextMaximumScale,
} from '../../../workloads/zoom-text/scene';

export type ComparisonWorkloadStats = RuntimeLiveStats & {
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

export interface ComparisonWorkloadPersistentSceneOptions {
  readonly amount: number;
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: RendererBackend;
  readonly fontSize: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly delivery: FontDelivery;
  readonly layoutWidthRatio: number;
  readonly paintOpacity: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokeWidth: number;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly textLadderExitEnabled: boolean;
  readonly slugBakedArtifact?: BakedSlugArtifactSource;
  readonly technique: RasterTechnique;
  readonly textLadderSpecimen?: RasterConformanceSpecimen;
  readonly workload: ComparisonWorkloadId;
  readonly onError: (error: unknown) => void;
  readonly onStats: (stats: ComparisonWorkloadStats) => void;
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener;
  readonly id?: string;
}

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
  readonly atlasPages: readonly BitmapAtlasPageStats[];
  readonly bitmapStrikes: readonly { readonly ppem: number }[];
  /** The registered font `loaded` owns; the technique metadata readers still key their reports off it. */
  readonly font: RegisteredFont;
  readonly fontLoadMs: number;
  /** The target-v1 handle every workload Text binds to. It carries the technique, its decoded raster, and the runtime. */
  readonly loaded: WorkloadFont;
  readonly metrics: FontDeliveryMetrics;
  readonly mtsdfConfiguration?: MtsdfRasterConfiguration;
  readonly slugConfiguration?: SlugRasterConfiguration;
}

interface PendingConfigurationUpdate {
  configuration: ComparisonWorkloadConfiguration;
  viewportChanged: boolean;
  readonly waiters: Array<{
    readonly resolve: () => void;
    readonly reject: (reason: unknown) => void;
  }>;
}

interface ComparisonWorkloadRuntime {
  dispose(): Promise<void>;
  frame(context: PersistentRenderFrameContext): void;
  panBy(deltaX: number, deltaY: number): { readonly deltaX: number; readonly deltaY: number } | void;
  resetView(): void;
  resize(width: number, height: number): void;
  telemetry(snapshot: LiveFrameTelemetrySnapshot, viewport: PersistentRenderViewport): void;
  update(configuration: ComparisonWorkloadConfiguration): Promise<void>;
  zoomBy(factor: number): void;
}

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
        runtime = await createComparisonWorkloadRuntime(options, context);
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

async function createComparisonWorkloadRuntime(
  options: ComparisonWorkloadPersistentSceneOptions,
  persistentContext: PersistentRenderSceneContext,
): Promise<ComparisonWorkloadRuntime> {
  const { backend, onError, onStats, technique } = options;
  const { signal } = persistentContext;
  const { height: viewportHeight, width: viewportWidth } = persistentContext.viewport;
  signal?.throwIfAborted();
  if (options.slugBakedArtifact !== undefined && technique !== 'slug') {
    throw new TypeError('a Slug candidate artifact requires the Slug technique');
  }
  if (options.slugBakedArtifact !== undefined && options.delivery !== 'baked') {
    throw new TypeError('a retained Slug candidate artifact requires baked delivery');
  }
  let width = positive(viewportWidth, 'comparison workload width');
  let height = positive(viewportHeight, 'comparison workload height');
  let configuration = validateConfiguration(options);
  const startupStarted = performance.now();
  const renderer = persistentContext.renderer as THREE.WebGPURenderer;
  let rendererViewport = {
    drawingBufferHeight: persistentContext.viewport.drawingBufferHeight,
    drawingBufferWidth: persistentContext.viewport.drawingBufferWidth,
    pixelRatio: persistentContext.viewport.dpr,
  };
  const canvasSurface = createCanvasSurface(renderer, width, height, configuration.showGrid);
  const rendererInitMs = persistentContext.rendererInitMs;
  let font: LoadedTechniqueFont | undefined;
  /**
   * Companion fixtures stay resident once loaded, keyed by fixture rather than held in one slot: the routes that need a
   * companion do not all need the same one, and a Text that a previous workload published still holds a font lease, so
   * releasing a companion at a workload switch would invalidate a font the outgoing scene has not finished with.
   */
  const companionFonts = new Map<BenchmarkFontFixture, LoadedTechniqueFont>();
  let selectedFontController: RetainedFontFixtureController<LoadedTechniqueFont> | undefined;
  let entries: readonly WorkloadEntry[] = [];
  // The workload's batch root. A shared `TextGroup` packs every Text of a multi-instance workload into one paragraph
  // batch; a plain Group leaves a single-paragraph workload on its own implicit batch of one.
  let batchRoot: THREE.Object3D = new THREE.Group();
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
  const scene = new THREE.Scene();
  let camera = createWorkloadCamera(configuration.workload, width, height);
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
    const companionFixtures = (workload: ComparisonWorkloadId): readonly BenchmarkFontFixture[] =>
      workloadCompanionFontFixtures(benchmarkWorkloadDefinition(workload).fontPolicy);
    const ensureCompanionFonts = async (workload: ComparisonWorkloadId): Promise<readonly LoadedTechniqueFont[]> => {
      const loaded: LoadedTechniqueFont[] = [];
      for (const fixture of companionFixtures(workload)) {
        const resident = companionFonts.get(fixture);
        if (resident !== undefined) {
          loaded.push(resident);
          continue;
        }
        const companion = await loadTechniqueFont(
          technique,
          fixture,
          options.delivery,
          signal,
          options.onBakeProgress,
          undefined,
          sharedRegistry,
        );
        companionFonts.set(fixture, companion);
        loaded.push(companion);
      }
      return loaded;
    };
    const residentCompanionFont = (workload: ComparisonWorkloadId): LoadedTechniqueFont | undefined => {
      const [fixture] = companionFixtures(workload);
      return fixture === undefined ? undefined : companionFonts.get(fixture);
    };
    await ensureCompanionFonts(configuration.workload);
    selectedFontController = createRetainedFontFixtureController(
      sharedRegistry,
      { fixture: configuration.fontFixture, asset: font },
      {
        // The selected fixture and a companion fixture can deduplicate to one loaded font. In that case the companion
        // owner releases the shared handle at teardown; a selection switch must not invalidate its Texts.
        dispose: (asset) => {
          if (![...companionFonts.values()].some((companion) => companion.loaded === asset.loaded)) {
            asset.loaded.dispose();
          }
        },
      },
    );
    const activeSelectedFont = selectedFontController;
    const activeFont = (): LoadedTechniqueFont => activeSelectedFont.current.asset;
    const loadedFontsScratch: LoadedTechniqueFont[] = [];
    /**
     * The selected fixture and a companion fixture can resolve to the same registered font, so residency is deduplicated
     * by the loaded handle rather than by the asset wrapper — counting one font twice would double its reported bytes.
     */
    const loadedFonts = (): readonly LoadedTechniqueFont[] => {
      loadedFontsScratch.length = 0;
      loadedFontsScratch.push(activeFont());
      for (const companion of companionFonts.values()) {
        if (!loadedFontsScratch.some(({ loaded }) => loaded === companion.loaded)) loadedFontsScratch.push(companion);
      }
      return loadedFontsScratch;
    };
    let cachedBitmapAtlasFonts: readonly LoadedTechniqueFont[] = [];
    let cachedBitmapAtlasPages: readonly BitmapAtlasPageStats[] = [];
    const bitmapAtlasPages = (fonts: readonly LoadedTechniqueFont[]): readonly BitmapAtlasPageStats[] => {
      // A composed workload keeps more than two fonts resident, so the cache key is the whole residency rather than
      // its first two members: a companion added behind the primary would otherwise return a stale page report.
      const unchanged =
        fonts.length === cachedBitmapAtlasFonts.length &&
        fonts.every((resident, index) => resident === cachedBitmapAtlasFonts[index]);
      if (!unchanged) {
        cachedBitmapAtlasFonts = [...fonts];
        cachedBitmapAtlasPages = combineBitmapAtlasPages(fonts);
      }
      return cachedBitmapAtlasPages;
    };
    // Icon Grid renders its cells from the companion fixture, so that fixture owns the reported density there. Every
    // other workload — including a composed one that only reaches its companion through a span — keeps the selected
    // font as its density source, so a retained companion never becomes the visible configuration after navigation.
    const statsFont = (): LoadedTechniqueFont =>
      configuration.workload === 'icon-grid' ? (residentCompanionFont('icon-grid') ?? activeFont()) : activeFont();
    let fontFixtureSwitching = false;
    let fontFixtureCommitting = false;
    let committedContentWidth = comparisonWorkloadContentWidth(configuration, width);
    const discardEntries = (discarded: readonly WorkloadEntry[]): void => {
      for (const { node } of discarded) batchRoot.remove(node);
      disposeEntries(discarded);
    };
    const iconGridEntryPool: IconGridEntryPool = {
      entries: () => entries,
      // Target-v1 has no per-Text readiness promise, so growing the pool is synchronous. The contract stays async
      // because the Icon Grid instance owns the await point that keeps a superseded resize from publishing.
      async resize(poolCapacity, iconSize, layout) {
        const icons = residentCompanionFont('icon-grid');
        if (icons === undefined) throw new Error('icon grid lost its icon font fixture');
        if (poolCapacity > entries.length) {
          const additions = createIconGridEntries({
            count: poolCapacity - entries.length,
            dpr: rendererViewport.pixelRatio,
            iconFont: icons.loaded,
            iconSize,
            labelFont: activeFont().loaded,
          });
          try {
            for (const { node } of additions) batchRoot.add(node);
            publishWorkloadTexts(batchRoot, additions);
          } catch (error) {
            discardEntries(additions);
            throw error;
          }
          if (closing || disposed) {
            discardEntries(additions);
            return;
          }
          entries = [...entries, ...additions];
        } else if (poolCapacity < entries.length) {
          const removed = entries.slice(poolCapacity);
          entries = entries.slice(0, poolCapacity);
          discardEntries(removed);
        }
        resizeIconGridEntries(entries, iconSize, layout, batchRoot);
      },
    };
    let iconGridInstance: IconGridWorkloadInstance | undefined;

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
        // Only the bytes are awaited. Once they are decoded the swap itself commits in this turn, so the scene never
        // renders a generation the caller has already replaced.
        await activeSelectedFont.load(nextFixture, (fixture, registry) =>
          loadTechniqueFont(
            technique,
            fixture,
            options.delivery,
            signal,
            options.onBakeProgress,
            options.slugBakedArtifact,
            registry,
          ),
        );
        if (closing || disposed) {
          throw new DOMException('The comparison workload font fixture switch was superseded', 'AbortError');
        }
        scheduledAt = performance.now();
        activeSelectedFont.commit(nextFixture, (nextFont) => {
          fontFixtureCommitting = true;
          try {
            applyRetainedTextFontFixture(batchRoot, entries, targetTexts, nextFont.loaded);
          } finally {
            fontFixtureCommitting = false;
          }
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
      const nextCompanionFonts = await ensureCompanionFonts(next.workload);
      const commitRevision = ++revision;
      const readyStarted = performance.now();
      const nextIconGridInstance =
        next.workload !== 'icon-grid'
          ? undefined
          : workloadChanged || iconGridInstance === undefined
            ? createIconGridWorkloadInstance(iconGridEntryPool, () => !closing && !disposed)
            : iconGridInstance;
      const iconGridInstanceChanged = nextIconGridInstance !== iconGridInstance;
      const initialIconWindow =
        next.workload === 'icon-grid' && nextIconGridInstance !== undefined
          ? nextIconGridInstance.activate(next, { height, width })
          : undefined;
      const nextEntries = createEntries(
        activeFont().loaded,
        technique,
        next,
        rendererViewport.pixelRatio,
        width,
        height,
        workloadChanged ? 0 : performance.now() - animationEpoch,
        options.textLadderSpecimen,
        nextCompanionFonts.map(({ loaded }) => loaded),
        initialIconWindow?.scrollX ?? (workloadChanged ? 0 : -scene.position.x),
        initialIconWindow?.scrollY ?? (workloadChanged ? 0 : scene.position.y),
      );
      const nextRoot = createBatchRoot(next.workload);
      const scheduledAt = performance.now();
      try {
        // The staged root is published off-scene: a TextGroup shapes, lays out, and packs its whole workload inside
        // one `updateMatrixWorld`, so the committed layouts are readable before anything reaches the live scene.
        for (const { node } of nextEntries) nextRoot.add(node);
        publishWorkloadTexts(nextRoot, nextEntries);
        const readyAt = performance.now();
        if (disposed || commitRevision !== revision) {
          disposeEntries(nextEntries);
          disposeBatchRoot(nextRoot);
          return;
        }
        const sceneStartedAt = performance.now();
        layoutEntries(nextEntries, next, width, height);
        const previous = entries;
        const previousRoot = batchRoot;
        entries = nextEntries;
        batchRoot = nextRoot;
        configuration = next;
        committedContentWidth = comparisonWorkloadContentWidth(next, width);
        if (workloadChanged) {
          // Scene transforms belong to the outgoing workload. Text Ladder exits by translating the shared scene,
          // while Icon Grid pans it; every newly mounted workload must start from its own explicit view defaults.
          scene.position.set(-(initialIconWindow?.scrollX ?? 0), initialIconWindow?.scrollY ?? 0, 0);
          camera = nextCamera;
          animationEpoch = performance.now();
          zoomAnimationState.phraseIndex = 0;
          zoomAnimationState.phraseRevision = 0;
          zoomAnimationState.progress = 0;
        }
        scene.clear();
        scene.add(nextRoot);
        disposeEntries(previous);
        disposeBatchRoot(previousRoot);
        if (iconGridInstanceChanged) {
          iconGridInstance?.dispose();
          iconGridInstance = next.workload === 'icon-grid' ? nextIconGridInstance : undefined;
        }
        const finishedAt = performance.now();
        textReadyMs = finishedAt - readyStarted;
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - readyStarted,
          readyMs: readyAt - scheduledAt,
          sceneMs: finishedAt - sceneStartedAt,
          totalMs: finishedAt - readyStarted,
        });
        if (next.workload === 'icon-grid') {
          iconGridInstance?.settle(next, { height, width }, scene);
        }
      } catch (error) {
        disposeEntries(nextEntries);
        disposeBatchRoot(nextRoot);
        if (iconGridInstanceChanged) nextIconGridInstance?.dispose();
        throw error;
      }
    }

    await commit(configuration);
    signal?.throwIfAborted();
    let requestedConfiguration = configuration;
    const pendingUpdates: PendingConfigurationUpdate[] = [];
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
        if (iconGridInstance === undefined) throw new Error('icon grid retained update lost its workload instance');
        await iconGridInstance.reconfigure(configuration, next, { height, width }, scene);
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
          for (const [index, entry] of entries.entries()) entry.lastWidth = retainedWidths[index]!;
        }
        const scheduledAt = performance.now();
        applyRetainedTextLayout(
          entries.map(({ text }) => text),
          retainedWidths,
          fontSizeChanged ? next.fontSize : undefined,
        );
        publishWorkloadTexts(batchRoot, entries);
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
        while (pendingUpdates.length > 0) {
          if (closing || disposed) break;
          const current = pendingUpdates.shift()!;
          try {
            await applyConfiguration(current.configuration, current.viewportChanged);
            for (const waiter of current.waiters) waiter.resolve();
          } catch (error) {
            for (const waiter of current.waiters) waiter.reject(error);
            if (pendingUpdates.length === 0) requestedConfiguration = configuration;
          }
        }
      })().finally(() => {
        updateDrain = undefined;
        if (pendingUpdates.length > 0 && !closing && !disposed) {
          startUpdateDrain();
          return;
        }
        iconGridInstance?.resume(configuration, { height, width }, scene, onError);
      });
    }

    function enqueueUpdate(next: ComparisonWorkloadConfiguration, viewportChanged = false): Promise<void> {
      if (closing || disposed) {
        return Promise.reject(new DOMException('The comparison workload scene is disposed', 'AbortError'));
      }
      requestedConfiguration = next;
      if (
        comparisonWorkloadRequiresIconWindowSuspension(configuration, next) ||
        comparisonWorkloadUpdateKind(configuration, next, viewportChanged) === 'rebuild' ||
        next.fontFixture !== configuration.fontFixture
      ) {
        iconGridInstance?.suspend();
      }
      // Queued, never merged. Collapsing a superseded configuration into its successor made a dragged control report
      // the cost of the two updates that survived rather than of the twenty it requested, which is a measurement of
      // the queue and not of the workload. Callers debounce their own input; whatever arrives here is applied.
      return new Promise<void>((resolve, reject) => {
        pendingUpdates.push({ configuration: next, viewportChanged, waiters: [{ resolve, reject }] });
        startUpdateDrain();
      });
    }
    const startupMs = performance.now() - startupStarted;
    const recordReflow = (duration: number): void => {
      reflowCount += 1;
      lastReflowMs = duration;
    };

    const renderFrame = (timestamp: number, renderScene = true): void => {
      if (closing || disposed) return;
      try {
        if (renderScene && configuration.workload === 'icon-grid') {
          iconGridInstance?.frame(
            configuration,
            { height, width },
            scene,
            timestamp,
            animationRate(configuration),
            onError,
          );
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
          canvasSurface.render(scene, camera);
          const submitMs = performance.now() - started;
          if (firstDrawMs === 0) {
            firstDrawMs = submitMs;
            uploadFrameCompleteMs = submitMs;
          }
        }
        const snapshot = persistentSnapshot;
        if (snapshot === undefined) return;
        persistentSnapshot = undefined;
        uploadFrameGpuMs ??= snapshot.gpuFrameMs;
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
          ...iconGridStats(configuration, iconGridInstance, { height, width }, scene),
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

    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return;
        const validatedWidth = positive(nextWidth, 'comparison workload width');
        const validatedHeight = positive(nextHeight, 'comparison workload height');
        if (validatedWidth === width && validatedHeight === height) return;
        width = validatedWidth;
        height = validatedHeight;
        canvasSurface.resize(width, height);
        resizeWorkloadCamera(camera, width, height);
        void enqueueUpdate(requestedConfiguration, true).catch(onError);
      },
      panBy(deltaX, deltaY) {
        if (closing || disposed) return;
        if (configuration.workload === 'icon-grid') {
          return iconGridInstance?.panBy(configuration, { height, width }, scene, deltaX, deltaY, onError);
        }
        const horizontal = finite(deltaX, 'workload horizontal pan');
        const vertical = finite(deltaY, 'workload vertical pan');
        scene.position.x += horizontal;
        scene.position.y -= vertical;
      },
      resetView() {
        if (configuration.workload === 'icon-grid') {
          iconGridInstance?.resetView(configuration, { height, width }, scene, onError);
        } else {
          scene.position.set(0, 0, 0);
        }
        camera.zoom = 1;
        camera.updateProjectionMatrix();
      },
      zoomBy(factor) {
        if (closing || disposed || configuration.workload !== 'off-axis-3d') return;
        camera.zoom = Math.min(4, Math.max(0.25, camera.zoom * finite(factor, 'camera zoom')));
        camera.updateProjectionMatrix();
      },
      update(next) {
        return enqueueUpdate(validateConfiguration(next));
      },
      frame(context) {
        renderFrame(context.timestamp);
      },
      telemetry(snapshot, viewport) {
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
        const disposalReason = new DOMException('The comparison workload scene is disposed', 'AbortError');
        for (const update of pendingUpdates) for (const waiter of update.waiters) waiter.reject(disposalReason);
        pendingUpdates.length = 0;
        disposal = (async () => {
          await updateDrain;
          disposed = true;
          iconGridInstance?.dispose();
          disposeEntries(entries);
          entries = [];
          disposeBatchRoot(batchRoot);
          batchRoot = new THREE.Group();
          // Every Text holds a font lease, so the loaded fonts can only be released after the entries are disposed.
          activeSelectedFont.dispose();
          for (const companion of companionFonts.values()) companion.loaded.dispose();
          companionFonts.clear();
          canvasSurface.dispose();
        })();
        return disposal;
      },
    };
  } catch (error) {
    disposeEntries(entries);
    disposeBatchRoot(batchRoot);
    for (const companion of companionFonts.values()) companion.loaded.dispose();
    companionFonts.clear();
    if (selectedFontController === undefined) font?.loaded.dispose();
    else selectedFontController.dispose();
    canvasSurface.dispose();
    throw error;
  }
}

/**
 * Multi-instance workloads mount under one shared `TextGroup`, so their Texts prepare and pack into a single paragraph
 * batch that owns one set of GPU resources. A single-paragraph workload gets a plain Group and keeps its own implicit
 * batch of one, which is what it already was.
 */
function createBatchRoot(workload: ComparisonWorkloadId): THREE.Object3D {
  if (comparisonWorkloadDefinition(workload).batching === 'standalone') return new THREE.Group();
  // `grow` keeps one buffer per physical resource. A chunked batch would split a paragraph's glyph run at every chunk
  // boundary and turn one draw into several, which would make the batched lanes look worse than the standalone one.
  return new TextGroup({
    capacity: { size: 4_096, policy: 'grow' },
  });
}

function disposeBatchRoot(root: THREE.Object3D): void {
  root.removeFromParent();
  root.clear();
  if (root instanceof TextGroup) root.dispose();
}

function createEntries(
  font: WorkloadFont,
  technique: RasterTechnique,
  configuration: ComparisonWorkloadConfiguration,
  dpr: number,
  viewportWidth: number,
  viewportHeight: number,
  animationElapsedMs: number,
  textLadderSpecimen?: RasterConformanceSpecimen,
  companionFonts: readonly WorkloadFont[] = [],
  iconScrollX = 0,
  iconScrollY = 0,
): readonly WorkloadEntry[] {
  return comparisonWorkloadDefinition(configuration.workload).create({
    animationElapsedMs,
    companionFonts,
    configuration,
    dpr,
    font,
    iconScrollX,
    iconScrollY,
    technique,
    ...(textLadderSpecimen === undefined ? {} : { textLadderSpecimen }),
    viewportHeight,
    viewportWidth,
  });
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

/**
 * Swaps the font fixture behind every retained Text and commits the whole set in one publication.
 *
 * The replacement `LoadedFont` is already resolved, so there is no readiness window to roll back: either the single
 * `updateMatrixWorld` commits every Text onto the new fixture or it throws with none of them published, and the caller
 * releases the candidate owner.
 */
export function applyRetainedTextFontFixture(
  root: THREE.Object3D,
  entries: readonly WorkloadEntry[],
  texts: readonly WorkloadText[],
  next: WorkloadFont,
): void {
  for (const text of texts) text.font = next;
  publishWorkloadTexts(root, entries);
}

export function applyRetainedTextWidths(texts: readonly WorkloadText[], widths: ArrayLike<number>): void {
  applyRetainedTextLayout(texts, widths, undefined);
}

/**
 * `set` replaces a property group wholesale, so a width or size change has to carry the rest of its group forward:
 * dropping `wrap` would unwrap a paragraph, and dropping `align` would collapse a centred lane onto its start edge.
 */
function applyRetainedTextLayout(
  texts: readonly WorkloadText[],
  widths: ArrayLike<number> | undefined,
  fontSize: number | undefined,
): void {
  if (widths === undefined && fontSize === undefined) return;
  if (widths !== undefined && texts.length !== widths.length) {
    throw new RangeError('retained text widths must match the text entry count');
  }
  for (const [index, text] of texts.entries()) {
    text.set({
      ...(fontSize === undefined ? {} : { style: { ...text.style, fontSize } }),
      ...(widths === undefined ? {} : { contentBox: { ...text.contentBox, width: exactWidth(widths[index]!) } }),
    });
  }
}

export function applyRetainedTextFontSize(texts: readonly WorkloadText[], fontSize: number): void {
  applyRetainedTextLayout(texts, undefined, fontSize);
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

function iconGridStats(
  configuration: Pick<ComparisonWorkloadConfiguration, 'workload'>,
  instance: IconGridWorkloadInstance | undefined,
  viewport: { readonly height: number; readonly width: number },
  scene: THREE.Scene,
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
  if (instance === undefined) throw new Error('icon grid telemetry lost its workload instance');
  const metrics = instance.metrics(viewport, scene);
  return {
    iconItemCount: ICON_GRID_ITEMS.length,
    iconLabelCount: ICON_GRID_ITEMS.length,
    iconColumnCount: metrics.columnCount,
    iconRowCount: metrics.rowCount,
    iconGridWidth: metrics.gridWidth,
    iconGridHeight: metrics.gridHeight,
    iconLabelSize: ICON_GRID_LABEL_SIZE,
    iconPoolCapacity: metrics.poolCapacity,
    iconAssignedCount: metrics.assignedCount,
    iconRenderVisibleCount: metrics.renderVisibleCount,
    iconAssignmentSignature: metrics.assignmentSignature,
    iconFirstVisibleIndex: metrics.firstVisibleIndex,
    iconLastVisibleIndex: metrics.lastVisibleIndex,
    iconRecycleCount: metrics.recycleCount,
    iconWindowRevision: metrics.windowRevision,
    iconOverscanRows: ICON_GRID_OVERSCAN_ROWS,
    iconOverscanColumns: ICON_GRID_OVERSCAN_COLUMNS,
    iconScrollX: metrics.scrollX,
    iconScrollY: metrics.scrollY,
    iconMaximumScrollX: metrics.maximumScrollX,
    iconMaximumScrollY: metrics.maximumScrollY,
  };
}

function combineBitmapAtlasPages(fonts: readonly LoadedTechniqueFont[]): readonly BitmapAtlasPageStats[] {
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
    metrics.slugCurveGpuBytes += slug.curveBytes;
    metrics.slugCurveTexelCount += slug.curveTexelCount;
    metrics.slugGpuBytes += slug.resourceBytes;
    metrics.slugHeaderCount += slug.headerCount;
    metrics.slugHeaderGpuBytes += slug.headerBytes;
    metrics.slugPageCount += slug.pageCount;
    metrics.slugReferenceCount += slug.referenceCount;
    metrics.slugReferenceGpuBytes += slug.referenceBytes;
  }
}

async function loadTechniqueFont(
  technique: RasterTechnique,
  fontFixture: BenchmarkFontFixture,
  delivery: FontDelivery,
  signal?: AbortSignal,
  onBakeProgress?: import('@pmndrs/text').BakeProgressListener,
  slugBakedArtifact?: BakedSlugArtifactSource,
  registry?: FontRegistry,
): Promise<LoadedTechniqueFont> {
  const startedAt = performance.now();
  if (technique === 'bitmap') {
    const loaded = await loadBenchmarkFontAsset({
      technique,
      fixture: fontFixture,
      delivery,
      bitmapDensity: 'live',
      ...(registry === undefined ? {} : { registry }),
      signal,
      onProgress: onBakeProgress,
    });
    const atlas = await registeredBitmapAtlas(loaded.loaded.font, 'live');
    return {
      artifactBytes: loaded.artifactBytes,
      atlasGpuBytes: atlas.gpuBytes,
      atlasPages: atlas.pages,
      bitmapStrikes: atlas.strikes,
      font: loaded.loaded.font,
      fontLoadMs: performance.now() - startedAt,
      loaded: loaded.loaded,
      metrics: loaded.metrics,
    };
  }
  if (technique === 'mtsdf') {
    const loaded = await loadBenchmarkFontAsset({
      technique,
      fixture: fontFixture,
      delivery,
      ...(registry === undefined ? {} : { registry }),
      signal,
      onProgress: onBakeProgress,
    });
    const mtsdfConfiguration = await registeredMtsdfConfiguration(loaded.loaded.font, signal);
    return {
      artifactBytes: loaded.compressedBytes,
      atlasGpuBytes: loaded.atlasGpuBytes,
      atlasPages: [],
      bitmapStrikes: [],
      font: loaded.loaded.font,
      fontLoadMs: performance.now() - startedAt,
      loaded: loaded.loaded,
      metrics: loaded.metrics,
      mtsdfConfiguration,
    };
  }
  const loaded = await loadBenchmarkFontAsset(
    delivery === 'runtime'
      ? {
          technique,
          fixture: fontFixture,
          delivery,
          ...(registry === undefined ? {} : { registry }),
          signal,
          onProgress: onBakeProgress,
        }
      : {
          technique,
          fixture: fontFixture,
          delivery,
          ...(slugBakedArtifact === undefined ? {} : { bakedArtifact: slugBakedArtifact }),
          ...(registry === undefined ? {} : { registry }),
          signal,
          onProgress: onBakeProgress,
        },
  );
  if (loaded.technique !== 'slug') throw new TypeError('Slug comparison workload loaded a different technique');
  const slugConfiguration = slugDataConfiguration(loaded.loaded.data);
  return {
    artifactBytes: loaded.compressedBytes,
    atlasGpuBytes: slugConfiguration.resourceBytes,
    atlasPages: [],
    bitmapStrikes: [],
    font: loaded.loaded.font,
    fontLoadMs: performance.now() - startedAt,
    loaded: loaded.loaded,
    metrics: loaded.metrics,
    slugConfiguration,
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
