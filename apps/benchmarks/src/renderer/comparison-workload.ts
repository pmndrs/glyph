import {
  FontRegistry,
  Text,
  type AnyRasterInput,
  type ParagraphLayout,
  type RegisteredFont,
  type TextSpan,
} from '@pmndrs/text';
import * as THREE from 'three/webgpu';
import { selectBitmapStrikePpem } from '@pmndrs/text/raster/bitmap';

import fontAwesomeIcons from '../../fixtures/fonts/font-awesome-free-6.7.2/icons.json';
import type { BenchmarkFontFixture, RasterConformanceSpecimen } from '../benchmark/font-fixtures';
import { benchmarkIpsumText, ICON_GRID_FONT_FIXTURE } from '../benchmark/font-fixtures';
import { paragraphStressScrollProgress } from '../benchmark/paragraph-stress-motion';
import type { FontDelivery, RasterTechnique } from '../benchmark/url-state';
import { loadBitmapFont, registeredBitmapAtlas, type BitmapTextLiveStats } from './bitmap-text';
import { createCanvasSurface } from './canvas-surface';
import { createGpuFrameTimer, type GpuFrameTimer } from './gpu-frame-timer';
import { createLiveFrameTelemetry, type LiveFrameTelemetrySnapshot } from './live-frame-telemetry';
import { createTextUpdateTelemetry } from './text-update-telemetry';
import type { FontDeliveryMetrics } from './font-delivery';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './live-text-style';
import { createOklabColorCycle } from './oklab-color-cycle';
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

export type ComparisonWorkloadId =
  | 'text-ladder'
  | 'zoom-text'
  | 'icon-grid'
  | 'off-axis-3d'
  | 'dynamic-layout'
  | 'paragraph-stress'
  | 'paint-effects';

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

export interface ComparisonWorkloadConfiguration {
  readonly amount: number;
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly fontSize: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly iconGridView?: IconGridView;
  readonly layoutWidthRatio: number;
  readonly paintOpacity: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokeWidth: number;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly textLadderExitEnabled: boolean;
  readonly workload: ComparisonWorkloadId;
}

export type IconGridView = 'alternate' | 'origin';

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

interface WorkloadEntry {
  readonly node: THREE.Object3D;
  sourceText: string;
  readonly text: Text;
  readonly labelText?: Text;
  readonly bounds?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>;
  readonly role: 'primary' | 'secondary';
  virtualIconIndex?: number;
  disposed?: boolean;
  readonly alignment?: 'start' | 'center' | 'end';
  readonly animationPhase?: number;
  lastPaintFrame?: number;
  paintPhase?: number;
  paintRevision?: number;
  lastPaintUpdateMs?: number;
  paintOutlineWidth?: number;
  paintShadowOffset?: readonly [number, number];
  readonly paintSpans?: MutablePaintSpan[];
  readonly paintUpdate?: { text: string; spans: readonly TextSpan[] };
  readonly offAxisSpans?: MutablePaintSpan[];
  readonly offAxisPaintUpdate?: { text: string; spans: readonly TextSpan[] };
  lastWidth?: number;
  readonly widthUpdate?: { width: number };
  zoomLanguage?: string;
  zoomOpacity?: number;
  readonly zoomOpacityUpdate?: { opacity: number };
  zoomMaximumScale?: number;
  zoomPhraseIndex?: number;
}

interface MutablePaintSpan {
  color: number;
  readonly end: number;
  outline?: { color: number; width: number };
  shadow?: { color: number; offset: readonly [number, number] };
  readonly start: number;
}

interface ZoomTextAnimationState {
  phraseIndex: number;
  phraseRevision: number;
  progress: number;
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

export interface MutableTextLadderScenePosition {
  x: number;
  y: number;
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

const LADDER_CSS_SIZES = [8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512, 1024] as const;
const LADDER_SENTENCE = 'The quick brown fox jumps over the lazy dog.';
const LADDER_GAP_CSS_PX = 10;
const LADDER_INSET_CSS_PX = 20;
export const ZOOM_TEXT_BASE_CSS_PX = 8 * (96 / 72);
const ZOOM_TEXT_INSET_CSS_PX = 24;
const ZOOM_TEXT_CYCLES_PER_MS = 1 / 3_500;
const OFF_AXIS_HORIZONTAL_BIAS_RATIO = 0.075;
export const OFF_AXIS_TEXT =
  'Render shaped text directly in your canvas, without the DOM. It reflows at runtime and uses the scene camera and depth. Bitmap, MSDF, Slug.';
const OFF_AXIS_WORD_COLORS = [
  { color: 0xa855f7, word: 'shaped' },
  { color: 0x22d3ee, word: 'canvas' },
  { color: 0x34d399, word: 'reflows' },
  { color: 0xf59e0b, word: 'Bitmap' },
  { color: 0xfb7185, word: 'MSDF' },
  { color: 0xff4dc4, word: 'Slug' },
] as const;
export const OFF_AXIS_SPANS: readonly MutablePaintSpan[] = OFF_AXIS_WORD_COLORS.map(({ color, word }) => {
  const start = OFF_AXIS_TEXT.indexOf(word);
  if (start === -1) throw new Error(`off-axis callout is missing its ${word} color span`);
  return { color, end: start + word.length, start };
});
const offAxisColorAt = createOklabColorCycle(OFF_AXIS_WORD_COLORS.map(({ color }) => color));
export const ZOOM_TEXT_CORPUS = [
  { language: 'en', text: 'Shape' },
  { language: 'fr', text: 'Forme' },
  { language: 'es', text: 'Figura' },
  { language: 'de', text: 'Form' },
  { language: 'pt', text: 'Formato' },
  { language: 'pl', text: 'Kształt' },
  { language: 'tr', text: 'Şekil' },
  { language: 'el', text: 'Σχήμα' },
  { language: 'ru', text: 'Форма' },
  { language: 'uk', text: 'Обрис' },
  { language: 'vi', text: 'Hình dạng' },
  { language: 'is', text: 'Lögun' },
  { language: 'ro', text: 'Formă' },
  { language: 'cy', text: 'Siâp' },
  { language: 'sr', text: 'Облик' },
  { language: 'kk', text: 'Пішін' },
] as const;

export type ZoomTextPhrase = (typeof ZOOM_TEXT_CORPUS)[number];

export function shuffleZoomTextPhrases(
  phrases: readonly ZoomTextPhrase[],
  random: () => number = Math.random,
): readonly ZoomTextPhrase[] {
  const shuffled = [...phrases];
  if (shuffled.length < 3) return shuffled;
  for (let index = shuffled.length - 1; index > 1; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('zoom text shuffle source must return a value in [0, 1)');
    }
    const swapIndex = 1 + Math.floor(sample * index);
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex] as ZoomTextPhrase;
    shuffled[swapIndex] = current as ZoomTextPhrase;
  }
  if (shuffled.every((phrase, index) => phrase === phrases[index])) {
    [shuffled[1], shuffled[2]] = [shuffled[2] as ZoomTextPhrase, shuffled[1] as ZoomTextPhrase];
  }
  return shuffled;
}

