import {
  Activity,
  lazy,
  Suspense,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { BENCHMARK_IPSUM_INTER_GLYPH_COUNT } from './benchmark/benchmark-ipsum';
import {
  advanceAdvancedShaping,
  advancedShapingCase,
  advancedShapingFrame,
  initialAdvancedShapingState,
  updateAdvancedShaping,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
} from './benchmark/advanced-shaping';
import type { BenchmarkSummary, RunnerEvent } from './benchmark/contracts';
import { environmentResource } from './benchmark/environment';
import { runRegisteredBenchmark } from './benchmark/execution';
import {
  RuntimeAnimationControls,
  defaultRuntimeFontSizeForWorkload,
  RuntimeLayoutControls,
  RuntimePaintControls,
  RuntimeTelemetry,
  RuntimeViewControls,
  useRuntimeAnimationControls,
  useRuntimeLayoutControls,
  useRuntimePaintControls,
  useRuntimeTelemetry,
  useRuntimeViewControls,
  useRuntimeWorld,
  type RuntimeLiveStats,
} from './benchmark/runtime-world';
import { RuntimeWorldProvider } from './benchmark/runtime-world-provider';
import { captureLiveTextStats, type LiveBenchmarkCapture } from './benchmark/product-result';
import { createPayloadSummary } from './benchmark/payload-summary';
import {
  ADVANCED_FONT_FIXTURES,
  BENCHMARK_FONT_LABELS,
  ICON_GRID_FONT_FIXTURE,
  SELECTABLE_FONT_FIXTURES,
  benchmarkIpsumText,
  liveWorkloadFontFixtures,
  rasterConformanceSpecimen,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from './benchmark/font-fixtures';
import {
  readHarnessLocation,
  writeHarnessLocation,
  type FontDelivery,
  type GraphicsBackend,
  type HarnessLocation,
  type HarnessMode,
  type RasterTechnique,
} from './benchmark/url-state';
import { ExportPanel } from './components/export-panel';
import { InteractiveCanvas } from './components/interactive-canvas';
import { Report } from './components/report';
import { Controls, type ConformanceView } from './components/render-controls';
import { CompactSheet, CompactWorkloadPanel, MobileNavigation } from './components/responsive-shell';
import { TechniqueSwitcher } from './components/technique-switcher';
import { TelemetryCharts } from './components/telemetry-charts';
import { TopBar } from './components/top-bar';
import { workloadById, workloadsFor, type WorkloadOption } from './benchmark/workloads';
import { WorkloadRail } from './components/workload-rail';
import { ZenLayout } from './components/zen-layout';
import { ZenPayloadPills } from './components/zen-payload-pills';
import { Chip, Metric } from './components/ui';
import packageSizes from './generated/package-sizes.json';
import bitmapFixtures from '../fixtures/rendering/showcase-bitmap-density-fixtures-v0.json';
import mtsdfFixtures from '../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import slugFixtures from '../fixtures/rendering/showcase-slug-fixtures-v0.json';
import type {
  BitmapTextConformanceCapture,
  BitmapTextLiveStats,
  BitmapTextPreview,
  BitmapTextPreviewSnapshot,
  BitmapTextPreviewUpdate,
} from './renderer/bitmap-text';
import type { MtsdfTextConformanceCapture, MtsdfTextLiveStats, MtsdfTextPreview } from './renderer/mtsdf-text';
import type { SlugTextConformanceCapture, SlugTextLiveStats, SlugTextPreview } from './renderer/slug-text';
import type { RasterTechniqueComparison } from './renderer/raster-technique-compare';
import type {
  ComparisonWorkloadId,
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from './renderer/comparison-workload';
import { createExclusiveLifecycleCoordinator } from './renderer/exclusive-lifecycle';
import {
  benchmarkContentWidth,
  BENCHMARK_CONTENT_INSET,
  BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH,
} from './renderer/live-text-style';
import type { SourceOutlineFidelityCapture } from './renderer/source-outline-reference';
import type { RuntimeFallbackCapture } from './renderer/runtime-fallback-conformance';
import type { BakeProgress } from '@pmndrs/text';

type LiveTextStats = RuntimeLiveStats;

let comparisonWorkloadModule: ReturnType<typeof importComparisonWorkload> | undefined;

function importComparisonWorkload() {
  return import('./renderer/comparison-workload');
}

function preloadComparisonWorkload(): ReturnType<typeof importComparisonWorkload> {
  comparisonWorkloadModule ??= importComparisonWorkload();
  return comparisonWorkloadModule;
}

function scheduleComparisonWorkloadPreload(): () => void {
  if (globalThis.requestIdleCallback === undefined) return () => undefined;
  const request = globalThis.requestIdleCallback(() => {
    void preloadComparisonWorkload();
  });
  return () => globalThis.cancelIdleCallback(request);
}

interface LiveTextConfiguration extends Omit<BitmapTextPreviewUpdate, 'fontSize'> {
  readonly animatePresentation: boolean;
  readonly fontFixture: BenchmarkFontFixture;
  readonly expectedGlyphCount: number | undefined;
  readonly timelineTick: number | undefined;
}

interface PresentationEvidence {
  readonly revision: number;
  readonly progress: 0 | 1;
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}

interface ActivityWorkloads {
  readonly benchmark: string;
  readonly conformance: string;
}

const INITIAL_CONFORMANCE_VIEW: ConformanceView = {
  zoom: 1,
  panXPercent: 0,
  panYPercent: 0,
};

const EMPTY_FONT_FEATURES: BitmapTextPreviewUpdate['features'] = [];
const GLYPH_POSITION_TRANSITION_MS = 110;
const TYPEWRITER_INTERVAL_MS = 65;
const liveRendererLifecycle = createExclusiveLifecycleCoordinator();
const FontNoticesDialog = lazy(() => import('./components/font-notices-dialog'));
function techniqueLabel(technique: RasterTechnique): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

function comparisonWorkloadId(workload: string): ComparisonWorkloadId | undefined {
  switch (workload) {
    case 'text-ladder':
    case 'zoom-text':
    case 'icon-grid':
    case 'off-axis-3d':
    case 'dynamic-layout':
    case 'paragraph-stress':
    case 'paint-effects':
      return workload;
    default:
      return undefined;
  }
}

function isComparisonWorkloadStats(stats: LiveTextStats | undefined): stats is ComparisonWorkloadStats {
  return stats !== undefined && 'workload' in stats;
}

function workloadAmountLabel(workload: string, amount: number): string | undefined {
  switch (workload) {
    case 'off-axis-3d':
      return `Perspective intensity · ${amount}%`;
    case 'dynamic-layout':
      return `Reflow amplitude · ${amount}%`;
    case 'paragraph-stress':
      return `Text volume · ${amount}%`;
    case 'paint-effects':
      return `Hue spread · ${amount}%`;
    default:
      return undefined;
  }
}

function defaultFontSizeForWorkload(workload: string): number {
  return defaultRuntimeFontSizeForWorkload(workload);
}

function liveWorkloadSceneDescription(
  workload: string,
  showcaseFrame: AdvancedShapingFrame,
  technique: RasterTechnique,
): string {
  switch (workload) {
    case 'advanced-shaping':
      return `Tests whether ${showcaseFrame.caseDefinition.label.toLowerCase()} stay correct while the paragraph types and wraps.`;
    case 'text-ladder':
      return 'Tests one sentence at every size from 8 through 1024 pixels.';
    case 'zoom-text':
      return 'Tests retained center scaling from 8 pt to viewport fit while authenticated Inter translations of “Shape” cycle by language.';
    case 'icon-grid':
      return 'Tests a virtualized grid spanning all 1,402 named Font Awesome Solid icons with fixed font-rendered labels.';
    case 'off-axis-3d':
      return 'Tests readability and frame cost as a paragraph leans deep into the scene.';
    case 'dynamic-layout':
      return 'Tests whether three animated paragraphs reflow without stretching their glyphs.';
    case 'paragraph-stress':
      return 'Tests glyph, line, draw, memory, CPU, and GPU cost under paragraph pressure.';
    case 'paint-effects':
      return technique === 'slug'
        ? 'Tests the live cost and quality of Slug V0 animated fill color and opacity.'
        : 'Tests the live cost and quality of animated color, opacity, stroke, and shadow.';
    default:
      return 'Tests paragraph rendering cost while the viewport reflows the text.';
  }
}

function formatMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`;
}

function ShellFallback() {
  return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted">Loading harness…</div>;
}

export function App() {
  if (new URLSearchParams(locationSearch()).has('runner')) {
    return (
      <div
        className="grid min-h-screen place-items-center bg-background font-mono text-[10px] text-dim"
        data-testid="runner-host"
      >
        INTERNAL RUNNER HOST
      </div>
    );
  }
  return (
    <Suspense fallback={<ShellFallback />}>
      <Harness />
    </Suspense>
  );
}

function Harness() {
  return (
    <RuntimeWorldProvider>
      <HarnessApplication />
    </RuntimeWorldProvider>
  );
}

function HarnessApplication() {
  return useHarnessController();
}

function useHarnessController(): ReactNode {
  const environment = use(environmentResource());
  const runtimeWorld = useRuntimeWorld();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => true);
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
  const [location, setLocationState] = useState(() => {
    const value = readHarnessLocation(locationSearch(), defaultDeviceDpr());
    if (!environment.webgpu && !new URLSearchParams(locationSearch()).has('backend')) {
      return { ...value, backend: 'webgl2' as const };
    }
    return value;
  });
  const [activityWorkloads, setActivityWorkloads] = useState<ActivityWorkloads>(() => {
    const initial = readHarnessLocation(locationSearch(), defaultDeviceDpr());
    return {
      benchmark: initial.mode === 'benchmark' ? initial.workload : 'benchmark-ipsum',
      conformance: initial.mode === 'conformance' ? initial.workload : 'text-accuracy',
    };
  });
  const [summary, setSummary] = useState<BenchmarkSummary>();
  const [event, setEvent] = useState<RunnerEvent>();
  const [liveCapture, setLiveCapture] = useState<LiveBenchmarkCapture>();
  const [error, setError] = useState<string>();
  const [dpr, setDpr] = useState<1 | 2>(location.dpr);
  const [samples, setSamples] = useState(3);
  const [warmup, setWarmup] = useState(1);
  const [conformanceView, setConformanceView] = useState(INITIAL_CONFORMANCE_VIEW);
  const [comparisonText, setComparisonText] = useState(() => rasterConformanceSpecimen(location.fontFixture).text);
  const [showcaseState, setShowcaseState] = useState(initialAdvancedShapingState);
  const [advancedFontFixture, setAdvancedFontFixture] = useState<BenchmarkFontFixture>('inter');
  const [workloadPanelOpen, setWorkloadPanelOpen] = useState(() => desktopSnapshot());
  const [fontNoticesOpen, setFontNoticesOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const reportCaptureRequested = useRef(false);
  const conformanceRunRevision = useRef(0);

  const workload = workloadById(location.mode, location.workload);
  const fontFixture = location.fontFixture;
  const workloadTechnique = workload.techniques[location.technique];
  const showcaseFrame = advancedShapingFrame(showcaseState);
  const activeFontFixture: BenchmarkFontFixture =
    location.workload === 'advanced-shaping'
      ? advancedFontFixture
      : location.workload === 'zoom-text'
        ? 'inter'
        : fontFixture;
  const available = workloadTechnique.kind === 'ready';
  const backendAvailable = location.backend !== 'webgpu' || environment.webgpu;
  const zen = location.layout === 'zen' && location.mode === 'benchmark';

  function setLocation(next: Partial<HarnessLocation>): void {
    const value = { ...location, ...next };
    if (next.workload !== undefined) {
      setActivityWorkloads((current) => ({ ...current, [value.mode]: value.workload }));
    }
    if (next.workload !== undefined && next.workload !== location.workload) {
      runtimeWorld.set(RuntimeLayoutControls, { fontSize: defaultFontSizeForWorkload(next.workload) });
    }
    const replacesLiveSurface =
      next.mode !== undefined ||
      next.technique !== undefined ||
      next.backend !== undefined ||
      next.delivery !== undefined ||
      next.dpr !== undefined ||
      next.workload !== undefined;
    if (replacesLiveSurface) runtimeWorld.set(RuntimeTelemetry, { stats: undefined });
    if (replacesLiveSurface || next.fontFixture !== undefined) {
      conformanceRunRevision.current += 1;
      setSummary(undefined);
      setEvent(undefined);
      setLiveCapture(undefined);
    }
    setLocationState(value);
    globalThis.history?.replaceState(null, '', writeHarnessLocation(value));
  }

  function selectMode(mode: HarnessMode): void {
    setLocation({
      layout: mode === 'conformance' ? 'main' : location.layout,
      mode,
      workload: activityWorkloads[mode],
      view: 'scene',
    });
  }

  function selectTechnique(technique: RasterTechnique): void {
    const currentWorkload = workloadById(location.mode, location.workload);
    const selectedWorkload =
      currentWorkload.techniques[technique].kind === 'ready'
        ? currentWorkload.id
        : location.mode === 'benchmark'
          ? 'benchmark-ipsum'
          : 'text-accuracy';
    setLocation({
      technique,
      workload: selectedWorkload,
    });
  }

  function runConformance(): void {
    const revision = ++conformanceRunRevision.current;
    setError(undefined);
    startTransition(async () => {
      try {
        const value = await runRegisteredBenchmark({
          targetId:
            location.workload === 'runtime-fallback'
              ? `runtime-fallback-${location.technique}-${location.backend}`
              : location.workload === 'cross-technique-fidelity'
                ? `source-outline-${location.technique}-${location.backend}`
                : location.technique === 'slug'
                  ? `slug-conformance-${location.backend}`
                  : location.technique === 'mtsdf'
                    ? `mtsdf-conformance-${location.backend}`
                    : `bitmap-text-${location.backend}`,
          scenarioId:
            location.workload === 'runtime-fallback'
              ? 'runtime-fallback-parity'
              : location.workload === 'cross-technique-fidelity'
                ? 'source-outline-fidelity'
                : location.technique === 'slug'
                  ? 'slug-sampling-conformance'
                  : location.technique === 'mtsdf'
                    ? 'mtsdf-sampling-conformance'
                    : 'bitmap-text-frame',
          input: { fontFixture: activeFontFixture },
          controls: { dpr, samples, warmup },
          environment,
          onEvent: (nextEvent) => {
            if (revision === conformanceRunRevision.current) setEvent(nextEvent);
          },
        });
        if (revision === conformanceRunRevision.current) setSummary(value);
      } catch (caught) {
        if (revision === conformanceRunRevision.current) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    });
  }

  function completeLiveCapture(stats: LiveTextStats): void {
    const workloadFonts = liveWorkloadFontFixtures(location.workload, activeFontFixture);
    setLiveCapture({
      kind: 'live-benchmark',
      schemaVersion: 0,
      capturedAt: new Date().toISOString(),
      technique: location.technique,
      backend: location.backend,
      workload: location.workload,
      dpr,
      fontFixture: workloadFonts.primary,
      ...(workloadFonts.kind === 'icon-grid' ? { labelFontFixture: workloadFonts.labels } : {}),
      environment,
      stats: captureLiveTextStats(stats),
    });
    setLocation({ view: 'report' });
  }

  function captureWindow(): void {
    const liveStats = runtimeWorld.get(RuntimeTelemetry)?.stats;
    if (liveStats === undefined) return;
    if (runtimeWorld.get(RuntimeViewControls)?.showGrid || liveStats.showGrid) {
      reportCaptureRequested.current = true;
      runtimeWorld.set(RuntimeViewControls, { showGrid: false });
      return;
    }
    completeLiveCapture(liveStats);
  }

  function publishLiveStats(stats: LiveTextStats): void {
    runtimeWorld.set(RuntimeTelemetry, { stats });
    if (!reportCaptureRequested.current || stats.showGrid) return;
    reportCaptureRequested.current = false;
    completeLiveCapture(stats);
  }

  function invalidateLiveCapture(): void {
    setLiveCapture(undefined);
  }

  function dispatchShowcase(command: AdvancedShapingCommand): void {
    if (command.kind === 'select-case') {
      setAdvancedFontFixture(advancedShapingCase(command.caseId).fontFixture);
    }
    setShowcaseState((state) => updateAdvancedShaping(state, command));
    invalidateLiveCapture();
  }

  const advanceShowcase = useEffectEvent(() => {
    setShowcaseState((state) => advanceAdvancedShaping(state));
  });
  useEffect(() => {
    if (
      location.mode !== 'benchmark' ||
      location.workload !== 'advanced-shaping' ||
      !showcaseState.playing ||
      showcaseState.editedText !== undefined
    )
      return;
    let animationFrame = 0;
    let lastTickAt = performance.now();
    const animate = (timestamp: number): void => {
      if (timestamp - lastTickAt >= TYPEWRITER_INTERVAL_MS) {
        advanceShowcase();
        lastTickAt = timestamp;
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [location.mode, location.workload, showcaseState.editedText, showcaseState.playing]);

  const controls = (
    <RuntimeControls
      minimal={zen}
      backend={location.backend}
      delivery={location.delivery}
      dpr={dpr}
      conformanceView={conformanceView}
      comparisonText={comparisonText}
      fontFixture={activeFontFixture}
      mode={location.mode}
      technique={location.technique}
      workload={location.workload}
      showcaseFrame={showcaseFrame}
      showcaseState={showcaseState}
      selectedFontFixture={fontFixture}
      samples={samples}
      warmup={warmup}
      webgpu={environment.webgpu}
      onBackend={(backend) => setLocation({ backend })}
      onDelivery={(delivery) => setLocation({ delivery })}
      onDpr={(value) => {
        setDpr(value);
        setLocation({ dpr: value });
      }}
      onFontNotices={() => setFontNoticesOpen(true)}
      onConformanceReset={() => setConformanceView(INITIAL_CONFORMANCE_VIEW)}
      onConformanceZoom={(zoom) => setConformanceView((view) => ({ ...view, zoom }))}
      onComparisonText={setComparisonText}
      onRuntimeControl={invalidateLiveCapture}
      onSelectedFontFixture={(value) => {
        setLocation({ fontFixture: value });
      }}
      onSamples={setSamples}
      onShowcase={dispatchShowcase}
      onBeforeShowGrid={() => {
        reportCaptureRequested.current = false;
      }}
      onWarmup={setWarmup}
    />
  );

  const liveTechniqueComparison = location.mode === 'conformance' && location.workload === 'mtsdf-slug-compare';
  const actionEligible = available && backendAvailable && !isPending && !liveTechniqueComparison;

  const scene = (
    <Scene
      activeFontFixture={activeFontFixture}
      fontFixture={fontFixture}
      dpr={dpr}
      conformanceView={conformanceView}
      comparisonText={comparisonText}
      error={error}
      event={event}
      liveCapture={liveCapture}
      location={location}
      presentation={zen ? 'zen' : 'main'}
      activityWorkloads={activityWorkloads}
      summary={summary}
      showcaseFrame={showcaseFrame}
      onConformancePan={(deltaXPercent, deltaYPercent) =>
        setConformanceView((view) => ({
          ...view,
          panXPercent: view.panXPercent + deltaXPercent,
          panYPercent: view.panYPercent + deltaYPercent,
        }))
      }
      onConformanceZoom={(zoom) => setConformanceView((view) => ({ ...view, zoom }))}
      onLiveStats={publishLiveStats}
    />
  );

  return (
    <HarnessLayout
      actionEligible={actionEligible}
      activeFontFixture={activeFontFixture}
      controls={controls}
      desktop={desktop}
      fontNoticesOpen={fontNoticesOpen}
      isPending={isPending}
      liveCapture={liveCapture}
      liveTechniqueComparison={liveTechniqueComparison}
      location={location}
      phone={phone}
      scene={scene}
      showcaseFrame={showcaseFrame}
      summary={summary}
      webgpu={environment.webgpu}
      workloadPanelOpen={workloadPanelOpen}
      onAction={location.mode === 'benchmark' ? captureWindow : runConformance}
      onAdvancedFontFixture={(value) => {
        setAdvancedFontFixture(value);
        invalidateLiveCapture();
      }}
      onCloseFontNotices={() => setFontNoticesOpen(false)}
      onLocation={setLocation}
      onMode={selectMode}
      onTechnique={selectTechnique}
      onWorkloadPanelOpen={setWorkloadPanelOpen}
    />
  );
}

type RuntimeControlsProps = Omit<
  ComponentProps<typeof Controls>,
  | 'animationEnabled'
  | 'animationSpeed'
  | 'fontSize'
  | 'layoutWidthPercent'
  | 'liveStats'
  | 'onAnimationEnabled'
  | 'onAnimationSpeed'
  | 'onFontSize'
  | 'onLayoutWidthPercent'
  | 'onPaintOpacityPercent'
  | 'onPaintShadowEnabled'
  | 'onPaintStrokePercent'
  | 'onShowGrid'
  | 'onShowLayoutBounds'
  | 'onWorkloadAmount'
  | 'paintOpacityPercent'
  | 'paintShadowEnabled'
  | 'paintStrokePercent'
  | 'showGrid'
  | 'showLayoutBounds'
  | 'workloadAmount'
> & {
  readonly onBeforeShowGrid: () => void;
  readonly onRuntimeControl: () => void;
};

function RuntimeControls({ onBeforeShowGrid, onRuntimeControl, ...props }: RuntimeControlsProps) {
  const world = useRuntimeWorld();
  const view = useRuntimeViewControls();
  const layout = useRuntimeLayoutControls();
  const animation = useRuntimeAnimationControls();
  const paint = useRuntimePaintControls();
  const { stats: liveStats } = useRuntimeTelemetry();
  const changed = (change: () => void): void => {
    change();
    onRuntimeControl();
  };
  return (
    <Controls
      {...props}
      {...view}
      {...layout}
      {...animation}
      {...paint}
      liveStats={liveStats}
      onAnimationEnabled={(animationEnabled) =>
        changed(() => world.set(RuntimeAnimationControls, { animationEnabled }))
      }
      onAnimationSpeed={(animationSpeed) => changed(() => world.set(RuntimeAnimationControls, { animationSpeed }))}
      onFontSize={(fontSize) => changed(() => world.set(RuntimeLayoutControls, { fontSize }))}
      onLayoutWidthPercent={(layoutWidthPercent) =>
        changed(() => world.set(RuntimeLayoutControls, { layoutWidthPercent }))
      }
      onPaintOpacityPercent={(paintOpacityPercent) =>
        changed(() => world.set(RuntimePaintControls, { paintOpacityPercent }))
      }
      onPaintShadowEnabled={(paintShadowEnabled) =>
        changed(() => world.set(RuntimePaintControls, { paintShadowEnabled }))
      }
      onPaintStrokePercent={(paintStrokePercent) =>
        changed(() => world.set(RuntimePaintControls, { paintStrokePercent }))
      }
      onShowGrid={(showGrid) => {
        onBeforeShowGrid();
        changed(() => world.set(RuntimeViewControls, { showGrid }));
      }}
      onShowLayoutBounds={(showLayoutBounds) => changed(() => world.set(RuntimeViewControls, { showLayoutBounds }))}
      onWorkloadAmount={(workloadAmount) => changed(() => world.set(RuntimeLayoutControls, { workloadAmount }))}
    />
  );
}

function HarnessLayout({
  actionEligible,
  activeFontFixture,
  controls,
  desktop,
  fontNoticesOpen,
  isPending,
  liveCapture,
  liveTechniqueComparison,
  location,
  phone,
  scene,
  showcaseFrame,
  summary,
  webgpu,
  workloadPanelOpen,
  onAction,
  onAdvancedFontFixture,
  onCloseFontNotices,
  onLocation,
  onMode,
  onTechnique,
  onWorkloadPanelOpen,
}: {
  readonly actionEligible: boolean;
  readonly activeFontFixture: BenchmarkFontFixture;
  readonly controls: ReactNode;
  readonly desktop: boolean;
  readonly fontNoticesOpen: boolean;
  readonly isPending: boolean;
  readonly liveCapture: LiveBenchmarkCapture | undefined;
  readonly liveTechniqueComparison: boolean;
  readonly location: HarnessLocation;
  readonly phone: boolean;
  readonly scene: ReactNode;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly summary: BenchmarkSummary | undefined;
  readonly webgpu: boolean;
  readonly workloadPanelOpen: boolean;
  readonly onAction: () => void;
  readonly onAdvancedFontFixture: (value: BenchmarkFontFixture) => void;
  readonly onCloseFontNotices: () => void;
  readonly onLocation: (value: Partial<HarnessLocation>) => void;
  readonly onMode: (mode: HarnessMode) => void;
  readonly onTechnique: (technique: RasterTechnique) => void;
  readonly onWorkloadPanelOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  const { stats: liveStats } = useRuntimeTelemetry();
  const actionReady = actionEligible && (location.mode === 'conformance' || liveStats !== undefined);
  const zen = location.layout === 'zen' && location.mode === 'benchmark';
  if (zen) {
    const zenFontOptions =
      location.workload === 'icon-grid'
        ? [{ label: BENCHMARK_FONT_LABELS[ICON_GRID_FONT_FIXTURE], value: ICON_GRID_FONT_FIXTURE }]
        : location.workload === 'zoom-text'
          ? [{ label: BENCHMARK_FONT_LABELS.inter, value: 'inter' }]
          : location.workload === 'advanced-shaping'
            ? ADVANCED_FONT_FIXTURES.map((fixture) => ({ label: fixture.label, value: fixture.id }))
            : SELECTABLE_FONT_FIXTURES.map((fixture) => ({ label: fixture.label, value: fixture.id }));
    const zenPayload = createPayloadSummary({
      delivery: location.delivery,
      fixtureManifests: { bitmap: bitmapFixtures, mtsdf: mtsdfFixtures, slug: slugFixtures },
      fontFixture: activeFontFixture,
      ...(liveStats === undefined ? {} : { liveStats }),
      packageSizes,
      technique: location.technique,
      workload: location.workload,
    });
    return (
      <>
        <ZenLayout
          controls={controls}
          fontOptions={zenFontOptions}
          fontValue={
            location.workload === 'icon-grid'
              ? ICON_GRID_FONT_FIXTURE
              : location.workload === 'zoom-text'
                ? 'inter'
                : activeFontFixture
          }
          payload={<ZenPayloadPills summary={zenPayload} />}
          scene={scene}
          techniqueControl={
            <TechniqueSwitcher
              className="w-44"
              presentation="zen"
              technique={location.technique}
              onTechnique={onTechnique}
            />
          }
          telemetry={<TelemetryCharts presentation="zen" stats={liveStats} />}
          workloadOptions={workloadsFor('benchmark').map((option) => ({
            disabled: option.techniques[location.technique].kind !== 'ready',
            label: option.label,
            value: option.id,
          }))}
          workloadValue={location.workload}
          onExit={() => onLocation({ layout: 'main' })}
          onFont={(value) => {
            if (location.workload === 'icon-grid' || location.workload === 'zoom-text') return;
            if (location.workload === 'advanced-shaping') {
              onAdvancedFontFixture(value as BenchmarkFontFixture);
              return;
            }
            onLocation({ fontFixture: selectableFontFixture(value) });
          }}
          onWorkload={(workloadId) => onLocation({ workload: workloadId, view: 'scene' })}
        />
        {fontNoticesOpen && (
          <Suspense fallback={null}>
            <FontNoticesDialog onClose={onCloseFontNotices} />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-background text-foreground">
      <TopBar
        compact={!desktop}
        phone={phone}
        location={location}
        mode={location.mode}
        liveTechniqueComparison={liveTechniqueComparison}
        pending={isPending}
        ready={Boolean(actionReady)}
        webgpu={webgpu}
        onAction={
          location.mode === 'benchmark'
            ? location.view === 'report'
              ? () => onLocation({ view: 'scene' })
              : onAction
            : onAction
        }
        onControls={() => {
          onWorkloadPanelOpen(false);
          onLocation({ view: location.view === 'controls' ? 'scene' : 'controls' });
        }}
        onMenu={() => {
          if (!workloadPanelOpen && location.view === 'controls') {
            onLocation({ view: 'scene' });
          }
          onWorkloadPanelOpen((open) => !open);
        }}
        onMode={onMode}
        onTechnique={onTechnique}
        onZenMode={() => onLocation({ layout: 'zen', mode: 'benchmark', view: 'scene' })}
        workloadPanelOpen={workloadPanelOpen}
      />
      <div
        className={
          desktop
            ? 'grid h-[calc(100dvh-52px)] transition-[grid-template-columns] duration-200'
            : phone
              ? 'h-[calc(100dvh-52px)] pb-[58px]'
              : 'h-[calc(100dvh-52px)]'
        }
        style={
          desktop
            ? {
                gridTemplateColumns: workloadPanelOpen
                  ? '224px minmax(640px, 1fr) 288px'
                  : '0 minmax(640px, 1fr) 288px',
              }
            : undefined
        }
      >
        <div className={desktop ? 'min-w-0 overflow-hidden' : 'hidden'}>
          <WorkloadRail
            activeFontFixture={activeFontFixture}
            className="h-full w-56"
            location={location}
            showcaseFrame={showcaseFrame}
            onFontFixture={(value) => onLocation({ fontFixture: value })}
            onAdvancedFontFixture={onAdvancedFontFixture}
            onLocation={onLocation}
            onTechnique={onTechnique}
          />
        </div>
        <main
          className={
            desktop
              ? 'min-w-0 overflow-hidden border-r border-border bg-background p-4'
              : 'h-full min-h-0 overflow-hidden p-3'
          }
        >
          <div className={location.view !== 'report' && location.view !== 'export' ? 'h-full' : 'hidden'}>{scene}</div>
          {!desktop && location.view === 'controls' && (
            <CompactSheet phone={phone} title="Controls" onClose={() => onLocation({ view: 'scene' })}>
              {controls}
            </CompactSheet>
          )}
          {location.view === 'report' && (
            <div className="h-full overflow-y-auto overscroll-contain">
              <Report liveCapture={liveCapture} summary={summary} />
            </div>
          )}
          {location.view === 'export' && (
            <div className="h-full overflow-y-auto overscroll-contain">
              <ExportPanel liveCapture={liveCapture} summary={summary} />
            </div>
          )}
        </main>
        <aside className={desktop ? 'overflow-auto overscroll-contain bg-chrome p-4' : 'hidden'}>{controls}</aside>
        {!desktop && workloadPanelOpen && (
          <CompactWorkloadPanel phone={phone} onClose={() => onWorkloadPanelOpen(false)}>
            <WorkloadRail
              activeFontFixture={activeFontFixture}
              className="h-full w-full border-r-0"
              location={location}
              showcaseFrame={showcaseFrame}
              showTechnique={false}
              onFontFixture={(value) => onLocation({ fontFixture: value })}
              onAdvancedFontFixture={onAdvancedFontFixture}
              onLocation={(value) => {
                onLocation({ ...value, view: 'scene' });
                onWorkloadPanelOpen(false);
              }}
              onTechnique={onTechnique}
            />
          </CompactWorkloadPanel>
        )}
        {!desktop && phone && <MobileNavigation location={location} onLocation={onLocation} />}
      </div>
      {fontNoticesOpen && (
        <Suspense fallback={null}>
          <FontNoticesDialog onClose={onCloseFontNotices} />
        </Suspense>
      )}
    </div>
  );
}

function locationSearch(): string {
  return typeof globalThis.location === 'undefined' ? '' : globalThis.location.search;
}

function subscribeDesktop(listener: () => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => undefined;
  const media = globalThis.matchMedia('(min-width: 1200px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

function desktopSnapshot(): boolean {
  return typeof globalThis.matchMedia !== 'function' || globalThis.matchMedia('(min-width: 1200px)').matches;
}

function subscribePhone(listener: () => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => undefined;
  const media = globalThis.matchMedia('(max-width: 699px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

function phoneSnapshot(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 699px)').matches;
}

function defaultDeviceDpr(): 1 | 2 {
  return (globalThis.devicePixelRatio ?? 1) >= 1.5 ? 2 : 1;
}

function Scene({
  activeFontFixture,
  activityWorkloads,
  comparisonText,
  conformanceView,
  dpr,
  error,
  event,
  fontFixture,
  liveCapture,
  location,
  presentation,
  showcaseFrame,
  summary,
  onConformancePan,
  onConformanceZoom,
  onLiveStats,
}: {
  readonly activeFontFixture: BenchmarkFontFixture;
  readonly activityWorkloads: ActivityWorkloads;
  readonly comparisonText: string;
  readonly conformanceView: ConformanceView;
  readonly dpr: 1 | 2;
  readonly error: string | undefined;
  readonly event: RunnerEvent | undefined;
  readonly fontFixture: SelectableFontFixture;
  readonly liveCapture: LiveBenchmarkCapture | undefined;
  readonly location: HarnessLocation;
  readonly presentation: 'main' | 'zen';
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly summary: BenchmarkSummary | undefined;
  readonly onConformancePan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onConformanceZoom: (zoom: number) => void;
  readonly onLiveStats: (stats: LiveTextStats) => void;
}) {
  const { showGrid: grid, showLayoutBounds } = useRuntimeViewControls();
  const { fontSize, layoutWidthPercent, workloadAmount } = useRuntimeLayoutControls();
  const { animationEnabled, animationSpeed } = useRuntimeAnimationControls();
  const { paintOpacityPercent, paintShadowEnabled, paintStrokePercent } = useRuntimePaintControls();
  const { stats: liveStats } = useRuntimeTelemetry();
  const workload = workloadById(location.mode, location.workload);
  const benchmarkWorkload = workloadById('benchmark', activityWorkloads.benchmark);
  const benchmarkStatus = benchmarkWorkload.techniques[location.technique];
  const conformanceWorkload = workloadById('conformance', activityWorkloads.conformance);
  const conformanceStatus = conformanceWorkload.techniques[location.technique];
  const benchmarkSurface =
    benchmarkStatus.kind === 'planned' ? (
      <PlannedWorkloadSurface
        milestone={benchmarkStatus.milestone}
        technique={location.technique}
        workload={benchmarkWorkload}
      />
    ) : (
      <BenchmarkSurface
        animationEnabled={animationEnabled}
        animationSpeed={animationSpeed}
        backend={location.backend}
        delivery={location.delivery}
        dpr={dpr}
        fontSize={fontSize}
        fontFixture={activeFontFixture}
        grid={grid}
        layoutWidthPercent={layoutWidthPercent}
        paintOpacityPercent={paintOpacityPercent}
        paintShadowEnabled={paintShadowEnabled}
        paintStrokePercent={paintStrokePercent}
        presentation={presentation}
        showLayoutBounds={showLayoutBounds}
        workloadAmount={workloadAmount}
        key={`${location.mode}-${location.backend}-${location.delivery}-${String(dpr)}`}
        showcaseFrame={showcaseFrame}
        stats={liveStats}
        technique={location.technique}
        workload={benchmarkWorkload.id}
        onStats={onLiveStats}
      />
    );

  if (presentation === 'zen') {
    return (
      <section className="relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]" data-testid="scene">
        {benchmarkSurface}
        {error !== undefined && (
          <div className="absolute bottom-4 left-4 z-30 max-w-md rounded-md border border-danger bg-black/80 p-3 text-xs text-danger">
            {error}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3"
      data-captured-at={liveCapture?.capturedAt}
      data-execution-id={summary?.executionId}
      data-testid="scene"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="eyebrow">{location.mode === 'benchmark' ? 'Live benchmark' : 'Correctness inspection'}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workload.label}</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted">{workload.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:justify-end sm:gap-2">
          <Chip tone="accent">{techniqueLabel(location.technique)}</Chip>
          <Chip>{location.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}</Chip>
          <Chip>{location.delivery === 'runtime' ? 'Runtime bake' : 'Baked asset'}</Chip>
          <Chip>{dpr}× DPR</Chip>
        </div>
      </header>
      <Activity name="benchmark" mode={location.mode === 'benchmark' ? 'visible' : 'hidden'}>
        <div className="contents" data-activity="benchmark">
          {benchmarkSurface}
        </div>
      </Activity>
      <Activity name="conformance" mode={location.mode === 'conformance' ? 'visible' : 'hidden'}>
        <div className="contents" data-activity="conformance">
          {conformanceStatus.kind === 'planned' ? (
            <PlannedWorkloadSurface
              milestone={conformanceStatus.milestone}
              technique={location.technique}
              workload={conformanceWorkload}
            />
          ) : (
            <ConformanceSurface
              backend={location.backend}
              comparisonText={comparisonText}
              conformanceView={conformanceView}
              dpr={dpr}
              event={event}
              fontFixture={fontFixture}
              key={`${location.mode}-${location.backend}-${String(dpr)}-${fontFixture}-${conformanceWorkload.id === 'mtsdf-slug-compare' ? 'paired' : location.technique}-${conformanceWorkload.id}`}
              summary={summary}
              technique={location.technique}
              workload={conformanceWorkload.id}
              onPan={onConformancePan}
              onZoom={onConformanceZoom}
            />
          )}
        </div>
      </Activity>
      {error !== undefined && (
        <div className="rounded-md border border-danger/50 bg-danger/10 p-3 text-xs text-danger">{error}</div>
      )}
      {location.mode === 'benchmark' && liveCapture !== undefined && (
        <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs text-muted">
          Captured the current rolling window at {liveCapture.capturedAt} ·{' '}
          {liveCapture.stats.framesPerSecond.toFixed(1)} FPS · {formatMs(liveCapture.stats.medianSubmitMs)} CPU frame
        </div>
      )}
    </section>
  );
}

function PlannedWorkloadSurface({
  milestone,
  technique,
  workload,
}: {
  readonly milestone: 8 | 9;
  readonly technique: RasterTechnique;
  readonly workload: WorkloadOption;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-md border border-border bg-panel p-8 text-center">
      <div className="max-w-md">
        <p className="eyebrow">Milestone {milestone}</p>
        <h2 className="mt-2 text-lg font-semibold">
          {techniqueLabel(technique)} · {workload.label}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{workload.description}</p>
      </div>
    </div>
  );
}

function BenchmarkSurface({
  animationEnabled,
  animationSpeed,
  backend,
  delivery,
  dpr,
  fontFixture,
  fontSize,
  grid,
  layoutWidthPercent,
  paintOpacityPercent,
  paintShadowEnabled,
  paintStrokePercent,
  presentation,
  showLayoutBounds,
  workloadAmount,
  showcaseFrame,
  stats,
  technique,
  workload,
  onStats,
}: {
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontFixture: BenchmarkFontFixture;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly layoutWidthPercent: number;
  readonly paintOpacityPercent: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokePercent: number;
  readonly presentation: 'main' | 'zen';
  readonly showLayoutBounds: boolean;
  readonly workloadAmount: number;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly stats: LiveTextStats | undefined;
  readonly technique: RasterTechnique;
  readonly workload: string;
  readonly onStats: (stats: LiveTextStats) => void;
}) {
  useEffect(() => {
    return scheduleComparisonWorkloadPreload();
  }, []);
  const advanced = workload === 'advanced-shaping';
  const comparisonWorkload = comparisonWorkloadId(workload);
  const bitmapStats = stats?.technique === 'bitmap' ? stats : undefined;
  const mtsdfStats = stats?.technique === 'mtsdf' ? stats : undefined;
  const slugStats = stats?.technique === 'slug' ? stats : undefined;
  const comparisonStats = isComparisonWorkloadStats(stats) ? stats : undefined;
  const textConfiguration: LiveTextConfiguration = advanced
    ? {
        anchor: 'measure-center',
        direction: showcaseFrame.caseDefinition.direction,
        expectedGlyphCount: undefined,
        animatePresentation: false,
        features: showcaseFrame.caseDefinition.features,
        fontFixture,
        language: showcaseFrame.caseDefinition.language,
        layoutWidthRatio: showcaseFrame.widthPermille / 1000,
        text: showcaseFrame.text,
        textAlign: 'start',
        timelineTick: showcaseFrame.tick,
      }
    : {
        anchor: 'center',
        direction: 'ltr',
        expectedGlyphCount: fontFixture === 'inter' ? BENCHMARK_IPSUM_INTER_GLYPH_COUNT : undefined,
        animatePresentation: false,
        features: EMPTY_FONT_FEATURES,
        fontFixture,
        language: 'en',
        layoutWidthRatio: layoutWidthPercent / 100,
        text: benchmarkIpsumText(),
        textAlign: 'start',
        timelineTick: undefined,
      };
  const viewport =
    comparisonWorkload !== undefined ? (
      <ComparisonWorkloadViewport
        amount={workloadAmount}
        animationEnabled={animationEnabled}
        animationSpeed={animationSpeed}
        backend={backend}
        delivery={delivery}
        dpr={dpr}
        fontSize={fontSize}
        fontFixture={fontFixture}
        grid={grid}
        layoutWidthRatio={layoutWidthPercent / 100}
        paintOpacity={paintOpacityPercent / 100}
        paintShadowEnabled={paintShadowEnabled}
        paintStrokeWidth={paintStrokePercent / 100}
        showLayoutBounds={showLayoutBounds}
        stats={comparisonStats}
        technique={technique}
        workload={comparisonWorkload}
        key={`${backend}:${delivery}:${String(dpr)}:${fontFixture}:${technique}:${comparisonWorkload}`}
        onStats={onStats}
      />
    ) : technique === 'slug' ? (
      <SlugTextViewport
        backend={backend}
        delivery={delivery}
        dpr={dpr}
        fontSize={fontSize}
        grid={grid}
        key={textConfiguration.fontFixture}
        stats={slugStats}
        textConfiguration={textConfiguration}
        onStats={onStats}
      />
    ) : technique === 'mtsdf' ? (
      <MtsdfTextViewport
        backend={backend}
        delivery={delivery}
        dpr={dpr}
        fontSize={fontSize}
        grid={grid}
        key={textConfiguration.fontFixture}
        stats={mtsdfStats}
        textConfiguration={textConfiguration}
        onStats={onStats}
      />
    ) : (
      <BitmapTextViewport
        backend={backend}
        delivery={delivery}
        dpr={dpr}
        fontSize={fontSize}
        grid={grid}
        key={textConfiguration.fontFixture}
        stats={bitmapStats}
        textConfiguration={textConfiguration}
        onStats={onStats}
      />
    );
  return (
    <div
      className={
        presentation === 'zen'
          ? 'grid h-full min-h-0 grid-rows-[0_minmax(0,1fr)] overflow-hidden'
          : 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3'
      }
      data-presentation={presentation}
      data-testid="benchmark-surface"
    >
      <div
        className={
          presentation === 'main'
            ? 'grid grid-cols-[repeat(3,minmax(0,1fr))_repeat(2,minmax(0,0.55fr))] gap-px overflow-hidden rounded-md border border-border bg-border'
            : 'invisible overflow-hidden'
        }
      >
        {presentation === 'main' && (
          <>
            <TelemetryCharts stats={stats} />
            <div className="metric-summary-grid bg-surface">
              <Metric
                label="Glyphs / draws"
                value={stats === undefined ? '—' : `${stats.glyphCount} / ${stats.drawCount}`}
              />
            </div>
            <div className="metric-summary-grid bg-surface">
              <Metric label="Missing glyphs" value={stats === undefined ? '—' : String(stats.missingGlyphCount)} />
            </div>
          </>
        )}
      </div>
      <div
        className={
          presentation === 'zen'
            ? 'flex min-h-0 flex-col overflow-hidden'
            : 'flex min-h-0 flex-col rounded-md border border-border bg-surface p-3'
        }
      >
        <div className={presentation === 'main' ? 'mb-3 flex items-start justify-between gap-3' : 'hidden'}>
          {presentation === 'main' && (
            <>
              <div>
                <p className="eyebrow">Realtime scene</p>
                <p className="mt-1 text-xs text-muted">
                  {liveWorkloadSceneDescription(workload, showcaseFrame, technique)}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[9px] text-success">LIVE</span>
            </>
          )}
        </div>
        {viewport}
      </div>
    </div>
  );
}

function ConformanceSurface({
  workload,
  ...properties
}: {
  readonly backend: GraphicsBackend;
  readonly comparisonText: string;
  readonly conformanceView: ConformanceView;
  readonly dpr: 1 | 2;
  readonly event: RunnerEvent | undefined;
  readonly fontFixture: SelectableFontFixture;
  readonly summary: BenchmarkSummary | undefined;
  readonly technique: RasterTechnique;
  readonly workload: string;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  return workload === 'mtsdf-slug-compare' ? (
    <RasterTechniqueComparisonSurface
      backend={properties.backend}
      comparisonText={properties.comparisonText}
      conformanceView={properties.conformanceView}
      dpr={properties.dpr}
      fontFixture={properties.fontFixture}
      onPan={properties.onPan}
      onZoom={properties.onZoom}
    />
  ) : (
    <FiniteConformanceSurface {...properties} workload={workload} />
  );
}

function RasterTechniqueComparisonSurface({
  backend,
  comparisonText,
  conformanceView,
  dpr,
  fontFixture,
  onPan,
  onZoom,
}: {
  readonly backend: GraphicsBackend;
  readonly comparisonText: string;
  readonly conformanceView: ConformanceView;
  readonly dpr: 1 | 2;
  readonly fontFixture: SelectableFontFixture;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const comparisonRef = useRef<RasterTechniqueComparison>(undefined);
  const [ready, setReady] = useState(false);
  const [committedText, setCommittedText] = useState('');
  const [error, setError] = useState<string>();
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const initialView = useEffectEvent(() => conformanceView);
  const initialText = useEffectEvent(() => comparisonText);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const controller = new AbortController();
    let comparison: RasterTechniqueComparison | undefined;
    let lifecycleLease: Awaited<ReturnType<typeof liveRendererLifecycle.acquire>> | undefined;
    let cancelled = false;
    const resize = (): void => {
      if (comparison === undefined) return;
      const bounds = container.getBoundingClientRect();
      comparison.resize(Math.max(1, bounds.width), Math.max(1, bounds.height));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const initialization = (async () => {
      lifecycleLease = await liveRendererLifecycle.acquire(controller.signal);
      try {
        if (cancelled) return;
        const { createRasterTechniqueComparison } = await import('./renderer/raster-technique-compare');
        if (cancelled) return;
        const bounds = container.getBoundingClientRect();
        const optionsText = initialText();
        const created = await createRasterTechniqueComparison({
          backend,
          canvas,
          dpr,
          fontFixture,
          height: Math.max(1, bounds.height),
          onError: publishError,
          signal: controller.signal,
          text: optionsText,
          width: Math.max(1, bounds.width),
        });
        if (cancelled) {
          await created.dispose();
          return;
        }
        comparison = created;
        let text = optionsText;
        let latestText = initialText();
        while (latestText !== text) {
          text = latestText;
          await created.setText(text);
          latestText = initialText();
        }
        if (cancelled) return;
        const view = initialView();
        created.setView(view.zoom, view.panXPercent, view.panYPercent);
        resize();
        comparisonRef.current = created;
        setCommittedText(text);
        setReady(true);
        setError(undefined);
      } catch (caught) {
        const failedComparison = comparison;
        comparison = undefined;
        if (comparisonRef.current === failedComparison) comparisonRef.current = undefined;
        try {
          await failedComparison?.dispose();
        } finally {
          lifecycleLease.release();
          lifecycleLease = undefined;
        }
        throw caught;
      }
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
      void initialization.then(
        async () => {
          try {
            if (comparison === undefined) return;
            const current = comparison;
            comparison = undefined;
            if (comparisonRef.current === current) comparisonRef.current = undefined;
            await current.dispose();
          } finally {
            lifecycleLease?.release();
            lifecycleLease = undefined;
          }
        },
        () => {
          lifecycleLease?.release();
          lifecycleLease = undefined;
        },
      );
    };
  }, [backend, dpr, fontFixture]);

  useEffect(() => {
    comparisonRef.current?.setView(conformanceView.zoom, conformanceView.panXPercent, conformanceView.panYPercent);
  }, [conformanceView]);

  useEffect(() => {
    let current = true;
    void comparisonRef.current
      ?.setText(comparisonText)
      .then(() => {
        if (current) {
          setCommittedText(comparisonText);
          setError(undefined);
        }
      })
      .catch(publishError);
    return () => {
      current = false;
    };
  }, [comparisonText]);

  const zoomFromWheel = useEffectEvent((deltaY: number) => {
    const direction = deltaY < 0 ? 0.25 : -0.25;
    onZoom(Math.min(8, Math.max(1, conformanceView.zoom + direction)));
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomFromWheel(event.deltaY);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  function moveView(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || conformanceView.zoom <= 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onPan((event.movementX / bounds.width) * 300, (event.movementY / bounds.height) * 100);
  }

  return (
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(420px,1fr)_auto] gap-3"
      data-comparison-text={committedText}
      data-conformance-ready={String(ready)}
      data-testid="raster-technique-comparison"
    >
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface">
        <Metric label="Pipeline" value="GPU only" />
        <Metric label="Readback / CPU diff" value="0 / 0" />
        <Metric label="Heatmap gain" value="8×" />
      </div>
      <div
        ref={containerRef}
        className="relative min-h-[420px] overflow-hidden rounded-md border border-border bg-background"
      >
        <canvas
          ref={canvasRef}
          aria-label="Live MSDF and Slug GPU comparison"
          className={`absolute inset-0 size-full touch-none bg-background ${conformanceView.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
          data-pan-x={conformanceView.panXPercent}
          data-pan-y={conformanceView.panYPercent}
          data-zoom={conformanceView.zoom}
          onDoubleClick={() => onZoom(conformanceView.zoom === 1 ? 2 : 1)}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={moveView}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-3 border-b border-border bg-black/70 font-mono text-[9px] uppercase tracking-wider text-muted">
          <span className="border-r border-border px-3 py-2">MSDF</span>
          <span className="border-r border-border px-3 py-2">Slug</span>
          <span className="px-3 py-2">Delta ×8 · red MSDF / cyan Slug</span>
        </div>
        {!ready && error === undefined && (
          <div className="absolute inset-0 grid place-items-center bg-background text-[10px] text-muted">
            INITIALIZING GPU COMPARISON
          </div>
        )}
        {error !== undefined && (
          <div className="absolute inset-0 grid place-items-center bg-background p-3 text-center text-[10px] text-danger">
            {error}
          </div>
        )}
      </div>
      <div className="rounded-md border border-border bg-surface p-3 text-[10px] text-dim">
        Both candidates share the same text, layout dimensions, camera, physical target size, and view transform. The
        heatmap samples both render targets directly on the GPU; black agrees, red is extra MSDF coverage, and cyan is
        extra Slug coverage.
      </div>
    </div>
  );
}

function FiniteConformanceSurface({
  backend,
  conformanceView,
  dpr,
  event,
  fontFixture,
  summary,
  technique,
  workload,
  onPan,
  onZoom,
}: {
  readonly backend: GraphicsBackend;
  readonly conformanceView: ConformanceView;
  readonly dpr: 1 | 2;
  readonly event: RunnerEvent | undefined;
  readonly fontFixture: SelectableFontFixture;
  readonly summary: BenchmarkSummary | undefined;
  readonly technique: RasterTechnique;
  readonly workload: string;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const [capture, setCapture] = useState<
    | { readonly kind: 'bitmap'; readonly value: BitmapTextConformanceCapture }
    | { readonly kind: 'mtsdf'; readonly value: MtsdfTextConformanceCapture }
    | { readonly kind: 'slug'; readonly value: SlugTextConformanceCapture }
    | { readonly kind: 'source-outline'; readonly value: SourceOutlineFidelityCapture }
    | { readonly kind: 'runtime-fallback'; readonly value: RuntimeFallbackCapture }
  >();
  const [error, setError] = useState<string>();
  const publishCapture = useEffectEvent(
    (
      value:
        | { readonly kind: 'bitmap'; readonly value: BitmapTextConformanceCapture }
        | { readonly kind: 'mtsdf'; readonly value: MtsdfTextConformanceCapture }
        | { readonly kind: 'slug'; readonly value: SlugTextConformanceCapture }
        | { readonly kind: 'source-outline'; readonly value: SourceOutlineFidelityCapture }
        | { readonly kind: 'runtime-fallback'; readonly value: RuntimeFallbackCapture },
    ) => {
      setCapture(value);
      setError(undefined);
    },
  );
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  useEffect(() => {
    if (summary === undefined) return;
    const controller = new AbortController();
    let cancelled = false;
    const request =
      workload === 'runtime-fallback'
        ? import('./renderer/runtime-fallback-conformance').then(async ({ captureRuntimeFallbackConformance }) => ({
            kind: 'runtime-fallback' as const,
            value: await captureRuntimeFallbackConformance({
              backend,
              dpr,
              fontFixture,
              signal: controller.signal,
              technique,
            }),
          }))
        : workload === 'cross-technique-fidelity'
          ? technique === 'slug'
            ? import('./renderer/slug-text').then(async ({ captureSlugSourceOutlineFidelity }) => ({
                kind: 'source-outline' as const,
                value: await captureSlugSourceOutlineFidelity({
                  backend,
                  dpr,
                  fontFixture,
                  signal: controller.signal,
                }),
              }))
            : technique === 'mtsdf'
              ? import('./renderer/mtsdf-text').then(async ({ captureMtsdfSourceOutlineFidelity }) => ({
                  kind: 'source-outline' as const,
                  value: await captureMtsdfSourceOutlineFidelity({
                    backend,
                    dpr,
                    fontFixture,
                    signal: controller.signal,
                  }),
                }))
              : import('./renderer/bitmap-text').then(async ({ captureBitmapSourceOutlineFidelity }) => ({
                  kind: 'source-outline' as const,
                  value: await captureBitmapSourceOutlineFidelity({
                    backend,
                    dpr,
                    fontFixture,
                    signal: controller.signal,
                  }),
                }))
          : technique === 'slug'
            ? import('./renderer/slug-text').then(async ({ captureSlugTextConformance }) => ({
                kind: 'slug' as const,
                value: await captureSlugTextConformance({
                  backend,
                  dpr,
                  fontFixture,
                  signal: controller.signal,
                }),
              }))
            : technique === 'mtsdf'
              ? import('./renderer/mtsdf-text').then(async ({ captureMtsdfTextConformance }) => ({
                  kind: 'mtsdf' as const,
                  value: await captureMtsdfTextConformance({
                    backend,
                    dpr,
                    fontFixture,
                    signal: controller.signal,
                  }),
                }))
              : import('./renderer/bitmap-text').then(async ({ captureBitmapTextConformance }) => ({
                  kind: 'bitmap' as const,
                  value: await captureBitmapTextConformance({
                    backend,
                    dpr,
                    fontFixture,
                    signal: controller.signal,
                  }),
                }));
    void request
      .then((value) => {
        if (!cancelled) publishCapture(value);
      })
      .catch((caught: unknown) => {
        if (!cancelled) publishError(caught);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backend, dpr, fontFixture, summary, technique, workload]);

  const bitmapCapture = capture?.kind === 'bitmap' ? capture.value : undefined;
  const mtsdfCapture = capture?.kind === 'mtsdf' ? capture.value : undefined;
  const slugCapture = capture?.kind === 'slug' ? capture.value : undefined;
  const analyticCapture = technique === 'slug' ? slugCapture : mtsdfCapture;
  const sourceOutlineCapture = capture?.kind === 'source-outline' ? capture.value : undefined;
  const runtimeFallbackCapture = capture?.kind === 'runtime-fallback' ? capture.value : undefined;
  const isSourceOutline = workload === 'cross-technique-fidelity';
  const isRuntimeFallback = workload === 'runtime-fallback';

  return (
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(360px,1fr)_auto] gap-3"
      data-conformance-ready={String(capture !== undefined)}
      data-runtime-fallback-mismatch-bytes={runtimeFallbackCapture?.mismatchBytes}
      data-runtime-fallback-changed-pixels={runtimeFallbackCapture?.changedPixels}
      data-runtime-fallback-maximum-error={runtimeFallbackCapture?.maximumError}
      data-testid="conformance-surface"
    >
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface md:grid-cols-4">
        <Metric
          label={
            isRuntimeFallback
              ? 'Mismatched bytes'
              : isSourceOutline || technique !== 'bitmap'
                ? 'Mean error · 0–255'
                : 'Reference mismatch'
          }
          value={
            isRuntimeFallback
              ? String(runtimeFallbackCapture?.mismatchBytes ?? '—')
              : isSourceOutline
                ? sourceOutlineCapture === undefined
                  ? '—'
                  : `${sourceOutlineCapture.meanAbsoluteError.toFixed(3)} · ${((sourceOutlineCapture.meanAbsoluteError / 255) * 100).toFixed(3)}%`
                : technique !== 'bitmap'
                  ? analyticCapture === undefined
                    ? '—'
                    : `${analyticCapture.meanAbsoluteError.toFixed(3)} · ${((analyticCapture.meanAbsoluteError / 255) * 100).toFixed(3)}%`
                  : bitmapCapture === undefined
                    ? '—'
                    : String(bitmapCapture.mismatchBytes)
          }
        />
        <Metric
          label={
            isRuntimeFallback
              ? 'Changed pixels'
              : isSourceOutline || technique !== 'bitmap'
                ? 'Pixels > 2 / 255'
                : 'Half-coverage ink'
          }
          value={
            isRuntimeFallback
              ? String(runtimeFallbackCapture?.changedPixels ?? '—')
              : isSourceOutline
                ? sourceOutlineCapture === undefined
                  ? '—'
                  : `${sourceOutlineCapture.errorPixels} · ${((sourceOutlineCapture.errorPixels / (sourceOutlineCapture.width * sourceOutlineCapture.height)) * 100).toFixed(2)}%`
                : technique !== 'bitmap'
                  ? analyticCapture === undefined
                    ? '—'
                    : `${analyticCapture.errorPixels} · ${((analyticCapture.errorPixels / (analyticCapture.width * analyticCapture.height)) * 100).toFixed(2)}%`
                  : bitmapCapture === undefined
                    ? '—'
                    : String(bitmapCapture.inkPixels)
          }
        />
        <Metric
          label={
            isRuntimeFallback
              ? 'Maximum error · 0–255'
              : isSourceOutline || technique !== 'bitmap'
                ? 'Maximum error · 0–255'
                : 'Lit pixels'
          }
          value={
            isRuntimeFallback
              ? `${runtimeFallbackCapture?.maximumError ?? '—'} / 255`
              : isSourceOutline
                ? sourceOutlineCapture === undefined
                  ? '—'
                  : `${sourceOutlineCapture.maximumError} / 255`
                : technique !== 'bitmap'
                  ? analyticCapture === undefined
                    ? '—'
                    : `${analyticCapture.maximumError} / 255`
                  : bitmapCapture === undefined
                    ? '—'
                    : String(bitmapCapture.litPixels)
          }
        />
        <Metric label="Render submit (diagnostic)" value={formatMs(capture?.value.renderSubmitMs)} />
        <Metric label="Suite duration" value={formatMs(summary?.medianMs ?? event?.medianMs)} />
      </div>
      <FiniteConformancePanels
        analyticCapture={analyticCapture}
        bitmapCapture={bitmapCapture}
        conformanceView={conformanceView}
        runtimeFallbackCapture={runtimeFallbackCapture}
        sourceOutlineCapture={sourceOutlineCapture}
        technique={technique}
        workload={workload}
        onPan={onPan}
        onZoom={onZoom}
      />
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className={`size-2 rounded-full ${summary?.status === 'passed' ? 'bg-success' : 'bg-dim'}`} />
          <span className="font-medium">Finite conformance suite</span>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {summary?.validation ??
              (isSourceOutline
                ? 'Run conformance to validate the selected renderer against the pinned source font in browser Canvas2D.'
                : technique !== 'bitmap'
                  ? `Run conformance to validate ${techniqueLabel(technique)} GPU sampling against the independent CPU sampling reference.`
                  : 'Run conformance to test full-frame and clipped output.')}
          </span>
        </div>
        <p className="mt-2 text-[10px] text-dim">
          {isSourceOutline
            ? 'All techniques are compared independently with browser Canvas2D using the same pinned source font, authored lines, physical size, and paragraph baselines.'
            : technique !== 'bitmap'
              ? 'Heatmap: black agrees, red is extra GPU coverage, and cyan is extra CPU-reference coverage. Intensity is amplified 8×.'
              : 'End-to-end suite duration includes readback, CPU composition, comparison, clipping, and hashing. It is test cost, not renderer performance.'}
        </p>
      </div>
      {error !== undefined && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function FiniteConformancePanels({
  analyticCapture,
  bitmapCapture,
  conformanceView,
  runtimeFallbackCapture,
  sourceOutlineCapture,
  technique,
  workload,
  onPan,
  onZoom,
}: {
  readonly analyticCapture: MtsdfTextConformanceCapture | SlugTextConformanceCapture | undefined;
  readonly bitmapCapture: BitmapTextConformanceCapture | undefined;
  readonly conformanceView: ConformanceView;
  readonly runtimeFallbackCapture: RuntimeFallbackCapture | undefined;
  readonly sourceOutlineCapture: SourceOutlineFidelityCapture | undefined;
  readonly technique: RasterTechnique;
  readonly workload: string;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  if (workload === 'runtime-fallback') {
    return (
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
        <PixelBytesPanel
          bytes={runtimeFallbackCapture?.baked}
          conformanceView={conformanceView}
          height={runtimeFallbackCapture?.height}
          label="Checked-in baked asset"
          width={runtimeFallbackCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={runtimeFallbackCapture?.runtime}
          conformanceView={conformanceView}
          height={runtimeFallbackCapture?.height}
          label="Source font · runtime bake"
          width={runtimeFallbackCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={runtimeFallbackCapture?.difference}
          className="md:col-span-2"
          conformanceView={conformanceView}
          height={runtimeFallbackCapture?.height}
          label="Baked / runtime difference heatmap ×8"
          width={runtimeFallbackCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
      </div>
    );
  }
  if (workload === 'cross-technique-fidelity') {
    return (
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
        <PixelBytesPanel
          bytes={sourceOutlineCapture?.candidate}
          conformanceView={conformanceView}
          height={sourceOutlineCapture?.height}
          label={`${techniqueLabel(technique)} candidate · ${sourceOutlineCapture?.physicalPpem ?? '—'} device px`}
          width={sourceOutlineCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={sourceOutlineCapture?.reference}
          conformanceView={conformanceView}
          height={sourceOutlineCapture?.height}
          label="Browser Canvas2D · pinned source font"
          width={sourceOutlineCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={sourceOutlineCapture?.difference}
          className="md:col-span-2"
          conformanceView={conformanceView}
          height={sourceOutlineCapture?.height}
          label="Source-outline difference heatmap ×8"
          width={sourceOutlineCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
      </div>
    );
  }
  if (technique !== 'bitmap') {
    return (
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
        <PixelBytesPanel
          bytes={analyticCapture?.candidate}
          conformanceView={conformanceView}
          height={analyticCapture?.height}
          label={`${techniqueLabel(technique)} candidate`}
          width={analyticCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={analyticCapture?.reference}
          conformanceView={conformanceView}
          height={analyticCapture?.height}
          label="CPU sampling reference"
          width={analyticCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
        <PixelBytesPanel
          bytes={analyticCapture?.difference}
          className="md:col-span-2"
          conformanceView={conformanceView}
          height={analyticCapture?.height}
          label="Difference heatmap ×8"
          width={analyticCapture?.width}
          onPan={onPan}
          onZoom={onZoom}
        />
      </div>
    );
  }
  return (
    <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
      <PixelPanel
        capture={bitmapCapture}
        conformanceView={conformanceView}
        kind="candidate"
        label="Candidate"
        onPan={onPan}
        onZoom={onZoom}
      />
      <PixelPanel
        capture={bitmapCapture}
        conformanceView={conformanceView}
        kind="reference"
        label="CPU reference"
        onPan={onPan}
        onZoom={onZoom}
      />
      <PixelPanel
        capture={bitmapCapture}
        className="md:col-span-2"
        conformanceView={conformanceView}
        kind="difference"
        label="Difference ×1"
        onPan={onPan}
        onZoom={onZoom}
      />
    </div>
  );
}

function PixelBytesPanel({
  bytes,
  className = '',
  conformanceView,
  height,
  label,
  width,
  onPan,
  onZoom,
}: {
  readonly bytes: Uint8Array | undefined;
  readonly className?: string;
  readonly conformanceView: ConformanceView;
  readonly height: number | undefined;
  readonly label: string;
  readonly width: number | undefined;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const interactionRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomFromWheel = useEffectEvent((deltaY: number) => {
    const direction = deltaY < 0 ? 0.25 : -0.25;
    onZoom(Math.min(8, Math.max(1, conformanceView.zoom + direction)));
  });
  useEffect(() => {
    const interaction = interactionRef.current;
    if (interaction === null) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomFromWheel(event.deltaY);
    };
    interaction.addEventListener('wheel', handleWheel, { passive: false });
    return () => interaction.removeEventListener('wheel', handleWheel);
  }, []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || bytes === undefined || width === undefined || height === undefined) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Unable to create conformance inspection canvas');
    const pixels =
      bytes.buffer instanceof ArrayBuffer
        ? new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8ClampedArray(bytes);
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [bytes, height, width]);
  function moveView(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || conformanceView.zoom <= 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onPan((event.movementX / bounds.width) * 100, (event.movementY / bounds.height) * 100);
  }
  return (
    <figure className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-panel ${className}`}>
      <figcaption className="border-b border-border px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-muted">
        {label}
      </figcaption>
      <button
        ref={interactionRef}
        type="button"
        aria-label={`Pan and zoom ${label}`}
        className={`grid min-h-[240px] flex-1 place-items-center overflow-hidden p-3 ${conformanceView.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        data-pan-x={conformanceView.panXPercent}
        data-pan-y={conformanceView.panYPercent}
        data-zoom={conformanceView.zoom}
        style={{ touchAction: 'none' }}
        onDoubleClick={() => onZoom(conformanceView.zoom === 1 ? 2 : 1)}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={moveView}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        {bytes === undefined ? (
          <span className="font-mono text-[9px] text-dim">GENERATING</span>
        ) : (
          <canvas
            className="h-auto max-h-full w-full select-none [image-rendering:pixelated]"
            ref={canvasRef}
            style={{
              transform: `translate3d(${conformanceView.panXPercent}%, ${conformanceView.panYPercent}%, 0) scale(${conformanceView.zoom})`,
              transformOrigin: 'center',
            }}
          />
        )}
      </button>
    </figure>
  );
}

function PixelPanel({
  capture,
  className,
  conformanceView,
  kind,
  label,
  onPan,
  onZoom,
}: {
  readonly capture: BitmapTextConformanceCapture | undefined;
  readonly className?: string;
  readonly conformanceView: ConformanceView;
  readonly kind: 'candidate' | 'reference' | 'difference';
  readonly label: string;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  return (
    <PixelBytesPanel
      bytes={capture?.[kind]}
      {...(className === undefined ? {} : { className })}
      conformanceView={conformanceView}
      height={capture?.height}
      label={label}
      width={capture?.width}
      onPan={onPan}
      onZoom={onZoom}
    />
  );
}

function bitmapViewportEvidence({
  anchor,
  fontFixture,
  grid,
  layoutWidthRatio,
  presentationEvidence,
  settledRevision,
  settledTextLength,
  settledTimelineTick,
  stats,
  text,
  textAlign,
}: {
  readonly anchor: LiveTextConfiguration['anchor'];
  readonly fontFixture: BenchmarkFontFixture;
  readonly grid: boolean;
  readonly layoutWidthRatio: number;
  readonly presentationEvidence: PresentationEvidence;
  readonly settledRevision: number;
  readonly settledTextLength: number;
  readonly settledTimelineTick: number | undefined;
  readonly stats: BitmapTextLiveStats | undefined;
  readonly text: string;
  readonly textAlign: LiveTextConfiguration['textAlign'];
}): Record<`data-${string}`, string | number | boolean | undefined> {
  return {
    'data-canvas-grid': String(grid),
    'data-anchor': anchor,
    'data-layout-width': stats?.layoutWidth,
    'data-layout-width-ratio': layoutWidthRatio,
    'data-content-inset': BENCHMARK_CONTENT_INSET,
    'data-content-min-width': BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH * layoutWidthRatio,
    'data-content-policy': 'bounded-pan',
    'data-line-count': stats?.lineCount,
    'data-frame-count': stats?.frameCount,
    'data-frames-per-second': stats?.framesPerSecond,
    'data-font-fixture': fontFixture,
    'data-median-submit-ms': stats?.medianSubmitMs,
    'data-p95-submit-ms': stats?.p95SubmitMs,
    'data-gpu-frame-ms': stats?.gpuFrameMs,
    'data-median-gpu-ms': stats?.medianGpuMs,
    'data-p95-gpu-ms': stats?.p95GpuMs,
    'data-submit-history-length': stats?.submitHistoryLength,
    'data-fps-history-length': stats?.fpsHistoryLength,
    'data-glyph-count': stats?.glyphCount,
    'data-missing-glyph-count': stats?.missingGlyphCount,
    'data-draw-count': stats?.drawCount,
    'data-renderer-init-ms': stats?.rendererInitMs,
    'data-strike-ppem': stats?.strikePpem,
    'data-css-font-size': stats?.cssFontSize,
    'data-rendered-device-px': stats?.renderedPpem,
    'data-scale-ratio': stats?.scaleRatio,
    'data-font-load-ms': stats?.fontLoadMs,
    'data-text-ready-ms': stats?.textReadyMs,
    'data-first-draw-ms': stats?.firstDrawMs,
    'data-upload-frame-gpu-ms': stats?.uploadFrameGpuMs,
    'data-upload-frame-complete-ms': stats?.uploadFrameCompleteMs,
    'data-startup-ms': stats?.startupMs,
    'data-source-text-length': text.length,
    'data-text-align': textAlign,
    'data-artifact-bytes': stats?.artifactBytes,
    'data-atlas-gpu-bytes': stats?.atlasGpuBytes,
    'data-total-gpu-bytes': stats?.totalGpuBytes,
    'data-settled-revision': settledRevision,
    'data-settled-text-length': settledTextLength,
    'data-settled-tick': settledTimelineTick,
    'data-presentation-matched-glyphs': presentationEvidence.matchedGlyphs,
    'data-presentation-progress': presentationEvidence.progress,
    'data-presentation-revision': presentationEvidence.revision,
    'data-presentation-target-glyphs': presentationEvidence.targetGlyphs,
    'data-backend': stats?.backend,
    'data-dpr': stats?.dpr,
    'data-font-delivery': stats?.delivery,
    'data-core-bake-ms': stats?.coreBakeMs,
    'data-raster-bake-ms': stats?.rasterBakeMs,
    'data-source-font-bytes': stats?.sourceFontBytes,
    'data-core-artifact-bytes': stats?.coreArtifactBytes,
    'data-raster-artifact-bytes': stats?.rasterArtifactBytes,
    'data-gpu-history-length': stats?.gpuHistoryLength,
    'data-gpu-timing-supported': stats?.gpuTimingSupported,
  };
}

function BitmapTextViewport({
  backend,
  delivery,
  dpr,
  fontSize,
  grid,
  stats,
  textConfiguration,
  onStats,
}: {
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly stats: BitmapTextLiveStats | undefined;
  readonly textConfiguration: LiveTextConfiguration;
  readonly onStats: (stats: BitmapTextLiveStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<BitmapTextPreview>(undefined);
  const [settledRevision, setSettledRevision] = useState(0);
  const [settledTextLength, setSettledTextLength] = useState(0);
  const [settledTimelineTick, setSettledTimelineTick] = useState<number>();
  const [presentationEvidence, setPresentationEvidence] = useState<PresentationEvidence>({
    revision: 0,
    progress: 1,
    matchedGlyphs: 0,
    targetGlyphs: 0,
  });
  const [error, setError] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress('bitmap');
  const {
    anchor,
    animatePresentation,
    direction,
    expectedGlyphCount,
    features,
    fontFixture,
    language,
    layoutWidthRatio,
    text,
    textAlign,
    timelineTick,
  } = textConfiguration;
  const publishStats = useEffectEvent((next: BitmapTextLiveStats) => {
    finishBakeProgress();
    onStats(next);
    setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
    expectedGlyphCount,
    features,
    fontFixture,
    fontSize,
    language,
    layoutWidthRatio,
    showGrid: grid,
    text,
    textAlign,
    timelineTick,
  }));
  const publishSettledRevision = useEffectEvent((revision: number) => {
    setSettledRevision(revision);
  });
  const publishSettledTimelineTick = useEffectEvent((tick: number | undefined) => {
    setSettledTimelineTick(tick);
  });
  const publishSettledTextLength = useEffectEvent((length: number) => {
    setSettledTextLength(length);
  });
  const publishPresentation = useEffectEvent((snapshot: BitmapTextPreviewSnapshot, progress: 0 | 1) => {
    setPresentationEvidence({
      revision: snapshot.revision,
      progress,
      matchedGlyphs: snapshot.matchedGlyphs,
      targetGlyphs: snapshot.targetGlyphs,
    });
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const controller = new AbortController();
    const configuration = previewConfiguration();
    let preview: Awaited<ReturnType<(typeof import('./renderer/bitmap-text'))['createBitmapTextPreview']>> | undefined;
    let lifecycleLease: Awaited<ReturnType<typeof liveRendererLifecycle.acquire>> | undefined;
    let cancelled = false;
    const resize = (): void => {
      if (preview === undefined) return;
      preview.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const initialization = (async () => {
      lifecycleLease = await liveRendererLifecycle.acquire(controller.signal);
      try {
        if (cancelled) return;
        const { createBitmapTextPreview } = await import('./renderer/bitmap-text');
        if (cancelled) return;
        const created = await createBitmapTextPreview({
          anchor: configuration.anchor,
          backend,
          canvas,
          delivery,
          dpr,
          ...(configuration.expectedGlyphCount === undefined
            ? {}
            : { expectedGlyphCount: configuration.expectedGlyphCount }),
          fontFixture: configuration.fontFixture,
          fontSize: configuration.fontSize,
          height: Math.max(1, container.clientHeight),
          showGrid: configuration.showGrid,
          layoutWidth: benchmarkContentWidth(container.clientWidth, configuration.layoutWidthRatio),
          layoutWidthRatio: configuration.layoutWidthRatio,
          text: configuration.text,
          language: configuration.language,
          direction: configuration.direction,
          features: configuration.features,
          width: Math.max(1, container.clientWidth),
          signal: controller.signal,
          onError: publishError,
          onStats: publishStats,
          onBakeProgress: publishBakeProgress,
        });
        if (cancelled) {
          await created.dispose();
          return;
        }
        preview = created;
        previewRef.current = created;
        publishSettledTimelineTick(configuration.timelineTick);
        publishSettledTextLength(configuration.text.length);
        resize();
      } catch (caught) {
        lifecycleLease.release();
        lifecycleLease = undefined;
        throw caught;
      }
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
      void initialization.then(
        async () => {
          try {
            if (preview === undefined) return;
            const current = preview;
            preview = undefined;
            if (previewRef.current === current) previewRef.current = undefined;
            await current.dispose();
          } finally {
            lifecycleLease?.release();
            lifecycleLease = undefined;
          }
        },
        () => {
          lifecycleLease?.release();
          lifecycleLease = undefined;
        },
      );
    };
  }, [backend, delivery, dpr, publishBakeProgress]);

  useEffect(() => {
    previewRef.current?.setGridVisible(grid);
  }, [grid]);

  useEffect(() => {
    const preview = previewRef.current;
    if (preview === undefined) return;
    let cancelled = false;
    let animationFrame: number | undefined;
    const publishSettled = (snapshot: BitmapTextPreviewSnapshot): void => {
      if (cancelled) return;
      publishPresentation(snapshot, 1);
      publishSettledRevision(snapshot.revision);
      publishSettledTimelineTick(timelineTick);
      publishSettledTextLength(text.length);
    };
    void preview
      .update({
        anchor,
        fontSize,
        layoutWidthRatio,
        text,
        language,
        direction,
        features,
        textAlign,
      })
      .then((snapshot) => {
        if (cancelled) return;
        publishPresentation(snapshot, 0);
        if (!animatePresentation) {
          publishSettled(preview.finishPresentation(snapshot.revision));
          return;
        }
        const startedAt = performance.now();
        const animate = (timestamp: number): void => {
          if (cancelled) return;
          const linearProgress = Math.min(1, Math.max(0, (timestamp - startedAt) / GLYPH_POSITION_TRANSITION_MS));
          const easedProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
          const presented = preview.setPresentationProgress(snapshot.revision, easedProgress);
          if (linearProgress === 1) {
            publishSettled(presented);
            return;
          }
          animationFrame = requestAnimationFrame(animate);
        };
        animationFrame = requestAnimationFrame(animate);
      })
      .catch(publishError);
    return () => {
      cancelled = true;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    };
  }, [
    anchor,
    animatePresentation,
    direction,
    dpr,
    features,
    fontSize,
    language,
    layoutWidthRatio,
    text,
    textAlign,
    timelineTick,
  ]);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded border border-border bg-background"
      {...bitmapViewportEvidence({
        anchor,
        fontFixture,
        grid,
        layoutWidthRatio,
        presentationEvidence,
        settledRevision,
        settledTextLength,
        settledTimelineTick,
        stats,
        text,
        textAlign,
      })}
      data-testid="bitmap-live-viewport"
      ref={containerRef}
    >
      <InteractiveCanvas
        label={`Live bitmap benchmark using ${backend}`}
        canvasRef={canvasRef}
        controllerRef={previewRef}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted"
        data-testid="canvas-render-status"
      >
        <span>
          {delivery === 'runtime' ? 'RUNTIME' : 'BAKED'} {stats?.strikePpem ?? 16} PPEM · {fontSize} CSS PX /{' '}
          {stats?.renderedPpem ?? fontSize * dpr} DEVICE PX · {(stats?.scaleRatio ?? 1).toFixed(2)}×
        </span>
        <span>{dpr}× DPR</span>
      </div>
      {(stats === undefined || bakeProgressActive) && error === undefined && (
        <BakeProgressOverlay backend={backend} progress={bakeProgressValue} technique="BITMAP" />
      )}
      {error !== undefined && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

function MtsdfTextViewport({
  backend,
  delivery,
  dpr,
  fontSize,
  grid,
  stats,
  textConfiguration,
  onStats,
}: {
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly stats: MtsdfTextLiveStats | undefined;
  readonly textConfiguration: LiveTextConfiguration;
  readonly onStats: (stats: LiveTextStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<MtsdfTextPreview>(undefined);
  const [error, setError] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress('MSDF');
  const { anchor, direction, features, fontFixture, language, layoutWidthRatio, text, textAlign } = textConfiguration;
  const publishStats = useEffectEvent((next: MtsdfTextLiveStats) => {
    finishBakeProgress();
    onStats(next);
    setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
    features,
    fontSize,
    language,
    layoutWidthRatio,
    showGrid: grid,
    text,
    textAlign,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const controller = new AbortController();
    const configuration = previewConfiguration();
    let preview: MtsdfTextPreview | undefined;
    let lifecycleLease: Awaited<ReturnType<typeof liveRendererLifecycle.acquire>> | undefined;
    let cancelled = false;
    const resize = (): void => {
      if (preview === undefined) return;
      preview.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const initialization = (async () => {
      lifecycleLease = await liveRendererLifecycle.acquire(controller.signal);
      try {
        if (cancelled) return;
        const { createMtsdfTextPreview } = await import('./renderer/mtsdf-text');
        if (cancelled) return;
        const created = await createMtsdfTextPreview({
          anchor: configuration.anchor,
          backend,
          canvas,
          delivery,
          dpr,
          fontSize: configuration.fontSize,
          fontFixture,
          height: Math.max(1, container.clientHeight),
          showGrid: configuration.showGrid,
          layoutWidth: benchmarkContentWidth(container.clientWidth, configuration.layoutWidthRatio),
          layoutWidthRatio: configuration.layoutWidthRatio,
          text: configuration.text,
          textAlign: configuration.textAlign,
          language: configuration.language,
          direction: configuration.direction,
          features: configuration.features,
          width: Math.max(1, container.clientWidth),
          signal: controller.signal,
          onError: publishError,
          onStats: publishStats,
          onBakeProgress: publishBakeProgress,
        });
        if (cancelled) {
          await created.dispose();
          return;
        }
        preview = created;
        previewRef.current = created;
        resize();
      } catch (caught) {
        lifecycleLease.release();
        lifecycleLease = undefined;
        throw caught;
      }
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
      void initialization.then(
        async () => {
          try {
            if (preview === undefined) return;
            const current = preview;
            preview = undefined;
            if (previewRef.current === current) previewRef.current = undefined;
            await current.dispose();
          } finally {
            lifecycleLease?.release();
            lifecycleLease = undefined;
          }
        },
        () => {
          lifecycleLease?.release();
          lifecycleLease = undefined;
        },
      );
    };
  }, [backend, delivery, dpr, fontFixture, publishBakeProgress]);

  useEffect(() => {
    previewRef.current?.setGridVisible(grid);
  }, [grid]);

  useEffect(() => {
    const preview = previewRef.current;
    if (preview === undefined) return;
    void preview
      .update({
        anchor,
        direction,
        features,
        fontSize,
        language,
        layoutWidthRatio,
        text,
        textAlign,
      })
      .catch(publishError);
  }, [anchor, direction, dpr, features, fontSize, language, layoutWidthRatio, text, textAlign]);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded border border-border bg-background"
      data-canvas-grid={String(grid)}
      data-anchor={anchor}
      data-artifact-bytes={stats?.artifactBytes}
      data-atlas-gpu-bytes={stats?.atlasGpuBytes}
      data-backend={stats?.backend}
      data-dpr={stats?.dpr}
      data-font-delivery={stats?.delivery}
      data-core-bake-ms={stats?.coreBakeMs}
      data-raster-bake-ms={stats?.rasterBakeMs}
      data-source-font-bytes={stats?.sourceFontBytes}
      data-core-artifact-bytes={stats?.coreArtifactBytes}
      data-raster-artifact-bytes={stats?.rasterArtifactBytes}
      data-draw-count={stats?.drawCount}
      data-fps-history-length={stats?.fpsHistoryLength}
      data-frame-count={stats?.frameCount}
      data-frames-per-second={stats?.framesPerSecond}
      data-font-fixture={fontFixture}
      data-glyph-count={stats?.glyphCount}
      data-gpu-history-length={stats?.gpuHistoryLength}
      data-gpu-timing-supported={stats?.gpuTimingSupported}
      data-layout-width={stats?.layoutWidth}
      data-layout-width-ratio={layoutWidthRatio}
      data-content-inset={BENCHMARK_CONTENT_INSET}
      data-content-min-width={BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH * layoutWidthRatio}
      data-content-policy="bounded-pan"
      data-line-count={stats?.lineCount}
      data-median-gpu-ms={stats?.medianGpuMs}
      data-median-submit-ms={stats?.medianSubmitMs}
      data-missing-glyph-count={stats?.missingGlyphCount}
      data-rendered-device-px={stats?.renderedPpem}
      data-raster-em-size={stats?.rasterEmSize}
      data-raster-pixel-range={stats?.rasterPixelRange}
      data-scale-ratio={stats?.scaleRatio}
      data-startup-ms={stats?.startupMs}
      data-upload-frame-gpu-ms={stats?.uploadFrameGpuMs}
      data-upload-frame-complete-ms={stats?.uploadFrameCompleteMs}
      data-submit-history-length={stats?.submitHistoryLength}
      data-source-text-length={text.length}
      data-text-align={textAlign}
      data-timeline-tick={textConfiguration.timelineTick}
      data-testid="mtsdf-live-viewport"
      ref={containerRef}
    >
      <InteractiveCanvas
        label={`Live MSDF benchmark using ${backend}`}
        canvasRef={canvasRef}
        controllerRef={previewRef}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted"
        data-testid="canvas-render-status"
      >
        <span>
          MTSDF {stats?.rasterEmSize ?? '—'} PX/EM · {fontSize} CSS PX / {stats?.renderedPpem ?? '—'} DEVICE PX ·{' '}
          {stats?.scaleRatio.toFixed(2) ?? '—'}×
        </span>
        <span>{dpr}× DPR</span>
      </div>
      {(stats === undefined || bakeProgressActive) && error === undefined && (
        <BakeProgressOverlay backend={backend} progress={bakeProgressValue} technique="MSDF" />
      )}
      {error !== undefined && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

function SlugTextViewport({
  backend,
  delivery,
  dpr,
  fontSize,
  grid,
  stats,
  textConfiguration,
  onStats,
}: {
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly stats: SlugTextLiveStats | undefined;
  readonly textConfiguration: LiveTextConfiguration;
  readonly onStats: (stats: LiveTextStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<SlugTextPreview>(undefined);
  const [error, setError] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress('Slug');
  const { anchor, direction, features, fontFixture, language, layoutWidthRatio, text, textAlign } = textConfiguration;
  const publishStats = useEffectEvent((next: SlugTextLiveStats) => {
    finishBakeProgress();
    onStats(next);
    setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
    features,
    fontSize,
    language,
    layoutWidthRatio,
    showGrid: grid,
    text,
    textAlign,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const controller = new AbortController();
    const configuration = previewConfiguration();
    let preview: SlugTextPreview | undefined;
    let lifecycleLease: Awaited<ReturnType<typeof liveRendererLifecycle.acquire>> | undefined;
    let cancelled = false;
    const resize = (): void => {
      if (preview === undefined) return;
      preview.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const initialization = (async () => {
      lifecycleLease = await liveRendererLifecycle.acquire(controller.signal);
      try {
        if (cancelled) return;
        const { createSlugTextPreview } = await import('./renderer/slug-text');
        if (cancelled) return;
        const created = await createSlugTextPreview({
          anchor: configuration.anchor,
          backend,
          canvas,
          delivery,
          dpr,
          fontSize: configuration.fontSize,
          fontFixture,
          height: Math.max(1, container.clientHeight),
          showGrid: configuration.showGrid,
          layoutWidth: benchmarkContentWidth(container.clientWidth, configuration.layoutWidthRatio),
          layoutWidthRatio: configuration.layoutWidthRatio,
          text: configuration.text,
          textAlign: configuration.textAlign,
          language: configuration.language,
          direction: configuration.direction,
          features: configuration.features,
          width: Math.max(1, container.clientWidth),
          signal: controller.signal,
          onError: publishError,
          onStats: publishStats,
          onBakeProgress: publishBakeProgress,
        });
        if (cancelled) {
          await created.dispose();
          return;
        }
        preview = created;
        previewRef.current = created;
        resize();
      } catch (caught) {
        lifecycleLease.release();
        lifecycleLease = undefined;
        throw caught;
      }
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
      void initialization.then(
        async () => {
          try {
            if (preview === undefined) return;
            const current = preview;
            preview = undefined;
            if (previewRef.current === current) previewRef.current = undefined;
            await current.dispose();
          } finally {
            lifecycleLease?.release();
            lifecycleLease = undefined;
          }
        },
        () => {
          lifecycleLease?.release();
          lifecycleLease = undefined;
        },
      );
    };
  }, [backend, delivery, dpr, fontFixture, publishBakeProgress]);

  useEffect(() => {
    previewRef.current?.setGridVisible(grid);
  }, [grid]);

  useEffect(() => {
    const preview = previewRef.current;
    if (preview === undefined) return;
    void preview
      .update({
        anchor,
        direction,
        features,
        fontSize,
        language,
        layoutWidthRatio,
        text,
        textAlign,
      })
      .catch(publishError);
  }, [anchor, direction, dpr, features, fontSize, language, layoutWidthRatio, text, textAlign]);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded border border-border bg-background"
      data-canvas-grid={String(grid)}
      data-anchor={anchor}
      data-artifact-bytes={stats?.artifactBytes}
      data-backend={stats?.backend}
      data-dpr={stats?.dpr}
      data-font-delivery={stats?.delivery}
      data-core-bake-ms={stats?.coreBakeMs}
      data-raster-bake-ms={stats?.rasterBakeMs}
      data-source-font-bytes={stats?.sourceFontBytes}
      data-core-artifact-bytes={stats?.coreArtifactBytes}
      data-raster-artifact-bytes={stats?.rasterArtifactBytes}
      data-draw-count={stats?.drawCount}
      data-font-fixture={fontFixture}
      data-frame-count={stats?.frameCount}
      data-frames-per-second={stats?.framesPerSecond}
      data-glyph-count={stats?.glyphCount}
      data-gpu-history-length={stats?.gpuHistoryLength}
      data-gpu-timing-supported={stats?.gpuTimingSupported}
      data-layout-width={stats?.layoutWidth}
      data-layout-width-ratio={layoutWidthRatio}
      data-content-inset={BENCHMARK_CONTENT_INSET}
      data-content-min-width={BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH * layoutWidthRatio}
      data-content-policy="bounded-pan"
      data-line-count={stats?.lineCount}
      data-median-gpu-ms={stats?.medianGpuMs}
      data-median-submit-ms={stats?.medianSubmitMs}
      data-missing-glyph-count={stats?.missingGlyphCount}
      data-rendered-device-px={stats?.renderedPpem}
      data-slug-curve-gpu-bytes={stats?.slugCurveGpuBytes}
      data-slug-header-gpu-bytes={stats?.slugHeaderGpuBytes}
      data-slug-page-count={stats?.slugPageCount}
      data-slug-reference-gpu-bytes={stats?.slugReferenceGpuBytes}
      data-slug-gpu-bytes={stats?.slugGpuBytes}
      data-startup-ms={stats?.startupMs}
      data-upload-frame-gpu-ms={stats?.uploadFrameGpuMs}
      data-upload-frame-complete-ms={stats?.uploadFrameCompleteMs}
      data-submit-history-length={stats?.submitHistoryLength}
      data-source-text-length={text.length}
      data-text-align={textAlign}
      data-timeline-tick={textConfiguration.timelineTick}
      data-testid="slug-live-viewport"
      ref={containerRef}
    >
      <InteractiveCanvas
        label={`Live Slug benchmark using ${backend}`}
        canvasRef={canvasRef}
        controllerRef={previewRef}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted"
        data-testid="canvas-render-status"
      >
        <span>
          SLUG ANALYTIC · {stats?.slugPageCount ?? '—'} PAGE
          {stats?.slugPageCount === 1 ? '' : 'S'} · {fontSize} CSS PX / {stats?.renderedPpem ?? '—'} DEVICE PX
        </span>
        <span>{dpr}× DPR</span>
      </div>
      {(stats === undefined || bakeProgressActive) && error === undefined && (
        <BakeProgressOverlay backend={backend} progress={bakeProgressValue} technique="SLUG" />
      )}
      {error !== undefined && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

function comparisonViewportEvidence({
  grid,
  layoutWidthRatio,
  stats,
  technique,
  workload,
  workloadFonts,
}: {
  readonly grid: boolean;
  readonly layoutWidthRatio: number;
  readonly stats: ComparisonWorkloadStats | undefined;
  readonly technique: RasterTechnique;
  readonly workload: ComparisonWorkloadId;
  readonly workloadFonts: ReturnType<typeof liveWorkloadFontFixtures>;
}): Record<`data-${string}`, string | number | boolean | undefined> {
  const iconStats = stats?.workload === 'icon-grid' ? stats : undefined;
  const paintStats = stats?.workload === 'paint-effects' ? stats : undefined;
  const zoomStats = stats?.workload === 'zoom-text' ? stats : undefined;
  const animatedStats =
    stats?.workload === 'dynamic-layout' || stats?.workload === 'paint-effects' || stats?.workload === 'zoom-text'
      ? stats
      : undefined;
  return {
    'data-canvas-grid': String(grid),
    'data-artifact-bytes': stats?.artifactBytes,
    'data-atlas-gpu-bytes': stats?.atlasGpuBytes,
    'data-backend': stats?.backend,
    'data-dpr': stats?.dpr,
    'data-font-delivery': stats?.delivery,
    'data-core-bake-ms': stats?.coreBakeMs,
    'data-raster-bake-ms': stats?.rasterBakeMs,
    'data-source-font-bytes': stats?.sourceFontBytes,
    'data-core-artifact-bytes': stats?.coreArtifactBytes,
    'data-raster-artifact-bytes': stats?.rasterArtifactBytes,
    'data-draw-count': stats?.drawCount,
    'data-first-draw-ms': stats?.firstDrawMs,
    'data-font-fixture': workloadFonts.primary,
    'data-label-font-fixture': workloadFonts.kind === 'icon-grid' ? workloadFonts.labels : undefined,
    'data-font-load-ms': stats?.fontLoadMs,
    'data-frames-per-second': stats?.framesPerSecond,
    'data-glyph-count': stats?.glyphCount,
    'data-gpu-history-length': stats?.gpuHistoryLength,
    'data-gpu-timing-supported': stats?.gpuTimingSupported,
    'data-layout-width': stats?.layoutWidth,
    'data-content-inset': BENCHMARK_CONTENT_INSET,
    'data-content-min-width':
      workload === 'text-ladder' || workload === 'icon-grid' || workload === 'zoom-text'
        ? undefined
        : (workload === 'dynamic-layout' ? 1_000 : BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH) * layoutWidthRatio,
    'data-content-policy':
      workload === 'text-ladder' || workload === 'icon-grid' ? 'pan' : workload === 'zoom-text' ? 'fit' : 'bounded-pan',
    'data-icon-item-count': iconStats?.iconItemCount,
    'data-icon-label-count': iconStats?.iconLabelCount,
    'data-icon-column-count': iconStats?.iconColumnCount,
    'data-icon-row-count': iconStats?.iconRowCount,
    'data-icon-size': iconStats?.appliedFontSize,
    'data-icon-grid-width': iconStats?.iconGridWidth,
    'data-icon-grid-height': iconStats?.iconGridHeight,
    'data-icon-label-size': iconStats?.iconLabelSize,
    'data-icon-pool-capacity': iconStats?.iconPoolCapacity,
    'data-icon-assigned-count': iconStats?.iconAssignedCount,
    'data-icon-render-visible-count': iconStats?.iconRenderVisibleCount,
    'data-icon-assignment-signature': iconStats?.iconAssignmentSignature,
    'data-icon-first-visible-index': iconStats?.iconFirstVisibleIndex,
    'data-icon-last-visible-index': iconStats?.iconLastVisibleIndex,
    'data-icon-recycle-count': iconStats?.iconRecycleCount,
    'data-icon-window-revision': iconStats?.iconWindowRevision,
    'data-icon-overscan-rows': iconStats?.iconOverscanRows,
    'data-icon-overscan-columns': iconStats?.iconOverscanColumns,
    'data-icon-scroll-x': iconStats?.iconScrollX,
    'data-icon-scroll-y': iconStats?.iconScrollY,
    'data-icon-maximum-scroll-x': iconStats?.iconMaximumScrollX,
    'data-icon-maximum-scroll-y': iconStats?.iconMaximumScrollY,
    'data-line-count': stats?.lineCount,
    'data-median-gpu-ms': stats?.medianGpuMs,
    'data-median-submit-ms': stats?.medianSubmitMs,
    'data-missing-glyph-count': stats?.missingGlyphCount,
    'data-p95-gpu-ms': stats?.p95GpuMs,
    'data-p95-submit-ms': stats?.p95SubmitMs,
    'data-renderer-init-ms': stats?.rendererInitMs,
    'data-configuration-revision': stats?.configurationRevision,
    'data-paint-opacity': paintStats?.appliedPaintOpacity,
    'data-paint-shadow-enabled': paintStats === undefined ? undefined : String(paintStats.appliedPaintShadowEnabled),
    'data-paint-stroke-width': paintStats?.appliedPaintStrokeWidth,
    'data-paint-revision': paintStats?.paintRevision,
    'data-paint-update-ms': paintStats?.lastPaintUpdateMs,
    'data-presentation-pending': stats !== undefined && (stats.technique !== technique || stats.workload !== workload),
    'data-layout-bounds-visible':
      stats?.workload === 'dynamic-layout' ? String(stats.appliedShowLayoutBounds) : undefined,
    'data-reflow-count': stats?.reflowCount,
    'data-reflow-ms': stats?.lastReflowMs,
    'data-rendered-device-px': stats?.renderedPpem,
    'data-raster-em-size': stats?.technique === 'mtsdf' ? stats.rasterEmSize : undefined,
    'data-raster-pixel-range': stats?.technique === 'mtsdf' ? stats.rasterPixelRange : undefined,
    'data-scale-ratio': stats?.technique === 'slug' ? undefined : stats?.scaleRatio,
    'data-slug-curve-gpu-bytes': stats?.technique === 'slug' ? stats.slugCurveGpuBytes : undefined,
    'data-slug-header-gpu-bytes': stats?.technique === 'slug' ? stats.slugHeaderGpuBytes : undefined,
    'data-slug-page-count': stats?.technique === 'slug' ? stats.slugPageCount : undefined,
    'data-slug-reference-gpu-bytes': stats?.technique === 'slug' ? stats.slugReferenceGpuBytes : undefined,
    'data-slug-gpu-bytes': stats?.technique === 'slug' ? stats.slugGpuBytes : undefined,
    'data-startup-ms': stats?.startupMs,
    'data-source-text-length': stats?.sourceTextLength,
    'data-submit-history-length': stats?.submitHistoryLength,
    'data-text-ready-ms': stats?.textReadyMs,
    'data-text-update-sample-count': stats?.textUpdateTimings.sampleCount,
    'data-technique': technique,
    'data-total-gpu-bytes': stats?.totalGpuBytes,
    'data-upload-frame-gpu-ms': stats?.uploadFrameGpuMs,
    'data-upload-frame-complete-ms': stats?.uploadFrameCompleteMs,
    'data-workload': stats?.workload,
    'data-zoom-text': zoomStats?.zoomText,
    'data-zoom-language': zoomStats?.zoomLanguage,
    'data-zoom-phrase-index': zoomStats?.zoomPhraseIndex,
    'data-zoom-phrase-revision': zoomStats?.zoomPhraseRevision,
    'data-zoom-base-css-px': zoomStats?.zoomBaseCssPx,
    'data-zoom-effective-css-px': zoomStats?.zoomEffectiveCssPx,
    'data-zoom-maximum-css-px': zoomStats?.zoomMaximumCssPx,
    'data-zoom-scale': zoomStats?.zoomScale,
    'data-zoom-maximum-scale': zoomStats?.zoomMaximumScale,
    'data-workload-amount':
      stats === undefined || workloadAmountLabel(stats.workload, stats.appliedAmount) === undefined
        ? undefined
        : stats.appliedAmount,
    'data-animation-enabled': animatedStats === undefined ? undefined : String(animatedStats.appliedAnimationEnabled),
    'data-animation-speed': animatedStats?.appliedAnimationSpeed,
  };
}

function ComparisonWorkloadViewport({
  amount,
  animationEnabled,
  animationSpeed,
  backend,
  delivery,
  dpr,
  fontFixture,
  fontSize,
  grid,
  layoutWidthRatio,
  paintOpacity,
  paintShadowEnabled,
  paintStrokeWidth,
  showLayoutBounds,
  stats,
  technique,
  workload,
  onStats,
}: {
  readonly amount: number;
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontFixture: BenchmarkFontFixture;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly layoutWidthRatio: number;
  readonly paintOpacity: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokeWidth: number;
  readonly showLayoutBounds: boolean;
  readonly stats: ComparisonWorkloadStats | undefined;
  readonly technique: RasterTechnique;
  readonly workload: ComparisonWorkloadId;
  readonly onStats: (stats: LiveTextStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ComparisonWorkloadPreview>(undefined);
  const surfaceKey = `${backend}:${delivery}:${String(dpr)}:${fontFixture}:${technique}:${workload}`;
  const workloadFonts = liveWorkloadFontFixtures(workload, fontFixture);
  const [error, setError] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress(techniqueLabel(technique));
  const publishStats = useEffectEvent((key: string, next: ComparisonWorkloadStats) => {
    if (key !== surfaceKey) return;
    finishBakeProgress();
    onStats(next);
    setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const currentConfiguration = useEffectEvent(() => ({
    amount,
    animationEnabled,
    animationSpeed,
    fontFixture,
    fontSize,
    layoutWidthRatio,
    paintOpacity,
    paintShadowEnabled,
    paintStrokeWidth,
    showGrid: grid,
    showLayoutBounds,
    workload,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const controller = new AbortController();
    const effectSurfaceKey = surfaceKey;
    let preview: ComparisonWorkloadPreview | undefined;
    let lifecycleLease: Awaited<ReturnType<typeof liveRendererLifecycle.acquire>> | undefined;
    let cancelled = false;
    const resize = (): void => {
      if (preview === undefined) return;
      preview.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const initialization = (async () => {
      lifecycleLease = await liveRendererLifecycle.acquire(controller.signal);
      try {
        if (cancelled) return;
        const { createComparisonWorkloadPreview } = await preloadComparisonWorkload();
        if (cancelled) return;
        const configuration = currentConfiguration();
        const created = await createComparisonWorkloadPreview({
          ...configuration,
          backend,
          canvas,
          delivery,
          dpr,
          height: Math.max(1, container.clientHeight),
          signal: controller.signal,
          technique,
          width: Math.max(1, container.clientWidth),
          onError: publishError,
          onStats: (next) => publishStats(effectSurfaceKey, next),
          onBakeProgress: publishBakeProgress,
        });
        if (cancelled) {
          await created.dispose();
          return;
        }
        preview = created;
        previewRef.current = created;
        resize();
      } catch (caught) {
        lifecycleLease.release();
        lifecycleLease = undefined;
        throw caught;
      }
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
      void initialization.then(
        async () => {
          try {
            if (preview === undefined) return;
            const current = preview;
            preview = undefined;
            if (previewRef.current === current) previewRef.current = undefined;
            await current.dispose();
          } finally {
            lifecycleLease?.release();
            lifecycleLease = undefined;
          }
        },
        () => {
          lifecycleLease?.release();
          lifecycleLease = undefined;
        },
      );
    };
  }, [backend, delivery, dpr, fontFixture, publishBakeProgress, surfaceKey, technique, workload]);

  useEffect(() => {
    const preview = previewRef.current;
    if (preview === undefined) return;
    void preview.update(currentConfiguration()).catch(publishError);
  }, [
    amount,
    animationEnabled,
    animationSpeed,
    dpr,
    fontFixture,
    fontSize,
    layoutWidthRatio,
    paintOpacity,
    paintShadowEnabled,
    paintStrokeWidth,
    grid,
    showLayoutBounds,
    workload,
  ]);

  const rangeLabel =
    workload === 'text-ladder'
      ? '8–1024 CSS PX'
      : workload === 'zoom-text'
        ? '8 PT · 10.67 CSS PX → VIEWPORT FIT'
        : workload === 'icon-grid'
          ? `${fontSize} CSS PX ICONS`
          : `${fontSize} CSS PX`;
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded border border-border bg-background"
      {...comparisonViewportEvidence({ grid, stats, technique, workload, workloadFonts, layoutWidthRatio })}
      data-testid="comparison-live-viewport"
      ref={containerRef}
    >
      <InteractiveCanvas
        label={`Live ${techniqueLabel(technique)} ${workload} benchmark using ${backend}`}
        canvasRef={canvasRef}
        controllerRef={previewRef}
        pan={workload !== 'zoom-text'}
        zoom={workload === 'off-axis-3d'}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted"
        data-testid="canvas-render-status"
      >
        <span>
          {stats?.technique === 'mtsdf'
            ? `MTSDF ${String(stats.rasterEmSize)} PX/EM`
            : stats?.technique === 'slug'
              ? `SLUG ANALYTIC · ${String(stats.slugPageCount)} PAGE${stats.slugPageCount === 1 ? '' : 'S'}`
              : stats?.technique === 'bitmap'
                ? `BITMAP ${String(stats.strikePpem)} PX STRIKE`
                : technique === 'mtsdf'
                  ? 'MTSDF — PX/EM'
                  : technique === 'slug'
                    ? 'SLUG ANALYTIC · — PAGES'
                    : 'BITMAP — PX STRIKE'}{' '}
          · {rangeLabel}
        </span>
      </div>
      <div
        className="pointer-events-none absolute bottom-0 left-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 font-mono text-[9px] text-muted"
        data-testid="canvas-navigation-status"
      >
        {workload === 'off-axis-3d' ? 'PAN · PINCH/WHEEL ZOOM' : workload === 'zoom-text' ? 'AUTO FIT' : 'PAN'} · {dpr}×
        DPR
      </div>
      {(stats === undefined || bakeProgressActive) && error === undefined && (
        <BakeProgressOverlay
          backend={backend}
          progress={bakeProgressValue}
          technique={technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'SLUG' : 'BITMAP'}
        />
      )}
      {error !== undefined && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

function useBakeProgress(label: string): {
  readonly value: BakeProgress | undefined;
  readonly active: boolean;
  readonly publish: (progress: BakeProgress) => void;
  readonly finish: () => void;
} {
  const [value, setValue] = useState<BakeProgress>();
  const [active, setActive] = useState(false);
  const lastConsoleKey = useRef('');
  const publish = useCallback(
    (progress: BakeProgress) => {
      setValue(progress);
      setActive(true);
      if (!import.meta.env.DEV) return;
      const percentage = Math.round((progress.completed / progress.total) * 100);
      const bucket = Math.floor(percentage / 10) * 10;
      const key = `${progress.stage}:${progress.phase}:${String(bucket)}`;
      if (key === lastConsoleKey.current) return;
      lastConsoleKey.current = key;
      console.info(`[pmndrs/text] ${label} ${progress.stage} bake: ${progress.phase} ${String(percentage)}%`);
    },
    [label],
  );
  const finish = useCallback(() => setActive(false), []);
  return { value, active, publish, finish };
}

function BakeProgressOverlay({
  backend,
  progress,
  technique,
}: {
  readonly backend: GraphicsBackend;
  readonly progress: BakeProgress | undefined;
  readonly technique: 'BITMAP' | 'MSDF' | 'SLUG';
}) {
  const percentage = bakeProgressPercentage(progress);
  const label =
    progress === undefined
      ? `INITIALIZING ${technique} ${backend.toUpperCase()}`
      : `${progress.stage === 'font' ? 'FONT' : technique} ${progress.phase.toUpperCase()}`;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-background px-8">
      <div className="w-full max-w-sm" data-testid="bake-progress">
        <div className="mb-2 flex items-center justify-between font-mono text-[9px] text-dim">
          <span>{label}</span>
          <span>{percentage}%</span>
        </div>
        <progress
          aria-label={label}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface accent-accent"
          max={100}
          value={percentage}
        />
      </div>
    </div>
  );
}

function bakeProgressPercentage(progress: BakeProgress | undefined): number {
  if (progress === undefined) return 0;
  const ratio = progress.completed / progress.total;
  if (progress.stage === 'font') {
    if (progress.phase === 'loading') return 2;
    if (progress.phase === 'baking') return 8;
    if (progress.phase === 'packaging') return 16;
    if (progress.phase === 'transferring') return 19;
    if (progress.phase === 'complete') return 20;
    return Math.round(ratio * 20);
  }
  if (progress.phase === 'loading') return 22;
  if (progress.phase === 'rasterizing') return 25 + Math.round(ratio * 65);
  if (progress.phase === 'packaging') return 92;
  if (progress.phase === 'transferring') return 97;
  if (progress.phase === 'complete') return 100;
  return 20;
}
