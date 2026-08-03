import {
  Activity,
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  advanceAdvancedShapingByTime,
  advancedShapingCase,
  advancedShapingFrame,
  initialAdvancedShapingState,
  updateAdvancedShaping,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
} from './workloads/advanced-shaping';
import type { BenchmarkSummary, RunnerEvent } from './benchmark/contracts';
import { environmentResource } from './benchmark/environment';
import { runRegisteredBenchmark } from './benchmark/execution';
import {
  defaultRuntimeFontSizeForWorkload,
  resetRuntimeControlsForWorkload,
  RuntimeLayoutControls,
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
import {
  adjacentPresentationWorkload,
  presentationFrame,
  type PresentationPreset,
  type PresentationWorkload,
} from './benchmark/presentation-sequence';
import {
  setParagraphStressMotionFrame,
  type MutableParagraphStressMotionFrame,
} from './benchmark/paragraph-stress-motion';
import {
  liveWorkloadFontFixtures,
  rasterConformanceSpecimen,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from './benchmark/font-fixtures';
import {
  readHarnessLocation,
  writeHarnessUrl,
  type FontDelivery,
  type GraphicsBackend,
  type HarnessLayout,
  type HarnessLocation,
  type HarnessMode,
  type RasterTechnique,
} from './benchmark/url-state';
import type { ConformanceView } from './components/render-controls';
import { HarnessLayout as HarnessAppLayout, type HarnessLayoutProps } from './components/harness-layout';
import { RuntimeControls } from './components/runtime-controls';
import {
  workloadById,
  isConformanceWorkloadId,
  type ConformanceWorkloadId,
  type WorkloadOption,
} from './benchmark/workloads';
import { Chip } from './components/ui';
import type { PersistentRenderJob } from './renderer/persistent-render-host';
import type {
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadId,
  ComparisonWorkloadPersistentScene,
  ComparisonWorkloadStats,
} from './workloads/comparison/scene';
import {
  benchmarkWorkloadDefinition,
  comparisonWorkloadId,
  isBenchmarkWorkloadId,
  type BenchmarkWorkloadId,
} from './workloads/catalog';
import { BENCHMARK_CONTENT_INSET, BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH } from './workloads/shared/text-style';
import type { LiveTextScene } from './workloads/live-text-scene';
import { liveTextSceneForWorkload } from './workloads/live-text-scenes';
import { PersistentRenderHostProvider, usePersistentRenderHost } from './renderer/persistent-render-host-context';
import { ConformanceSurface } from './surfaces/conformance/conformance-surface';
import { BakeProgressOverlay, useBakeProgress } from './surfaces/benchmark/bake-progress-overlay';
import { BitmapTextViewport } from './surfaces/benchmark/bitmap-text-viewport';
import { MtsdfTextViewport, SlugTextViewport } from './surfaces/benchmark/sdf-text-viewports';
import type { LiveTextConfiguration } from './surfaces/benchmark/live-text-viewport-contracts';
import { LiveBenchmarkSurface } from './surfaces/benchmark/live-benchmark-surface';
import { Route, Switch, useLocation } from 'wouter';

type LiveTextStats = RuntimeLiveStats;
type RunExclusiveJob = <T>(job: PersistentRenderJob<T>, signal?: AbortSignal) => Promise<Awaited<T>>;

let comparisonWorkloadModule: ReturnType<typeof importComparisonWorkload> | undefined;
const liveSceneAssetResources = new Map<string, Promise<void>>();

function importComparisonWorkload() {
  return import('./workloads/comparison/scene');
}

function loadBenchmarkFontAssets() {
  return import('./workloads/font-assets');
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

const PRESENTATION_FONT_FIXTURES = [
  'inter',
  'font-awesome-free-6.7.2',
  'amiri',
  'noto-sans-devanagari',
  'noto-sans-cjk-showcase',
] as const satisfies readonly BenchmarkFontFixture[];

async function preloadPresentationAssets(
  technique: RasterTechnique,
  delivery: FontDelivery,
  selectedFont: BenchmarkFontFixture,
  signal: AbortSignal,
): Promise<void> {
  if (delivery !== 'baked') return;
  const fixtures = Array.from(new Set<BenchmarkFontFixture>([selectedFont, ...PRESENTATION_FONT_FIXTURES]));
  const { preloadBenchmarkFontAssets } = await loadBenchmarkFontAssets();
  await preloadBenchmarkFontAssets({ technique, fixtures, signal, bitmapDensity: 'live' });
}

function liveSceneAssetResource(
  technique: RasterTechnique,
  delivery: FontDelivery,
  fontFixture: BenchmarkFontFixture,
  workload: HarnessLocation['workload'],
): Promise<void> {
  const definition = isBenchmarkWorkloadId(workload) ? benchmarkWorkloadDefinition(workload) : undefined;
  const fixtures =
    definition?.fontPolicy.kind === 'icon-grid' ? [fontFixture, definition.fontPolicy.iconFixture] : [fontFixture];
  const comparison = definition?.surface === 'comparison';
  const key = `${technique}:${delivery}:${fixtures.join(',')}:${String(comparison)}`;
  const existing = liveSceneAssetResources.get(key);
  if (existing !== undefined) return existing;
  const resource = (async () => {
    if (comparison) await preloadComparisonWorkload();
    if (delivery !== 'baked') return;
    const { preloadBenchmarkFontAssets } = await loadBenchmarkFontAssets();
    await preloadBenchmarkFontAssets({ technique, fixtures, bitmapDensity: 'live' });
  })();
  liveSceneAssetResources.set(key, resource);
  void resource.catch(() => liveSceneAssetResources.delete(key));
  return resource;
}

interface ActivityWorkloads {
  readonly benchmark: BenchmarkWorkloadId;
  readonly conformance: ConformanceWorkloadId;
}

const INITIAL_CONFORMANCE_VIEW: ConformanceView = {
  zoom: 1,
  panXPercent: 0,
  panYPercent: 0,
};

function techniqueLabel(technique: RasterTechnique): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

function isComparisonWorkloadStats(stats: LiveTextStats | undefined): stats is ComparisonWorkloadStats {
  return stats !== undefined && 'workload' in stats;
}

function workloadAmountLabel(workload: BenchmarkWorkloadId, amount: number): string | undefined {
  const range = benchmarkWorkloadDefinition(workload).controls.amount;
  return range === undefined ? undefined : `${range.label} · ${amount}%`;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`;
}

function ShellFallback() {
  return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted">Loading harness…</div>;
}

function SceneSuspenseFallback({ technique }: { readonly technique: RasterTechnique }) {
  return (
    <div
      className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-background"
      data-testid="scene-loading"
    >
      <div className="rounded-md border border-border bg-black/80 px-4 py-3 font-mono text-[10px] text-muted">
        Loading {techniqueLabel(technique)} scene…
      </div>
    </div>
  );
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
      <Switch>
        <Route path="/presentation">
          <Harness layout="presentation" />
        </Route>
        <Route>
          <Harness layout="main" />
        </Route>
      </Switch>
    </Suspense>
  );
}

function Harness({ layout }: { readonly layout: HarnessLayout }) {
  return (
    <RuntimeWorldProvider>
      <HarnessApplication layout={layout} />
    </RuntimeWorldProvider>
  );
}

function HarnessApplication({ layout }: { readonly layout: HarnessLayout }) {
  return useHarnessController(layout);
}

function useHarnessController(routeLayout: HarnessLayout): ReactNode {
  const [, navigate] = useLocation();
  const environment = use(environmentResource());
  const runtimeWorld = useRuntimeWorld();
  const presentationAnimation = useRuntimeAnimationControls();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => true);
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
  const [location, setLocationState] = useState(() => {
    const value = readHarnessLocation(locationSearch(), defaultDeviceDpr(), routeLayout);
    if (!environment.webgpu && !new URLSearchParams(locationSearch()).has('backend')) {
      return { ...value, backend: 'webgl2' as const };
    }
    return value;
  });
  const [activityWorkloads, setActivityWorkloads] = useState<ActivityWorkloads>(() => {
    const initial = readHarnessLocation(locationSearch(), defaultDeviceDpr(), routeLayout);
    return {
      benchmark:
        initial.mode === 'benchmark' && isBenchmarkWorkloadId(initial.workload) ? initial.workload : 'benchmark-ipsum',
      conformance:
        initial.mode === 'conformance' && isConformanceWorkloadId(initial.workload)
          ? initial.workload
          : 'text-accuracy',
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
  const [advancedFontFixture, setAdvancedFontFixture] = useState<BenchmarkFontFixture>('noto-sans-cjk-showcase');
  const [workloadPanelOpen, setWorkloadPanelOpen] = useState(() => desktopSnapshot());
  const [fontNoticesOpen, setFontNoticesOpen] = useState(false);
  const [presentationPlaying, setPresentationPlaying] = useState(false);
  const [presentationPreset, setPresentationPreset] = useState<PresentationPreset>();
  const [isPending, startTransition] = useTransition();
  const reportCaptureRequested = useRef(false);
  const conformanceRunRevision = useRef(0);
  const conformanceRunController = useRef<AbortController | undefined>(undefined);
  const committedLocationRef = useRef(location);
  const requestedLocationRef = useRef(location);
  const locationRequestRevisionRef = useRef(0);
  const presentationPlayback = useRef<
    | {
        preset: PresentationPreset | undefined;
        readonly startedAt: number;
        readonly startWorkload: PresentationWorkload;
        workload: PresentationWorkload;
      }
    | undefined
  >(undefined);
  const paragraphStressMotionScratch = useRef<MutableParagraphStressMotionFrame>({
    fontSize: 0,
    layoutWidthPercent: 0,
    scrollProgress: 0,
  });

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
  const presentationMode = location.layout === 'presentation' && location.mode === 'benchmark';

  useEffect(() => {
    if (!presentationMode) return;
    const controller = new AbortController();
    let started = false;
    const preload = (): void => {
      started = true;
      void preloadPresentationAssets(location.technique, location.delivery, fontFixture, controller.signal).catch(
        (caught: unknown) => {
          if (!(caught instanceof DOMException && caught.name === 'AbortError')) console.warn(caught);
        },
      );
    };
    if (globalThis.requestIdleCallback === undefined) {
      preload();
      return () => {
        if (!started) controller.abort();
      };
    }
    const request = globalThis.requestIdleCallback(preload);
    return () => {
      globalThis.cancelIdleCallback(request);
      if (!started) controller.abort();
    };
  }, [fontFixture, location.delivery, location.technique, presentationMode]);

  const animateParagraphStressControls = useEffectEvent((elapsedMs: number) => {
    const startFontSize = defaultRuntimeFontSizeForWorkload('paragraph-stress', location.layout);
    const frame = paragraphStressMotionScratch.current;
    setParagraphStressMotionFrame(frame, elapsedMs, presentationAnimation.animationSpeed, startFontSize);
    const { fontSize, layoutWidthPercent } = frame;
    const current = runtimeWorld.get(RuntimeLayoutControls);
    if (current?.fontSize === fontSize && current.layoutWidthPercent === layoutWidthPercent) return;
    runtimeWorld.set(RuntimeLayoutControls, { fontSize, layoutWidthPercent, workloadAmount: 100 });
  });
  useEffect(() => {
    if (
      location.mode !== 'benchmark' ||
      location.workload !== 'paragraph-stress' ||
      !presentationAnimation.animationEnabled
    ) {
      return;
    }
    let animationFrame = 0;
    let active = true;
    const startedAt = performance.now();
    const animate = (): void => {
      if (!active) return;
      if (requestedLocationRef.current.workload === 'paragraph-stress') {
        animateParagraphStressControls(Math.max(0, performance.now() - startedAt));
      }
      if (active) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
    };
  }, [location.mode, location.workload, presentationAnimation.animationEnabled, presentationAnimation.animationSpeed]);

  function setLocation(next: Partial<HarnessLocation>): void {
    if (presentationPlayback.current === undefined && next.workload !== undefined) setPresentationPreset(undefined);
    const previous = requestedLocationRef.current;
    const value = { ...previous, ...next };
    const requestRevision = ++locationRequestRevisionRef.current;
    requestedLocationRef.current = value;
    const updatesRuntimeDefaults =
      (next.workload !== undefined && next.workload !== previous.workload) ||
      (next.layout !== undefined && next.layout !== previous.layout);
    const replacesLiveSurface =
      next.mode !== undefined ||
      next.technique !== undefined ||
      next.backend !== undefined ||
      next.delivery !== undefined ||
      next.dpr !== undefined ||
      next.workload !== undefined;
    const replacesRendererGeneration = next.mode !== undefined || next.backend !== undefined;
    if (replacesRendererGeneration) runtimeWorld.set(RuntimeTelemetry, { stats: undefined });
    if (replacesLiveSurface || next.fontFixture !== undefined) {
      conformanceRunController.current?.abort(new DOMException('conformance run was superseded', 'AbortError'));
      conformanceRunController.current = undefined;
      conformanceRunRevision.current += 1;
      setSummary(undefined);
      setEvent(undefined);
      setLiveCapture(undefined);
    }
    const commitLocation = (): void => {
      if (requestRevision !== locationRequestRevisionRef.current) return;
      if (next.workload !== undefined) {
        setActivityWorkloads((current) => ({ ...current, [value.mode]: value.workload }));
      }
      committedLocationRef.current = value;
      setLocationState(value);
      if (value.layout === previous.layout) {
        globalThis.history?.replaceState(null, '', writeHarnessUrl(value));
      } else {
        navigate(writeHarnessUrl(value));
      }
    };
    const transitionsScene =
      (next.technique !== undefined && next.technique !== previous.technique) ||
      (next.workload !== undefined && next.workload !== previous.workload) ||
      (next.fontFixture !== undefined && next.fontFixture !== previous.fontFixture) ||
      (next.delivery !== undefined && next.delivery !== previous.delivery);
    const applyRuntimeDefaults = (): void => {
      if (!updatesRuntimeDefaults) return;
      resetRuntimeControlsForWorkload(runtimeWorld, value.workload, value.layout);
    };
    if (transitionsScene) {
      startTransition(() => {
        void liveSceneAssetResource(value.technique, value.delivery, value.fontFixture, value.workload).then(
          () => {
            // React does not preserve the transition marker across an await yet. Mark the committed scene update as a
            // transition as well, so a newly observed resource can suspend without replacing the currently visible scene.
            startTransition(() => {
              applyRuntimeDefaults();
              commitLocation();
            });
          },
          (caught: unknown) => {
            if (requestRevision !== locationRequestRevisionRef.current) return;
            requestedLocationRef.current = committedLocationRef.current;
            setError(caught instanceof Error ? caught.message : String(caught));
          },
        );
      });
    } else {
      applyRuntimeDefaults();
      commitLocation();
    }
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

  const stopPresentation = useEffectEvent(() => {
    presentationPlayback.current = undefined;
    setPresentationPlaying(false);
  });
  const navigatePresentation = useEffectEvent((direction: -1 | 1) => {
    stopPresentation();
    setLocation({
      mode: 'benchmark',
      view: 'scene',
      workload: adjacentPresentationWorkload(location.workload, direction),
    });
  });
  const togglePresentation = useEffectEvent(() => {
    if (presentationPlayback.current !== undefined) {
      stopPresentation();
      return;
    }
    const startFrame = presentationFrame(location.workload, 0);
    const startWorkload = startFrame.workload;
    presentationPlayback.current = {
      preset: startFrame.preset,
      startedAt: performance.now(),
      startWorkload,
      workload: startWorkload,
    };
    if (startWorkload === 'advanced-shaping') {
      const initial = initialAdvancedShapingState();
      setShowcaseState(initial);
      setAdvancedFontFixture(advancedShapingCase(initial.caseId).fontFixture);
    }
    setPresentationPreset(startFrame.preset);
    setPresentationPlaying(true);
    if (location.mode !== 'benchmark' || location.workload !== startWorkload) {
      setLocation({ mode: 'benchmark', view: 'scene', workload: startWorkload });
    }
  });
  const advancePresentation = useEffectEvent((timestamp: number) => {
    const playback = presentationPlayback.current;
    if (playback === undefined) return;
    const frame = presentationFrame(playback.startWorkload, timestamp - playback.startedAt);
    if (frame.workload !== playback.workload) {
      playback.workload = frame.workload;
      if (frame.workload === 'advanced-shaping') {
        const initial = initialAdvancedShapingState();
        setShowcaseState(initial);
        setAdvancedFontFixture(advancedShapingCase(initial.caseId).fontFixture);
      }
    }
    if (frame.preset !== playback.preset) {
      playback.preset = frame.preset;
      setPresentationPreset(frame.preset);
    }
    const requestedLocation = requestedLocationRef.current;
    if (frame.workload !== requestedLocation.workload || requestedLocation.mode !== 'benchmark') {
      setLocation({ mode: 'benchmark', view: 'scene', workload: frame.workload });
    }
    if (frame.complete) stopPresentation();
  });
  useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent): void => {
      const requestedLocation = requestedLocationRef.current;
      if (requestedLocation.layout !== 'presentation' || requestedLocation.mode !== 'benchmark') return;
      if (keyboardEvent.code === 'Space' && !isPresentationTextEntryTarget(keyboardEvent.target)) {
        keyboardEvent.preventDefault();
        keyboardEvent.stopImmediatePropagation();
        if (!keyboardEvent.repeat) togglePresentation();
        return;
      }
      if (keyboardEvent.repeat || isPresentationShortcutTarget(keyboardEvent.target)) return;
      if (keyboardEvent.key === 'ArrowLeft') {
        keyboardEvent.preventDefault();
        navigatePresentation(-1);
      } else if (keyboardEvent.key === 'ArrowRight') {
        keyboardEvent.preventDefault();
        navigatePresentation(1);
      }
    };
    const onKeyUp = (keyboardEvent: KeyboardEvent): void => {
      const requestedLocation = requestedLocationRef.current;
      if (
        requestedLocation.layout !== 'presentation' ||
        requestedLocation.mode !== 'benchmark' ||
        keyboardEvent.code !== 'Space' ||
        isPresentationTextEntryTarget(keyboardEvent.target)
      ) {
        return;
      }
      keyboardEvent.preventDefault();
      keyboardEvent.stopImmediatePropagation();
    };
    globalThis.addEventListener?.('keydown', onKeyDown, true);
    globalThis.addEventListener?.('keyup', onKeyUp, true);
    return () => {
      globalThis.removeEventListener?.('keydown', onKeyDown, true);
      globalThis.removeEventListener?.('keyup', onKeyUp, true);
    };
  }, []);
  useEffect(() => {
    if (!presentationPlaying) return;
    let animationFrame = 0;
    const animate = (timestamp: number): void => {
      advancePresentation(timestamp);
      if (presentationPlayback.current !== undefined) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [presentationPlaying]);

  function runConformance(runExclusiveJob: RunExclusiveJob): void {
    conformanceRunController.current?.abort(new DOMException('conformance run was superseded', 'AbortError'));
    const controller = new AbortController();
    conformanceRunController.current = controller;
    const revision = ++conformanceRunRevision.current;
    setError(undefined);
    startTransition(() => {
      const request = Promise.resolve().then(() =>
        runExclusiveJob(
          ({ renderer, signal }) =>
            runRegisteredBenchmark({
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
              executionContext: { renderer, signal },
              onEvent: (nextEvent) => {
                if (revision === conformanceRunRevision.current) setEvent(nextEvent);
              },
            }),
          controller.signal,
        ),
      );
      void request
        .then(
          (value) => {
            if (revision === conformanceRunRevision.current) startTransition(() => setSummary(value));
          },
          (caught: unknown) => {
            if (
              revision === conformanceRunRevision.current &&
              !(caught instanceof DOMException && caught.name === 'AbortError')
            ) {
              setError(caught instanceof Error ? caught.message : String(caught));
            }
          },
        )
        .then(() => {
          if (conformanceRunController.current === controller) conformanceRunController.current = undefined;
        });
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

  const advanceShowcase = useEffectEvent((elapsedMs: number) => {
    const next = advanceAdvancedShapingByTime(showcaseState, elapsedMs);
    setShowcaseState(next);
    setAdvancedFontFixture(advancedShapingCase(next.caseId).fontFixture);
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
    let previousTimestamp: number | undefined;
    const animate = (timestamp: number): void => {
      const elapsedMs = previousTimestamp === undefined ? 0 : timestamp - previousTimestamp;
      previousTimestamp = timestamp;
      advanceShowcase(elapsedMs);
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [location.mode, location.workload, showcaseState.editedText, showcaseState.playing]);

  const controls = (
    <RuntimeControls
      minimal={presentationMode}
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
    <Suspense fallback={<SceneSuspenseFallback technique={location.technique} />}>
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
        demoMode={presentationPlaying}
        presentation={presentationMode ? 'presentation' : 'main'}
        presentationPreset={presentationPreset}
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
    </Suspense>
  );
  const reportRendererError = (caught: unknown): void => {
    setError(caught instanceof Error ? caught.message : String(caught));
  };

  return (
    <PersistentRenderHostProvider
      backend={location.backend}
      dpr={dpr}
      key={location.backend}
      onError={reportRendererError}
    >
      <PersistentHarnessLayout
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
        presentationPlaying={presentationPlaying}
        scene={scene}
        showcaseFrame={showcaseFrame}
        summary={summary}
        webgpu={environment.webgpu}
        workloadPanelOpen={workloadPanelOpen}
        onBenchmarkAction={captureWindow}
        onConformanceAction={runConformance}
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
    </PersistentRenderHostProvider>
  );
}

function PersistentHarnessLayout({
  onBenchmarkAction,
  onConformanceAction,
  ...properties
}: Omit<HarnessLayoutProps, 'onAction'> & {
  readonly onBenchmarkAction: () => void;
  readonly onConformanceAction: (runExclusiveJob: RunExclusiveJob) => void;
}) {
  const { runExclusiveJob } = usePersistentRenderHost();
  return (
    <HarnessAppLayout
      {...properties}
      onAction={
        properties.location.mode === 'benchmark' ? onBenchmarkAction : () => onConformanceAction(runExclusiveJob)
      }
    />
  );
}

function locationSearch(): string {
  return typeof globalThis.location === 'undefined' ? '' : globalThis.location.search;
}

function isPresentationShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"], [role="combobox"]') !==
    null
  );
}

function isPresentationTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'textarea, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"]',
    ) !== null
  );
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
  demoMode,
  presentation,
  presentationPreset,
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
  readonly demoMode: boolean;
  readonly presentation: 'main' | 'presentation';
  readonly presentationPreset: PresentationPreset | undefined;
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
        demoMode={demoMode}
        dpr={dpr}
        fontSize={fontSize}
        fontFixture={activeFontFixture}
        grid={grid}
        layoutWidthPercent={layoutWidthPercent}
        paintOpacityPercent={paintOpacityPercent}
        paintShadowEnabled={paintShadowEnabled}
        paintStrokePercent={paintStrokePercent}
        presentation={presentation}
        presentationPreset={presentationPreset}
        showLayoutBounds={showLayoutBounds}
        workloadAmount={workloadAmount}
        showcaseFrame={showcaseFrame}
        stats={liveStats}
        technique={location.technique}
        workload={benchmarkWorkload.id}
        onStats={onLiveStats}
      />
    );

  if (presentation === 'presentation') {
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
  demoMode,
  dpr,
  fontFixture,
  fontSize,
  grid,
  layoutWidthPercent,
  paintOpacityPercent,
  paintShadowEnabled,
  paintStrokePercent,
  presentation,
  presentationPreset,
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
  readonly demoMode: boolean;
  readonly dpr: 1 | 2;
  readonly fontFixture: BenchmarkFontFixture;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly layoutWidthPercent: number;
  readonly paintOpacityPercent: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokePercent: number;
  readonly presentation: 'main' | 'presentation';
  readonly presentationPreset: PresentationPreset | undefined;
  readonly showLayoutBounds: boolean;
  readonly workloadAmount: number;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly stats: LiveTextStats | undefined;
  readonly technique: RasterTechnique;
  readonly workload: BenchmarkWorkloadId;
  readonly onStats: (stats: LiveTextStats) => void;
}) {
  use(liveSceneAssetResource(technique, delivery, fontFixture, workload));
  const surfaceAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return scheduleComparisonWorkloadPreload();
  }, []);
  const comparisonWorkload = comparisonWorkloadId(workload);
  const bitmapStats = stats?.technique === 'bitmap' ? stats : undefined;
  const mtsdfStats = stats?.technique === 'mtsdf' ? stats : undefined;
  const slugStats = stats?.technique === 'slug' ? stats : undefined;
  const comparisonStats = isComparisonWorkloadStats(stats) ? stats : undefined;
  const textConfiguration = liveTextSceneForWorkload(workload, {
    fontFixture,
    layoutWidthRatio: layoutWidthPercent / 100,
    showcaseFrame,
  });
  if (comparisonWorkload === undefined && textConfiguration === undefined) {
    throw new Error(`Live workload ${workload} has no authored Text scene`);
  }
  const viewport =
    comparisonWorkload !== undefined ? (
      <ComparisonWorkloadViewport
        amount={workloadAmount}
        animationEnabled={animationEnabled}
        animationSpeed={animationSpeed}
        backend={backend}
        delivery={delivery}
        demoMode={demoMode}
        suppressLoading={demoMode || presentation === 'presentation'}
        dpr={dpr}
        fontSize={fontSize}
        fontFixture={fontFixture}
        grid={grid}
        layoutWidthRatio={layoutWidthPercent / 100}
        paintOpacity={paintOpacityPercent / 100}
        paintShadowEnabled={paintShadowEnabled}
        paintStrokeWidth={paintStrokePercent / 100}
        presentationPreset={presentationPreset}
        showLayoutBounds={showLayoutBounds}
        stats={comparisonStats}
        technique={technique}
        workload={comparisonWorkload}
        surfaceAnchorRef={surfaceAnchorRef}
        onStats={onStats}
      />
    ) : technique === 'slug' ? (
      <SlugTextViewport
        backend={backend}
        delivery={delivery}
        suppressLoading={demoMode || presentation === 'presentation'}
        dpr={dpr}
        fontSize={fontSize}
        grid={grid}
        surfaceAnchorRef={surfaceAnchorRef}
        stats={slugStats}
        textConfiguration={withLiveTextFontSize(textConfiguration, fontSize)}
        workload={workload}
        onStats={onStats}
      />
    ) : technique === 'mtsdf' ? (
      <MtsdfTextViewport
        backend={backend}
        delivery={delivery}
        suppressLoading={demoMode || presentation === 'presentation'}
        dpr={dpr}
        fontSize={fontSize}
        grid={grid}
        surfaceAnchorRef={surfaceAnchorRef}
        stats={mtsdfStats}
        textConfiguration={withLiveTextFontSize(textConfiguration, fontSize)}
        workload={workload}
        onStats={onStats}
      />
    ) : (
      <BitmapTextViewport
        backend={backend}
        delivery={delivery}
        suppressLoading={demoMode || presentation === 'presentation'}
        dpr={dpr}
        fontSize={fontSize}
        grid={grid}
        surfaceAnchorRef={surfaceAnchorRef}
        stats={bitmapStats}
        textConfiguration={withLiveTextFontSize(textConfiguration, fontSize)}
        workload={workload}
        onStats={onStats}
      />
    );
  return (
    <LiveBenchmarkSurface
      advanced={textConfiguration?.presentation === 'timeline'}
      presentation={presentation}
      showcaseFrame={showcaseFrame}
      stats={stats}
      surfaceAnchorRef={surfaceAnchorRef}
      viewport={viewport}
      workload={workload}
    />
  );
}

function withLiveTextFontSize(scene: LiveTextScene | undefined, fontSize: number): LiveTextConfiguration {
  if (scene === undefined) throw new Error('A single-paragraph live surface requires an authored Text scene');
  return { ...scene, fontSize };
}

function comparisonViewportEvidence({
  layoutWidthRatio,
  stats,
  technique,
  workload,
  workloadFonts,
}: {
  readonly layoutWidthRatio: number;
  readonly stats: ComparisonWorkloadStats | undefined;
  readonly technique: RasterTechnique;
  readonly workload: ComparisonWorkloadId;
  readonly workloadFonts: ReturnType<typeof liveWorkloadFontFixtures>;
}): Record<`data-${string}`, string | number | boolean | undefined> {
  const iconStats = stats?.workload === 'icon-grid' ? stats : undefined;
  const paintStats = stats?.workload === 'paint-effects' ? stats : undefined;
  const zoomStats = stats?.workload === 'zoom-text' ? stats : undefined;
  const appliedWorkloadFonts =
    stats === undefined ? undefined : liveWorkloadFontFixtures(stats.workload, stats.appliedFontFixture);
  const requestedFontFixture = workloadFonts.kind === 'icon-grid' ? workloadFonts.labels : workloadFonts.primary;
  const animatedStats = stats;
  return {
    'data-canvas-grid': stats === undefined ? undefined : String(stats.showGrid),
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
    'data-font-fixture': appliedWorkloadFonts?.primary,
    'data-label-font-fixture': appliedWorkloadFonts?.kind === 'icon-grid' ? appliedWorkloadFonts.labels : undefined,
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
    'data-camera-kind': stats?.cameraKind,
    'data-applied-font-size': stats?.appliedFontSize,
    'data-applied-workload-amount': stats?.appliedAmount,
    'data-layout-width-ratio': stats?.appliedLayoutWidthRatio,
    'data-paint-opacity': paintStats?.appliedPaintOpacity,
    'data-paint-shadow-enabled': paintStats === undefined ? undefined : String(paintStats.appliedPaintShadowEnabled),
    'data-paint-stroke-width': paintStats?.appliedPaintStrokeWidth,
    'data-paint-revision': paintStats?.paintRevision,
    'data-paint-update-ms': paintStats?.lastPaintUpdateMs,
    'data-presentation-pending':
      stats !== undefined &&
      (stats.technique !== technique ||
        stats.workload !== workload ||
        stats.appliedFontFixture !== requestedFontFixture),
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
  demoMode,
  dpr,
  fontFixture,
  fontSize,
  grid,
  layoutWidthRatio,
  paintOpacity,
  paintShadowEnabled,
  paintStrokeWidth,
  presentationPreset,
  showLayoutBounds,
  suppressLoading,
  stats,
  surfaceAnchorRef,
  technique,
  workload,
  onStats,
}: {
  readonly amount: number;
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly demoMode: boolean;
  readonly dpr: 1 | 2;
  readonly fontFixture: BenchmarkFontFixture;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly layoutWidthRatio: number;
  readonly paintOpacity: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokeWidth: number;
  readonly presentationPreset: PresentationPreset | undefined;
  readonly showLayoutBounds: boolean;
  readonly suppressLoading: boolean;
  readonly stats: ComparisonWorkloadStats | undefined;
  readonly surfaceAnchorRef: RefObject<HTMLDivElement | null>;
  readonly technique: RasterTechnique;
  readonly workload: ComparisonWorkloadId;
  readonly onStats: (stats: LiveTextStats) => void;
}) {
  const { activateSurface, configureSurface } = usePersistentRenderHost();
  const activatePersistentSurface = useEffectEvent(activateSurface);
  const configurePersistentSurface = useEffectEvent(configureSurface);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ComparisonWorkloadPersistentScene>(undefined);
  const workloadDefinition = benchmarkWorkloadDefinition(workload);
  const workloadFonts = liveWorkloadFontFixtures(workload, fontFixture);
  const [error, setError] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress(techniqueLabel(technique));
  const publishStats = useEffectEvent((next: ComparisonWorkloadStats) => {
    finishBakeProgress();
    onStats(next);
    setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const currentConfiguration = useEffectEvent(
    (): ComparisonWorkloadConfiguration => ({
      amount,
      animationEnabled,
      animationSpeed,
      fontFixture,
      fontSize,
      iconGridView: presentationPreset === 'icon-grid-return' ? 'alternate' : 'origin',
      layoutWidthRatio,
      paintOpacity,
      paintShadowEnabled,
      paintStrokeWidth,
      showGrid: grid,
      showLayoutBounds,
      textLadderExitEnabled: demoMode && workload === 'text-ladder',
      workload,
    }),
  );

  useEffect(() => {
    const container = containerRef.current;
    const surfaceAnchor = surfaceAnchorRef.current;
    if (container === null || surfaceAnchor === null) return;
    const controller = new AbortController();
    let preview: ComparisonWorkloadPersistentScene | undefined;
    let surfaceLease: Awaited<ReturnType<typeof activateSurface>> | undefined;
    let cancelled = false;
    const initialization = (async () => {
      const { createComparisonWorkloadPersistentScene } = await preloadComparisonWorkload();
      if (cancelled) return;
      const configuration = currentConfiguration();
      const interaction = benchmarkWorkloadDefinition(configuration.workload).interaction;
      const created = createComparisonWorkloadPersistentScene({
        ...configuration,
        backend,
        delivery,
        technique,
        onError: publishError,
        onStats: publishStats,
        onBakeProgress: publishBakeProgress,
      });
      preview = created;
      previewRef.current = created;
      surfaceLease = await activatePersistentSurface(
        {
          anchor: surfaceAnchor,
          controller: previewRef,
          label: `Live ${techniqueLabel(technique)} benchmark using ${backend}`,
          pan: interaction.pan,
          scene: created,
          zoom: interaction.zoom,
        },
        controller.signal,
      );
      if (cancelled) await surfaceLease.release();
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      void initialization.then(
        async () => {
          const current = preview;
          preview = undefined;
          if (previewRef.current === current) previewRef.current = undefined;
          await surfaceLease?.release();
        },
        () => {
          const current = preview;
          preview = undefined;
          if (previewRef.current === current) previewRef.current = undefined;
        },
      );
    };
  }, [backend, delivery, publishBakeProgress, surfaceAnchorRef, technique]);

  useEffect(() => {
    const interaction = benchmarkWorkloadDefinition(workload).interaction;
    configurePersistentSurface({
      controller: previewRef,
      label: `Live ${techniqueLabel(technique)} benchmark using ${backend}`,
      pan: interaction.pan,
      zoom: interaction.zoom,
    });
  }, [backend, technique, workload]);

  useEffect(() => {
    const preview = previewRef.current;
    if (preview === undefined) return;
    void preview.update(currentConfiguration()).catch(publishError);
  }, [
    amount,
    animationEnabled,
    animationSpeed,
    dpr,
    demoMode,
    fontFixture,
    fontSize,
    layoutWidthRatio,
    paintOpacity,
    paintShadowEnabled,
    paintStrokeWidth,
    presentationPreset,
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
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-border"
      {...comparisonViewportEvidence({ stats, technique, workload, workloadFonts, layoutWidthRatio })}
      data-testid="comparison-live-viewport"
      ref={containerRef}
    >
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
        {workloadDefinition.interaction.zoom
          ? 'PAN · PINCH/WHEEL ZOOM'
          : workloadDefinition.interaction.pan
            ? 'PAN'
            : 'AUTO FIT'}{' '}
        · {dpr}× DPR
      </div>
      {!suppressLoading && (stats === undefined || bakeProgressActive) && error === undefined && (
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