export const ZOOM_TEXT_PHRASES = shuffleZoomTextPhrases(ZOOM_TEXT_CORPUS);
const ICON_GRID_LABEL_SIZE = 11;
const ICON_GRID_LABEL_WIDTH = 112;
const ICON_GRID_INSET = 24;
const ICON_GRID_GAP = 18;
const ICON_GRID_MIN_CELL_WIDTH = 112;
const ICON_GRID_ICON_PADDING = 16;
const ICON_GRID_LABEL_GAP = 8;
const ICON_GRID_OVERSCAN_ROWS = 3;
const ICON_GRID_OVERSCAN_COLUMNS = 3;
const ICON_GRID_AUTO_PAN_PX_PER_SECOND = 160;
const ICON_GRID_FRAME_DELTA_RESPONSE = 0.2;
const ICON_GRID_MAX_FRAME_DELTA_MULTIPLIER = 2;
// Authenticated fa-solid-900.ttf metrics: 512 units/em and a 640-unit maximum advance.
const ICON_GRID_FONT_UNITS_PER_EM = 512;
const ICON_GRID_MAX_ADVANCE = 640;
const ICON_GRID_MAX_ADVANCE_EM = ICON_GRID_MAX_ADVANCE / ICON_GRID_FONT_UNITS_PER_EM;
const ICON_GRID_ITEMS = fontAwesomeIcons.icons;
const ICON_GRID_CONTENT = ICON_GRID_ITEMS.map((icon) => {
  const glyph = String.fromCodePoint(icon.codePoint);
  return { content: `${glyph}\n${icon.name}`, glyph, label: icon.name };
});
const PAINT_EFFECTS_TEXT =
  'Color begins as light, then the human eye turns wavelength into sensation. Our cones negotiate red, green, and blue while the brain invents every violet, amber, and electric cyan between them. Here each word carries its own chromatic phase, flowing through a continuous spectrum while opacity and contour remain live.';
const PAINT_WORD_RANGES = Array.from(PAINT_EFFECTS_TEXT.matchAll(/\S+/g), (match) => ({
  start: match.index,
  end: match.index + match[0].length,
}));
const DYNAMIC_LAYOUT_TEXT = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Left-aligned lines narrow and open while every word reshapes into its changing measure.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. This centered paragraph breathes independently while preserving its typographic rhythm.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Right-aligned lines reflow on their own cadence and remain anchored to the far edge.',
] as const;

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
        const additions = createIconGridEntries(
          activeFont().font,
          activeFont().raster,
          iconFont,
          rendererViewport.pixelRatio,
          iconSize,
          poolCapacity - entries.length,
        );
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
        layoutZoomTextEntries(entries, width, height);
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
          configuration.workload === 'text-ladder' &&
          configuration.animationEnabled
        ) {
          animateTextLadderScene(
            scene,
            entries,
            configuration,
            Math.max(0, timestamp - animationEpoch),
            width,
            height,
            textLadderPositionScratch,
          );
        }
        if (
          renderScene &&
          !fontFixtureSwitching &&
          configuration.workload === 'paragraph-stress' &&
          configuration.animationEnabled
        ) {
          animateParagraphStressScene(scene, entries, configuration, Math.max(0, timestamp - animationEpoch), height);
        }
        if (renderScene && !fontFixtureCommitting) {
          if (!fontFixtureSwitching) {
            animateEntries(
              entries,
              configuration,
              Math.max(0, timestamp - animationEpoch),
              zoomAnimationState,
              dynamicWidthsScratch,
              width,
              height,
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
  const base = {
    font,
    raster,
    rasterPixelRatio: dpr,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
  };
  if (configuration.workload === 'text-ladder') {
    const specimen = textLadderSpecimen ?? {
      text: LADDER_SENTENCE,
      language: 'en',
      direction: 'ltr',
    };
    return ladderCssSizes(viewportHeight).map((cssSize) => {
      const content = textLadderSpecimen === undefined ? `${cssSize} px  ${specimen.text}` : specimen.text;
      const text = new Text({
        ...base,
        text: content,
        fontSize: cssSize,
        language: specimen.language,
        direction: specimen.direction,
        color: LIVE_TEXT_COLOR,
      });
      return textEntry('primary', text, content);
    });
  }
  if (configuration.workload === 'zoom-text') {
    return ZOOM_TEXT_PHRASES.map((phrase, zoomPhraseIndex) => {
      const opacity = zoomPhraseIndex === 0 ? 1 : 0;
      const text = new Text({
        ...base,
        text: phrase.text,
        fontSize: ZOOM_TEXT_BASE_CSS_PX,
        language: phrase.language,
        direction: 'ltr',
        color: LIVE_TEXT_COLOR,
        opacity,
      });
      const node = new THREE.Group();
      node.add(text);
      node.visible = zoomPhraseIndex === 0;
      const entry: WorkloadEntry = {
        ...textEntry('primary', text, phrase.text),
        node,
        zoomOpacity: opacity,
        zoomOpacityUpdate: { opacity },
        zoomLanguage: phrase.language,
        zoomMaximumScale: 1,
        zoomPhraseIndex,
      };
      return entry;
    });
  }
  if (configuration.workload === 'icon-grid') {
    if (iconFont === undefined) throw new Error('icon grid requires its icon font fixture');
    const window = iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewportWidth,
      viewportHeight,
      iconScrollX,
      iconScrollY,
    );
    return createIconGridEntries(
      font,
      raster,
      iconFont,
      dpr,
      configuration.fontSize,
      window.poolCapacity,
      window.indices,
    );
  }
  if (configuration.workload === 'paint-effects') {
    const maximumOutlineWidth = configuration.fontSize / 16;
    const paintOutlineWidth = technique === 'mtsdf' ? maximumOutlineWidth * configuration.paintStrokeWidth : undefined;
    const paintShadowOffset =
      technique === 'mtsdf' && configuration.paintShadowEnabled
        ? ([Math.max(3, configuration.fontSize / 10), Math.max(3, configuration.fontSize / 10)] as const)
        : undefined;
    const spans = createPaintSpans(0, configuration.amount, paintOutlineWidth, paintShadowOffset);
    const paintUpdate = { text: PAINT_EFFECTS_TEXT, spans };
    const text = new Text({
      ...base,
      text: PAINT_EFFECTS_TEXT,
      spans,
      fontSize: configuration.fontSize,
      opacity: configuration.paintOpacity,
      width: benchmarkContentWidth(viewportWidth, configuration.layoutWidthRatio),
      wrap: 'word',
    });
    return [
      {
        ...textEntry('primary', text, PAINT_EFFECTS_TEXT),
        paintSpans: spans,
        paintUpdate,
        ...(paintOutlineWidth === undefined ? {} : { paintOutlineWidth }),
        ...(paintShadowOffset === undefined ? {} : { paintShadowOffset }),
      },
    ];
  }
  if (configuration.workload === 'dynamic-layout') {
    const initialWidths = dynamicLayoutWidths(configuration, viewportWidth, animationElapsedMs);
    return DYNAMIC_LAYOUT_TEXT.map((content, index) => {
      const alignment = (['start', 'center', 'end'] as const)[index]!;
      const animationPhase = index * ((Math.PI * 2) / 3);
      const initialWidth = initialWidths[index]!;
      const text = new Text({
        ...base,
        text: content,
        fontSize: configuration.fontSize,
        color: LIVE_TEXT_COLOR,
        width: initialWidth,
        wrap: 'word',
        textAlign: alignment,
      });
      const bounds = createLayoutBounds();
      bounds.visible = configuration.showLayoutBounds;
      const node = new THREE.Group();
      node.add(bounds, text);
      return {
        ...textEntry(index === 0 ? 'primary' : 'secondary', text, content),
        node,
        bounds,
        alignment,
        animationPhase,
        lastWidth: initialWidth,
        widthUpdate: { width: initialWidth },
      };
    });
  }
  const text =
    configuration.workload === 'paragraph-stress'
      ? Array.from({ length: Math.max(2, Math.round(configuration.amount / 10)) }, () => benchmarkIpsumText()).join(
          '\n',
        )
      : configuration.workload === 'off-axis-3d'
        ? OFF_AXIS_TEXT
        : benchmarkIpsumText();
  const contentWidth = comparisonWorkloadContentWidth(configuration, viewportWidth);
  if (contentWidth === undefined) throw new Error(`${configuration.workload} requires a content width`);
  const offAxisSpans =
    configuration.workload === 'off-axis-3d' ? OFF_AXIS_SPANS.map((span) => ({ ...span })) : undefined;
  const textObject = new Text({
    ...base,
    text,
    ...(offAxisSpans === undefined ? {} : { spans: offAxisSpans }),
    fontSize: configuration.fontSize,
    color: LIVE_TEXT_COLOR,
    width: contentWidth,
    wrap: 'word',
    ...(configuration.workload === 'off-axis-3d' ? { textAlign: 'center' as const } : {}),
  });
  if (configuration.workload === 'off-axis-3d') {
    const pivot = new THREE.Group();
    pivot.add(textObject);
    if (offAxisSpans === undefined) throw new Error('off-axis text requires retained color spans');
    return [
      {
        node: pivot,
        role: 'primary',
        sourceText: text,
        text: textObject,
        offAxisSpans,
        offAxisPaintUpdate: { text, spans: offAxisSpans },
      },
    ];
  }
  return [textEntry('primary', textObject, text)];
}

function textEntry(role: WorkloadEntry['role'], text: Text, sourceText: string): WorkloadEntry {
  return { node: text, role, sourceText, text };
}

function createIconGridEntries(
  labelFont: RegisteredFont,
  labelRaster: AnyRasterInput,
  iconFont: LoadedTechniqueFont,
  dpr: number,
  iconSize: number,
  count: number,
  indices: readonly number[] = [],
): readonly WorkloadEntry[] {
  return Array.from({ length: count }, (_, poolIndex) => {
    const assignedIndex = indices[poolIndex];
    const iconIndex = assignedIndex ?? 0;
    const { content, glyph } = iconGridContent(iconIndex);
    const text = new Text({
      font: iconFont.font,
      raster: iconFont.raster,
      rasterPixelRatio: dpr,
      text: glyph,
      fontSize: iconSize,
      color: LIVE_TEXT_COLOR,
    });
    const labelText = new Text({
      font: labelFont,
      raster: labelRaster,
      rasterPixelRatio: dpr,
      text: iconGridLabel(iconIndex),
      fontSize: ICON_GRID_LABEL_SIZE,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      color: LIVE_TEXT_COLOR,
      width: ICON_GRID_LABEL_WIDTH,
      maxLines: 2,
      overflow: 'ellipsis',
      wrap: 'none',
      textAlign: 'center',
    });
    const node = new THREE.Group();
    node.add(text, labelText);
    const entry: WorkloadEntry = {
      node,
      role: 'primary',
      sourceText: content,
      text,
      labelText,
    };
    if (assignedIndex === undefined) node.visible = false;
    else entry.virtualIconIndex = assignedIndex;
    return entry;
  });
}

function entryReadyPromises(entry: WorkloadEntry): readonly Promise<void>[] {
  return entry.labelText === undefined ? [entry.text.ready] : [entry.text.ready, entry.labelText.ready];
}

function resizeIconGridEntries(entries: readonly WorkloadEntry[], iconSize: number, layout: IconGridLayout): void {
  for (const entry of entries) entry.text.setProperties({ fontSize: iconSize });
  publishEntryUpdates(entries);
  for (const entry of entries) {
    if (entry.virtualIconIndex === undefined) continue;
    const column = entry.virtualIconIndex % layout.columns;
    const row = Math.floor(entry.virtualIconIndex / layout.columns);
    positionIconGridEntry(entry, layout, column, row, iconSize);
  }
}

function publishEntryUpdates(entries: readonly WorkloadEntry[]): void {
  for (const { node } of entries) node.updateMatrixWorld(true);
}

function positionIconGridEntry(
  entry: WorkloadEntry,
  layout: IconGridLayout,
  column: number,
  row: number,
  iconSize: number,
): void {
  const iconLayout = committedLayout(entry.text);
  entry.node.position.set(
    layout.inset + column * (layout.cellWidth + layout.gap),
    -(layout.inset + row * (layout.cellHeight + layout.gap)),
    0,
  );
  entry.text.position.set((layout.cellWidth - iconLayout.width) / 2, 0, 0);
  entry.labelText?.position.set(
    (layout.cellWidth - ICON_GRID_LABEL_WIDTH) / 2,
    -(iconSize * LIVE_TEXT_LINE_HEIGHT + ICON_GRID_LABEL_GAP),
    0,
  );
  freezeLocalMatrices(entry.node);
}

function freezeLocalMatrices(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
}

function layoutEntries(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  width: number,
  height: number,
): void {
  if (configuration.workload === 'text-ladder') {
    const layouts = entries.map(({ text }) => committedLayout(text));
    const widestLine = layouts.reduce((maximum, layout) => Math.max(maximum, layout.width), 0);
    const centeredColumnWidth = Math.min(widestLine, width * 0.94);
    const x = Math.max(LADDER_INSET_CSS_PX, (width - centeredColumnWidth) / 2);
    let y = LADDER_INSET_CSS_PX + 18;
    for (const [index, { text }] of entries.entries()) {
      const layout = layouts[index]!;
      text.position.set(x, -y, 0);
      y += layout.height + LADDER_GAP_CSS_PX;
    }
    return;
  }
  if (configuration.workload === 'zoom-text') {
    layoutZoomTextEntries(entries, width, height);
    return;
  }
  if (configuration.workload === 'icon-grid') {
    const grid = iconGridLayout(ICON_GRID_ITEMS.length, configuration.fontSize, width);
    for (const entry of entries) {
      if (entry.virtualIconIndex === undefined) continue;
      const column = entry.virtualIconIndex % grid.columns;
      const row = Math.floor(entry.virtualIconIndex / grid.columns);
      positionIconGridEntry(entry, grid, column, row, configuration.fontSize);
    }
    return;
  }
  if (configuration.workload === 'paint-effects') {
    const entry = entries[0];
    if (entry === undefined) return;
    const layout = committedLayout(entry.text);
    entry.text.position.set(Math.max(12, (width - layout.width) / 2), -Math.max(18, (height - layout.height) / 2), 0);
    return;
  }
  if (configuration.workload === 'dynamic-layout') {
    layoutDynamicEntries(entries, width, height);
    return;
  }
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedLayout(entry.text);
  entry.text.position.set(Math.max(12, (width - layout.width) / 2), -Math.max(12, (height - layout.height) / 2), 0);
  if (configuration.workload === 'off-axis-3d') {
    entry.text.position.set(-layout.width / 2, layout.height / 2, 0);
    entry.node.position.set(width * (0.5 + OFF_AXIS_HORIZONTAL_BIAS_RATIO), -height / 2, 0);
  }
}

function layoutZoomTextEntries(entries: readonly WorkloadEntry[], viewportWidth: number, viewportHeight: number): void {
  for (const entry of entries) layoutZoomTextEntry(entry, viewportWidth, viewportHeight);
}

function layoutZoomTextEntry(entry: WorkloadEntry, viewportWidth: number, viewportHeight: number): void {
  const layout = committedLayout(entry.text);
  entry.text.position.set(-layout.width / 2, layout.height / 2, 0);
  entry.node.position.set(viewportWidth / 2, -viewportHeight / 2, 0);
  entry.node.scale.setScalar(1);
  entry.zoomMaximumScale = zoomTextMaximumScale(layout.width, layout.height, viewportWidth, viewportHeight);
}

function animateTextLadderScene(
  scene: THREE.Scene,
  entries: readonly WorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed' | 'textLadderExitEnabled'>,
  elapsedMs: number,
  viewportWidth: number,
  viewportHeight: number,
  positionScratch: MutableTextLadderScenePosition,
): void {
  const finalEntry = entries[entries.length - 1];
  if (finalEntry === undefined) return;
  const layout = committedLayout(finalEntry.text);
  setTextLadderScenePosition(positionScratch, {
    animationSpeed: configuration.animationSpeed,
    elapsedMs,
    exitEnabled: configuration.textLadderExitEnabled,
    finalCenterY: finalEntry.text.position.y - layout.height / 2,
    finalEntryX: finalEntry.text.position.x,
    finalEntryWidth: layout.width,
    viewportHeight,
    viewportWidth,
  });
  scene.position.set(positionScratch.x, positionScratch.y, 0);
}

export function textLadderScenePosition({
  animationSpeed,
  elapsedMs,
  exitEnabled,
  finalCenterY,
  finalEntryWidth,
  finalEntryX,
  viewportHeight,
  viewportWidth,
}: {
  readonly animationSpeed: number;
  readonly elapsedMs: number;
  readonly exitEnabled: boolean;
  readonly finalCenterY: number;
  readonly finalEntryWidth: number;
  readonly finalEntryX: number;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}): Readonly<{ x: number; y: number }> {
  const position: MutableTextLadderScenePosition = { x: 0, y: 0 };
  setTextLadderScenePosition(position, {
    animationSpeed,
    elapsedMs,
    exitEnabled,
    finalCenterY,
    finalEntryWidth,
    finalEntryX,
    viewportHeight,
    viewportWidth,
  });
  return position;
}

/** Updates caller-owned scene-position storage for the text-ladder render loop. */
export function setTextLadderScenePosition(
  position: MutableTextLadderScenePosition,
  {
    animationSpeed,
    elapsedMs,
    exitEnabled,
    finalCenterY,
    finalEntryWidth,
    finalEntryX,
    viewportHeight,
    viewportWidth,
  }: {
    readonly animationSpeed: number;
    readonly elapsedMs: number;
    readonly exitEnabled: boolean;
    readonly finalCenterY: number;
    readonly finalEntryWidth: number;
    readonly finalEntryX: number;
    readonly viewportHeight: number;
    readonly viewportWidth: number;
  },
): void {
  const cycle = modulo((elapsedMs / 9_000) * animationRate({ animationSpeed }), 1);
  const scrollProgress = smoothstep(Math.min(1, cycle / 0.52));
  const marqueeProgress = exitEnabled ? smoothstep(Math.max(0, Math.min(1, (cycle - 0.52) / 0.38))) : 0;
  const centeredScrollY = -viewportHeight / 2 - finalCenterY;
  const offscreenLeftX = -finalEntryX - finalEntryWidth - viewportWidth * 0.05;
  position.x = marqueeProgress === 0 ? 0 : offscreenLeftX * marqueeProgress;
  position.y = centeredScrollY * scrollProgress;
}

function animateParagraphStressScene(
  scene: THREE.Scene,
  entries: readonly WorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed'>,
  elapsedMs: number,
  viewportHeight: number,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedLayout(entry.text);
  const scrollProgress = paragraphStressScrollProgress(elapsedMs, configuration.animationSpeed);
  const maximumScrollY = Math.max(0, layout.height - viewportHeight + 24);
  scene.position.y = maximumScrollY * scrollProgress;
}

export function zoomTextMaximumScale(
  layoutWidth: number,
  layoutHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  positive(layoutWidth, 'zoom text layout width');
  positive(layoutHeight, 'zoom text layout height');
  positive(viewportWidth, 'zoom text viewport width');
  positive(viewportHeight, 'zoom text viewport height');
  const availableWidth = Math.max(1, viewportWidth - ZOOM_TEXT_INSET_CSS_PX * 2);
  const availableHeight = Math.max(1, viewportHeight - ZOOM_TEXT_INSET_CSS_PX * 2);
  return Math.max(1, Math.min(availableWidth / layoutWidth, availableHeight / layoutHeight));
}

export function zoomTextAnimationState(
  elapsedMs: number,
  animationSpeed: number,
  phraseCount: number = ZOOM_TEXT_PHRASES.length,
): Readonly<ZoomTextAnimationState> {
  const state: ZoomTextAnimationState = { phraseIndex: 0, phraseRevision: 0, progress: 0 };
  updateZoomTextAnimationState(state, elapsedMs, animationSpeed, phraseCount);
  return state;
}

function updateZoomTextAnimationState(
  state: ZoomTextAnimationState,
  elapsedMs: number,
  animationSpeed: number,
  phraseCount: number,
): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('zoom text elapsed time must be nonnegative');
  if (!Number.isSafeInteger(phraseCount) || phraseCount <= 0) {
    throw new RangeError('zoom text phrase count must be a positive safe integer');
  }
  if (!Number.isFinite(animationSpeed) || animationSpeed < 0 || animationSpeed > 100) {
    throw new RangeError('zoom text animation speed must be in [0, 100]');
  }
  const cycle = elapsedMs * ZOOM_TEXT_CYCLES_PER_MS * animationRate({ animationSpeed });
  const phraseRevision = Math.floor(cycle);
  const phase = cycle - phraseRevision;
  state.phraseIndex = phraseRevision % phraseCount;
  state.phraseRevision = phraseRevision;
  state.progress = phase;
}

function iconGridContent(iconIndex: number): {
  readonly content: string;
  readonly glyph: string;
} {
  const content = ICON_GRID_CONTENT[iconIndex];
  if (content === undefined) throw new RangeError(`Unknown Font Awesome icon index: ${iconIndex}`);
  return content;
}

function iconGridLabel(iconIndex: number): string {
  const content = ICON_GRID_CONTENT[iconIndex];
  if (content === undefined) throw new RangeError(`Unknown Font Awesome icon index: ${iconIndex}`);
  return content.label;
}

function animateEntries(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
  zoomAnimationState: ZoomTextAnimationState,
  dynamicWidthsScratch: Float64Array,
  width: number,
  height: number,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  if (configuration.workload === 'zoom-text') {
    animateZoomText(entries, configuration, timestamp, zoomAnimationState);
    return;
  }
  if (configuration.workload === 'paint-effects') {
    animatePaint(entries, configuration, timestamp);
    return;
  }
  if (configuration.workload === 'dynamic-layout') {
    animateDynamicLayout(entries, configuration, timestamp, width, height, dynamicWidthsScratch, onError, onReflow);
    return;
  }
  if (configuration.workload !== 'off-axis-3d') return;
  const entry = entries[0];
  if (entry === undefined) return;
  const motionTimestamp = configuration.animationEnabled ? timestamp : 0;
  const strength = 0.7 + (configuration.amount / 100) * 0.3;
  const phase = motionTimestamp * 0.00055 * animationRate(configuration);
  entry.node.rotation.set(
    (-0.08 + Math.sin(phase * 0.83) * 0.18) * strength,
    (0.62 + Math.sin(phase + Math.PI / 2) * 0.2) * strength,
    Math.sin(phase * 0.47) * 0.06 * strength,
  );
  entry.node.position.z = -(320 + Math.sin(phase * 0.61) * 60) * strength;
  if (!configuration.animationEnabled) return;
  if (entry.offAxisSpans === undefined || entry.offAxisPaintUpdate === undefined) {
    throw new Error('off-axis text is missing its retained color spans');
  }
  const colorPhase = (timestamp / 32_000) * animationRate(configuration);
  for (let index = 0; index < entry.offAxisSpans.length; index += 1) {
    entry.offAxisSpans[index]!.color = offAxisColorAt(index, colorPhase);
  }
  entry.text.setProperties(entry.offAxisPaintUpdate);
}

function animateZoomText(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
  state: ZoomTextAnimationState,
): void {
  if (!configuration.animationEnabled) return;
  if (entries.length !== ZOOM_TEXT_PHRASES.length) {
    throw new Error(
      `zoom text requires one retained Text per phrase; received ${String(entries.length)} for ${String(ZOOM_TEXT_PHRASES.length)} phrases`,
    );
  }
  updateZoomTextAnimationState(state, timestamp, configuration.animationSpeed, ZOOM_TEXT_PHRASES.length);
  const current = entries[state.phraseIndex]!;
  const incoming = entries[(state.phraseIndex + 1) % entries.length]!;
  const previous = entries[(state.phraseIndex + entries.length - 1) % entries.length]!;
  const fadeProgress = smoothstep(Math.max(0, Math.min(1, (state.progress - 0.82) / 0.18)));
  const zoomProgress = state.progress ** 3;
  previous.node.visible = false;
  current.node.visible = true;
  incoming.node.visible = fadeProgress > 0;
  current.node.scale.setScalar(1 + ((current.zoomMaximumScale ?? 1) - 1) * zoomProgress);
  incoming.node.scale.setScalar(1);
  setZoomTextOpacity(current, 1 - fadeProgress);
  setZoomTextOpacity(incoming, fadeProgress);
}

function setZoomTextOpacity(entry: WorkloadEntry, opacity: number): void {
  if (entry.zoomOpacityUpdate === undefined || Math.abs((entry.zoomOpacity ?? -1) - opacity) < 0.002) return;
  entry.zoomOpacity = opacity;
  entry.zoomOpacityUpdate.opacity = opacity;
  entry.text.setProperties(entry.zoomOpacityUpdate);
}

function animatePaint(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
): void {
  const entry = entries[0];
  if (entry === undefined || !configuration.animationEnabled) return;
  const paintFrame = Math.floor(timestamp / 16);
  if (entry.lastPaintFrame === paintFrame) return;
  entry.lastPaintFrame = paintFrame;
  const started = performance.now();
  // Identical text and shaping-span ranges keep Text on its synchronous paint-only batch path.
  const phase = timestamp * 0.0002 * animationRate(configuration);
  entry.paintPhase = phase;
  if (entry.paintSpans === undefined || entry.paintUpdate === undefined) {
    throw new Error('paint effects entry is missing its retained span buffer');
  }
  updatePaintSpans(entry.paintSpans, phase, configuration.amount, entry.paintOutlineWidth, entry.paintShadowOffset);
  entry.text.setProperties(entry.paintUpdate);
  entry.paintRevision = (entry.paintRevision ?? 0) + 1;
  entry.lastPaintUpdateMs = performance.now() - started;
}

function applyRetainedConfiguration(
  entries: readonly WorkloadEntry[],
  technique: RasterTechnique,
  configuration: ComparisonWorkloadConfiguration,
): void {
  for (const entry of entries) {
    if (entry.bounds !== undefined) entry.bounds.visible = configuration.showLayoutBounds;
  }
  if (configuration.workload !== 'paint-effects') return;
  const maximumOutlineWidth = configuration.fontSize / 16;
  const paintOutlineWidth = technique === 'mtsdf' ? maximumOutlineWidth * configuration.paintStrokeWidth : undefined;
  const paintShadowOffset =
    technique === 'mtsdf' && configuration.paintShadowEnabled
      ? ([Math.max(3, configuration.fontSize / 10), Math.max(3, configuration.fontSize / 10)] as const)
      : undefined;
  for (const entry of entries) {
    if (paintOutlineWidth === undefined) delete entry.paintOutlineWidth;
    else entry.paintOutlineWidth = paintOutlineWidth;
    if (paintShadowOffset === undefined) delete entry.paintShadowOffset;
    else entry.paintShadowOffset = paintShadowOffset;
    if (entry.paintSpans === undefined) throw new Error('paint effects entry is missing its retained span buffer');
    updatePaintSpans(
      entry.paintSpans,
      entry.paintPhase ?? 0,
      configuration.amount,
      paintOutlineWidth,
      paintShadowOffset,
    );
    entry.text.setProperties({
      opacity: configuration.paintOpacity,
      text: PAINT_EFFECTS_TEXT,
      spans: entry.paintSpans,
    });
  }
}

export function comparisonWorkloadUpdateKind(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
  _contentWidthChanged = false,
): 'rebuild' | 'retained' {
  if (previous.workload !== next.workload) return 'rebuild';
  const paragraphVolumeChanged = next.workload === 'paragraph-stress' && previous.amount !== next.amount;
  return paragraphVolumeChanged ? 'rebuild' : 'retained';
}

export function comparisonWorkloadRequiresIconWindowSuspension(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
): boolean {
  return previous.workload === 'icon-grid' || next.workload === 'icon-grid';
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
  if (
    configuration.workload === 'text-ladder' ||
    configuration.workload === 'zoom-text' ||
    configuration.workload === 'icon-grid'
  ) {
    return undefined;
  }
  return benchmarkContentWidth(
    viewportWidth,
    configuration.layoutWidthRatio,
    configuration.workload === 'dynamic-layout' ? 1_000 : undefined,
    configuration.workload === 'off-axis-3d' ? 2 : 1,
  );
}

function animateDynamicLayout(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
  viewportWidth: number,
  viewportHeight: number,
  widthsScratch: Float64Array,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  if (!configuration.animationEnabled) return;
  const nextWidths = dynamicLayoutWidths(configuration, viewportWidth, timestamp, widthsScratch);
  if (
    entries.length === nextWidths.length &&
    entries.every((entry, index) => entry.lastWidth !== undefined && Math.abs(nextWidths[index]! - entry.lastWidth) < 1)
  ) {
    return;
  }
  const reflowStarted = performance.now();
  try {
    for (const [index, entry] of entries.entries()) {
      entry.lastWidth = nextWidths[index]!;
      if (entry.widthUpdate === undefined) throw new Error('dynamic layout entry is missing its retained width update');
      entry.widthUpdate.width = nextWidths[index]!;
      entry.text.setProperties(entry.widthUpdate);
    }
    publishEntryUpdates(entries);
    layoutDynamicEntries(entries, viewportWidth, viewportHeight);
    onReflow(performance.now() - reflowStarted);
  } catch (error) {
    onError(error);
  }
}

export function dynamicLayoutWidths(
  configuration: Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationSpeed' | 'layoutWidthRatio'>,
  viewportWidth: number,
  animationElapsedMs: number,
  target: Float64Array = new Float64Array(DYNAMIC_LAYOUT_TEXT.length),
): Float64Array {
  const phase = animationElapsedMs * 0.00045 * animationRate(configuration);
  const amplitude = 0.08 + (configuration.amount / 100) * 0.28;
  const baseWidth = benchmarkContentWidth(viewportWidth, configuration.layoutWidthRatio, 1_000);
  if (target.length !== DYNAMIC_LAYOUT_TEXT.length) {
    throw new RangeError(`dynamic layout width target must contain ${String(DYNAMIC_LAYOUT_TEXT.length)} values`);
  }
  for (let index = 0; index < DYNAMIC_LAYOUT_TEXT.length; index += 1) {
    target[index] = Math.max(160, baseWidth * (0.72 + Math.sin(phase + index * ((Math.PI * 2) / 3)) * amplitude));
  }
  return target;
}

function layoutDynamicEntries(entries: readonly WorkloadEntry[], viewportWidth: number, viewportHeight: number): void {
  const inset = 20;
  const laneHeight = viewportHeight / Math.max(1, entries.length);
  for (const [index, entry] of entries.entries()) {
    const layout = committedLayout(entry.text);
    const x =
      entry.alignment === 'end'
        ? viewportWidth - inset - layout.width
        : entry.alignment === 'center'
          ? (viewportWidth - layout.width) / 2
          : inset;
    const y = index * laneHeight + Math.max(inset, (laneHeight - layout.height) / 2);
    entry.text.position.set(x, -y, 0);
    if (entry.bounds !== undefined) updateLayoutBounds(entry.bounds, x, y, layout.width, layout.height);
  }
}

function createLayoutBounds(): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  const material = new THREE.LineBasicNodeMaterial({
    color: 0xb6bac3,
    depthTest: false,
    depthWrite: false,
    opacity: 0.55,
    transparent: true,
  });
  return new THREE.LineSegments(geometry, material);
}

function updateLayoutBounds(
  bounds: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const positions = bounds.geometry.getAttribute('position');
  const right = x + width;
  const bottom = -(y + height);
  const top = -y;
  const vertices = [
    x,
    top,
    0,
    right,
    top,
    0,
    right,
    top,
    0,
    right,
    bottom,
    0,
    right,
    bottom,
    0,
    x,
    bottom,
    0,
    x,
    bottom,
    0,
    x,
    top,
    0,
  ];
  if (!(positions.array instanceof Float32Array)) {
    throw new TypeError('dynamic layout bounds require a Float32 position buffer');
  }
  positions.array.set(vertices);
  positions.needsUpdate = true;
  bounds.geometry.computeBoundingSphere();
}

function createPaintSpans(
  phase: number,
  amount: number,
  outlineWidth?: number,
  shadowOffset?: readonly [number, number],
): MutablePaintSpan[] {
  const spans = PAINT_WORD_RANGES.map((range) => ({ ...range, color: 0 }));
  updatePaintSpans(spans, phase, amount, outlineWidth, shadowOffset);
  return spans;
}

function updatePaintSpans(
  spans: MutablePaintSpan[],
  phase: number,
  amount: number,
  outlineWidth?: number,
  shadowOffset?: readonly [number, number],
): void {
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    const hue = paintWordHue(index, PAINT_WORD_RANGES.length, phase, amount);
    span.color = hslColor(hue, 0.88, 0.53);
    if (outlineWidth === undefined || outlineWidth === 0) {
      delete span.outline;
    } else if (span.outline === undefined) {
      span.outline = { color: 0xffffff, width: outlineWidth };
    } else {
      span.outline.width = outlineWidth;
    }
    if (shadowOffset === undefined) {
      delete span.shadow;
    } else if (span.shadow === undefined) {
      span.shadow = { color: hslColor(hue, 0.68, 0.28), offset: shadowOffset };
    } else {
      span.shadow.color = hslColor(hue, 0.68, 0.28);
      span.shadow.offset = shadowOffset;
    }
  }
}

export function paintWordHue(wordIndex: number, wordCount: number, phase: number, amount: number): number {
  if (!Number.isSafeInteger(wordIndex) || wordIndex < 0 || wordIndex >= wordCount) {
    throw new RangeError('paint word index must address the word sequence');
  }
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    throw new RangeError('paint word count must be a positive safe integer');
  }
  const cycles = 0.5 + (amount / 100) * 1.5;
  const hue = phase + (wordIndex / wordCount) * cycles;
  return ((hue % 1) + 1) % 1;
}

function hslColor(hue: number, saturation: number, lightness: number): number {
  const channel = (offset: number): number => {
    const value = (offset + hue * 12) % 12;
    return (
      lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(value - 3, 9 - value, 1))
    );
  };
  return (Math.round(channel(0) * 255) << 16) | (Math.round(channel(8) * 255) << 8) | Math.round(channel(4) * 255);
}

function animationRate(configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed'>): number {
  return 0.25 + configuration.animationSpeed * 0.0175;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function ladderCssSizes(viewportHeight: number): readonly number[] {
  positive(viewportHeight, 'text ladder viewport height');
  return LADDER_CSS_SIZES;
}

export interface IconGridLayout {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly inset: number;
  readonly width: number;
  readonly height: number;
}

export interface IconGridAutoPanState {
  directionX: -1 | 1;
  directionY: -1 | 1;
  scrollX: number;
  scrollY: number;
}

export interface IconGridFrameDeltaState {
  smoothedElapsedMs: number | undefined;
}

export function iconGridAutoPanStart(
  view: IconGridView,
  maximumScrollX: number,
  maximumScrollY: number,
): IconGridAutoPanState {
  if (!Number.isFinite(maximumScrollX) || !Number.isFinite(maximumScrollY)) {
    throw new TypeError('icon grid auto-pan bounds must be finite');
  }
  if (maximumScrollX < 0 || maximumScrollY < 0) {
    throw new RangeError('icon grid auto-pan bounds must be non-negative');
  }
  if (view === 'origin') return { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };
  if (view === 'alternate') {
    return {
      directionX: -1,
      directionY: -1,
      scrollX: maximumScrollX * 0.72,
      scrollY: maximumScrollY * 0.58,
    };
  }
  throw new RangeError(`unknown icon grid view: ${String(view)}`);
}

export function smoothIconGridFrameDelta(state: IconGridFrameDeltaState, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('icon grid frame delta must be finite and nonnegative');
  }
  if (elapsedMs === 0) return 0;
  const previous = state.smoothedElapsedMs;
  if (previous === undefined) {
    state.smoothedElapsedMs = elapsedMs;
    return elapsedMs;
  }
  const boundedElapsedMs = Math.min(elapsedMs, previous * ICON_GRID_MAX_FRAME_DELTA_MULTIPLIER);
  const smoothedElapsedMs = previous + (boundedElapsedMs - previous) * ICON_GRID_FRAME_DELTA_RESPONSE;
  state.smoothedElapsedMs = smoothedElapsedMs;
  return smoothedElapsedMs;
}

export function advanceIconGridAutoPan(
  state: IconGridAutoPanState,
  scrollX: number,
  scrollY: number,
  maximumScrollX: number,
  maximumScrollY: number,
  elapsedMs: number,
  speedPxPerSecond: number,
): void {
  if (![scrollX, scrollY, maximumScrollX, maximumScrollY, elapsedMs, speedPxPerSecond].every(Number.isFinite)) {
    throw new TypeError('icon grid auto-pan inputs must be finite');
  }
  if (maximumScrollX < 0 || maximumScrollY < 0) {
    throw new RangeError('icon grid auto-pan bounds must be non-negative');
  }
  if (elapsedMs < 0 || speedPxPerSecond < 0) {
    throw new RangeError('icon grid auto-pan elapsed time and speed must be non-negative');
  }
  if ((state.directionX !== -1 && state.directionX !== 1) || (state.directionY !== -1 && state.directionY !== 1)) {
    throw new RangeError('icon grid auto-pan directions must be -1 or 1');
  }
  state.scrollX = Math.min(maximumScrollX, Math.max(0, scrollX));
  state.scrollY = Math.min(maximumScrollY, Math.max(0, scrollY));
  const distance = (elapsedMs / 1_000) * speedPxPerSecond;
  advanceIconGridAutoPanAxis(state, 'x', distance, maximumScrollX);
  advanceIconGridAutoPanAxis(state, 'y', distance, maximumScrollY);
}

function advanceIconGridAutoPanAxis(
  state: IconGridAutoPanState,
  axis: 'x' | 'y',
  distance: number,
  maximum: number,
): void {
  if (maximum === 0) {
    if (axis === 'x') {
      state.scrollX = 0;
      state.directionX = 1;
    } else {
      state.scrollY = 0;
      state.directionY = 1;
    }
    return;
  }
  const position = axis === 'x' ? state.scrollX : state.scrollY;
  const direction = axis === 'x' ? state.directionX : state.directionY;
  const cycle = maximum * 2;
  const startingPhase = direction === 1 ? position : cycle - position;
  const phase = (startingPhase + distance) % cycle;
  const nextPosition = phase <= maximum ? phase : cycle - phase;
  const nextDirection = phase < maximum || phase === 0 ? 1 : -1;
  if (axis === 'x') {
    state.scrollX = nextPosition;
    state.directionX = nextDirection;
  } else {
    state.scrollY = nextPosition;
    state.directionY = nextDirection;
  }
}

export interface IconGridVirtualWindow {
  readonly layout: IconGridLayout;
  readonly indices: readonly number[];
  readonly visibleIndices: readonly number[];
  readonly poolCapacity: number;
  readonly firstVisibleIndex: number;
  readonly lastVisibleIndex: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly maximumScrollX: number;
  readonly maximumScrollY: number;
}

export interface IconGridAssignment {
  readonly index: number;
  readonly content: string;
}

export function iconGridCenteredScroll(
  itemCount: number,
  previousIconSize: number,
  nextIconSize: number,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number,
  scrollY: number,
): readonly [number, number] {
  positive(viewportHeight, 'icon grid viewport height');
  if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY)) {
    throw new TypeError('icon grid scroll positions must be finite');
  }
  const previous = iconGridLayout(itemCount, previousIconSize, viewportWidth);
  const next = iconGridLayout(itemCount, nextIconSize, viewportWidth);
  const previousPitchX = previous.cellWidth + previous.gap;
  const previousPitchY = previous.cellHeight + previous.gap;
  const nextPitchX = next.cellWidth + next.gap;
  const nextPitchY = next.cellHeight + next.gap;
  const anchorColumn = (scrollX + viewportWidth / 2 - previous.inset) / previousPitchX;
  const anchorRow = (scrollY + viewportHeight / 2 - previous.inset) / previousPitchY;
  const requestedScrollX = next.inset + anchorColumn * nextPitchX - viewportWidth / 2;
  const requestedScrollY = next.inset + anchorRow * nextPitchY - viewportHeight / 2;
  const maximumScrollX = Math.max(0, next.width - viewportWidth);
  const maximumScrollY = Math.max(0, next.height - viewportHeight);
  return [
    Math.min(maximumScrollX, Math.max(0, requestedScrollX)),
    Math.min(maximumScrollY, Math.max(0, requestedScrollY)),
  ];
}

export function iconGridViewportUpdateKind(
  currentPoolCapacity: number,
  nextWindow: Pick<IconGridVirtualWindow, 'poolCapacity'>,
): 'rebuild' | 'retained' {
  if (!Number.isSafeInteger(currentPoolCapacity) || currentPoolCapacity < 0) {
    throw new RangeError('icon grid pool capacity must be a non-negative safe integer');
  }
  return currentPoolCapacity === nextWindow.poolCapacity ? 'retained' : 'rebuild';
}

export function iconGridAssignmentSignature(
  entries: readonly {
    readonly sourceText: string;
    readonly virtualIconIndex?: number;
  }[],
): string {
  return JSON.stringify(iconGridAssignments(entries));
}

function iconGridAssignments(
  entries: readonly {
    readonly sourceText: string;
    readonly virtualIconIndex?: number;
  }[],
): readonly IconGridAssignment[] {
  const assignments = entries
    .filter(
      (entry): entry is typeof entry & { readonly virtualIconIndex: number } => entry.virtualIconIndex !== undefined,
    )
    .map(({ sourceText, virtualIconIndex }) => ({ index: virtualIconIndex, content: sourceText }))
    .sort((left, right) => left.index - right.index);
  for (let index = 1; index < assignments.length; index += 1) {
    if (assignments[index - 1]!.index === assignments[index]!.index) {
      throw new Error(`icon grid assigned catalog index ${String(assignments[index]!.index)} twice`);
    }
  }
  return assignments;
}

export function iconGridLayout(itemCount: number, iconSize: number, viewportWidth: number): IconGridLayout {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) {
    throw new RangeError('icon grid item count must be a positive safe integer');
  }
  positive(iconSize, 'icon grid icon size');
  positive(viewportWidth, 'icon grid viewport width');
  const cellWidth = Math.max(
    ICON_GRID_MIN_CELL_WIDTH,
    iconSize * ICON_GRID_MAX_ADVANCE_EM + ICON_GRID_ICON_PADDING * 2,
  );
  const cellHeight = (iconSize + ICON_GRID_LABEL_SIZE) * LIVE_TEXT_LINE_HEIGHT + ICON_GRID_LABEL_GAP;
  const columns = Math.ceil(Math.sqrt(itemCount));
  const rows = Math.ceil(itemCount / columns);
  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    gap: ICON_GRID_GAP,
    inset: ICON_GRID_INSET,
    width: ICON_GRID_INSET * 2 + columns * cellWidth + Math.max(0, columns - 1) * ICON_GRID_GAP,
    height: ICON_GRID_INSET * 2 + rows * cellHeight + Math.max(0, rows - 1) * ICON_GRID_GAP,
  };
}

export function iconGridVirtualWindow(
  itemCount: number,
  iconSize: number,
  viewportWidth: number,
  viewportHeight: number,
  requestedScrollX: number,
  requestedScrollY: number,
): IconGridVirtualWindow {
  positive(viewportHeight, 'icon grid viewport height');
  if (!Number.isFinite(requestedScrollX) || !Number.isFinite(requestedScrollY)) {
    throw new TypeError('icon grid scroll positions must be finite');
  }
  const layout = iconGridLayout(itemCount, iconSize, viewportWidth);
  const maximumScrollX = Math.max(0, layout.width - viewportWidth);
  const maximumScrollY = Math.max(0, layout.height - viewportHeight);
  const scrollX = Math.min(maximumScrollX, Math.max(0, requestedScrollX));
  const scrollY = Math.min(maximumScrollY, Math.max(0, requestedScrollY));
  const pitchX = layout.cellWidth + layout.gap;
  const pitchY = layout.cellHeight + layout.gap;
  const [firstVisibleColumn, lastVisibleColumn] = intersectingGridRange(
    scrollX,
    scrollX + viewportWidth,
    layout.inset,
    layout.cellWidth,
    pitchX,
    layout.columns,
  );
  const [firstVisibleRow, lastVisibleRow] = intersectingGridRange(
    scrollY,
    scrollY + viewportHeight,
    layout.inset,
    layout.cellHeight,
    pitchY,
    layout.rows,
  );
  const visibleColumnCapacity = Math.ceil(viewportWidth / pitchX) + 1;
  const poolColumns = Math.min(layout.columns, visibleColumnCapacity + ICON_GRID_OVERSCAN_COLUMNS * 2);
  const poolStartColumn = Math.min(
    Math.max(0, layout.columns - poolColumns),
    Math.max(0, firstVisibleColumn - ICON_GRID_OVERSCAN_COLUMNS),
  );
  const visibleRowCapacity = Math.ceil(viewportHeight / pitchY) + 1;
  const poolRows = Math.min(layout.rows, visibleRowCapacity + ICON_GRID_OVERSCAN_ROWS * 2);
  const poolStartRow = Math.min(
    Math.max(0, layout.rows - poolRows),
    Math.max(0, firstVisibleRow - ICON_GRID_OVERSCAN_ROWS),
  );
  const poolEndRow = poolStartRow + poolRows;
  const indices: number[] = [];
  for (let row = poolStartRow; row < poolEndRow; row += 1) {
    for (let column = poolStartColumn; column < poolStartColumn + poolColumns; column += 1) {
      const index = row * layout.columns + column;
      if (index < itemCount) indices.push(index);
    }
  }
  const visibleIndices: number[] = [];
  for (let row = firstVisibleRow; row <= lastVisibleRow; row += 1) {
    for (let column = firstVisibleColumn; column <= lastVisibleColumn; column += 1) {
      const index = row * layout.columns + column;
      if (index < itemCount) visibleIndices.push(index);
    }
  }
  return {
    layout,
    indices,
    visibleIndices,
    poolCapacity: poolRows * poolColumns,
    firstVisibleIndex: visibleIndices.at(0) ?? -1,
    lastVisibleIndex: visibleIndices.at(-1) ?? -1,
    scrollX,
    scrollY,
    maximumScrollX,
    maximumScrollY,
  };
}

function intersectingGridRange(
  minimum: number,
  maximum: number,
  origin: number,
  cellSize: number,
  pitch: number,
  count: number,
): readonly [number, number] {
  const first = Math.floor((minimum - origin - cellSize) / pitch) + 1;
  const last = Math.ceil((maximum - origin) / pitch) - 1;
  return [Math.min(count - 1, Math.max(0, first)), Math.min(count - 1, Math.max(0, last))];
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

function committedLayout(text: Text): ParagraphLayout {
  const layout = text.layout;
  if (layout === undefined) throw new Error('comparison Text lost its committed layout');
  return layout;
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
    measureVisibleLayout(committedLayout(entry.text), zoomScale, metrics);
    if (entry.labelText !== undefined) measureVisibleLayout(committedLayout(entry.labelText), zoomScale, metrics);
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
  if (workload === 'off-axis-3d') {
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
