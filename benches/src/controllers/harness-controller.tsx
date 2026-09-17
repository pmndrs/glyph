import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react';

import {
  advanceAdvancedShapingByTime,
  advancedShapingCase,
  advancedShapingFrame,
  initialAdvancedShapingState,
  updateAdvancedShaping,
  type AdvancedShapingCommand,
} from '../workloads/advanced-shaping/scene';
import { environmentResource } from '../benchmark/environment';
import {
  resetRuntimeControlsForWorkload,
  RuntimeTelemetry,
  useRuntimeWorld,
  type RuntimeLiveStats,
} from '../benchmark/runtime-world';
import type { PresentationPreset } from '../benchmark/presentation-sequence';
import { type BenchmarkFontFixture } from '../benchmark/font-fixtures';
import {
  readHarnessLocation,
  writeHarnessUrl,
  type FontDelivery,
  type HarnessLayout,
  type HarnessLocation,
  type RasterFormatName,
} from '../benchmark/url-state';
import { RuntimeControls } from '../components/runtime-controls';
import { liveSceneAssetResource, loadBenchmarkFontAssets } from '../surfaces/benchmark/scene-preload';
import { PersistentHarnessLayout } from '../surfaces/harness/persistent-layout';
import { Scene, SceneSuspenseFallback } from '../surfaces/harness/scene';
import { SceneErrorBoundary } from '../surfaces/harness/scene-error-boundary';
import { useLocation } from 'wouter';
import { PresentationPlayback } from './presentation-playback';

type LiveTextStats = RuntimeLiveStats;

const PRESENTATION_FONT_FIXTURES = [
  'inter',
  'font-awesome-free-6.7.2',
  'amiri',
  'noto-sans-devanagari',
  'noto-sans-cjk-showcase',
] as const satisfies readonly BenchmarkFontFixture[];

async function preloadPresentationAssets(
  technique: RasterFormatName,
  delivery: FontDelivery,
  selectedFont: BenchmarkFontFixture,
  signal: AbortSignal,
): Promise<void> {
  if (delivery !== 'baked') return;
  const fixtures = Array.from(new Set<BenchmarkFontFixture>([selectedFont, ...PRESENTATION_FONT_FIXTURES]));
  const { preloadBenchmarkFontAssets } = await loadBenchmarkFontAssets();
  await preloadBenchmarkFontAssets({ technique, fixtures, signal, bitmapDensity: 'live' });
}

export function HarnessController({ layout }: { readonly layout: HarnessLayout }): ReactNode {
  return useHarnessController(layout);
}

function useHarnessController(routeLayout: HarnessLayout): ReactNode {
  const [, navigate] = useLocation();
  const environment = use(environmentResource());
  const runtimeWorld = useRuntimeWorld();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => true);
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
  const [location, setLocationState] = useState(() => {
    const value = readHarnessLocation(locationSearch(), defaultDeviceDpr(), routeLayout);
    if (!environment.webgpu && !new URLSearchParams(locationSearch()).has('backend')) {
      return { ...value, backend: 'webgl2' as const };
    }
    return value;
  });
  const [error, setError] = useState<string>();
  const [dpr, setDpr] = useState<1 | 2>(location.dpr);
  const [showcaseState, setShowcaseState] = useState(() => initialAdvancedShapingState('manual'));
  const [advancedFontFixture, setAdvancedFontFixture] = useState<BenchmarkFontFixture>('noto-sans-cjk-showcase');
  const [workloadPanelOpen, setWorkloadPanelOpen] = useState(() => desktopSnapshot());
  const [fontNoticesOpen, setFontNoticesOpen] = useState(false);
  const [presentationPlaying, setPresentationPlaying] = useState(false);
  const [presentationPreset, setPresentationPreset] = useState<PresentationPreset>();
  const [, startTransition] = useTransition();
  const committedLocationRef = useRef(location);
  const requestedLocationRef = useRef(location);
  const locationRequestRevisionRef = useRef(0);
  const advancedFontRequestRevisionRef = useRef(0);
  const presentationActive = useRef(false);
  const fontFixture = location.fontFixture;
  const showcaseFrame = advancedShapingFrame(showcaseState);
  const activeFontFixture: BenchmarkFontFixture =
    location.workload === 'advanced-shaping'
      ? advancedFontFixture
      : location.workload === 'zoom-text'
        ? 'inter'
        : fontFixture;
  const presentationMode = location.layout === 'presentation';

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

  function setLocation(next: Partial<HarnessLocation>): void {
    if (!presentationActive.current && next.workload !== undefined) setPresentationPreset(undefined);
    const previous = requestedLocationRef.current;
    const value = { ...previous, ...next };
    const requestRevision = ++locationRequestRevisionRef.current;
    requestedLocationRef.current = value;
    const entersAdvancedShaping = value.workload === 'advanced-shaping' && previous.workload !== 'advanced-shaping';
    const nextAdvancedShapingState = entersAdvancedShaping
      ? initialAdvancedShapingState(presentationActive.current ? 'auto' : 'manual')
      : undefined;
    const sceneFontFixture =
      value.workload === 'advanced-shaping'
        ? nextAdvancedShapingState === undefined
          ? advancedFontFixture
          : advancedShapingCase(nextAdvancedShapingState.caseId).fontFixture
        : value.workload === 'zoom-text'
          ? 'inter'
          : value.fontFixture;
    const updatesRuntimeDefaults =
      (next.workload !== undefined && next.workload !== previous.workload) ||
      (next.layout !== undefined && next.layout !== previous.layout);
    const replacesLiveSurface =
      next.technique !== undefined ||
      next.backend !== undefined ||
      next.delivery !== undefined ||
      next.dpr !== undefined ||
      next.workload !== undefined;
    const replacesRendererGeneration = next.backend !== undefined;
    if (replacesRendererGeneration) runtimeWorld.set(RuntimeTelemetry, { stats: undefined });
    if (replacesLiveSurface || next.fontFixture !== undefined) setError(undefined);
    const commitLocation = (): void => {
      if (requestRevision !== locationRequestRevisionRef.current) return;
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
      if (nextAdvancedShapingState !== undefined) {
        advancedFontRequestRevisionRef.current += 1;
        setShowcaseState(nextAdvancedShapingState);
        setAdvancedFontFixture(advancedShapingCase(nextAdvancedShapingState.caseId).fontFixture);
      }
    };
    if (transitionsScene) {
      startTransition(() => {
        void liveSceneAssetResource(value.technique, value.delivery, sceneFontFixture, value.workload).then(
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

  function selectFormat(technique: RasterFormatName): void {
    setLocation({ technique });
  }

  function selectAdvancedFontFixture(nextFontFixture: BenchmarkFontFixture): void {
    const requestRevision = ++advancedFontRequestRevisionRef.current;
    const { delivery, technique } = requestedLocationRef.current;
    startTransition(() => {
      void liveSceneAssetResource(technique, delivery, nextFontFixture, 'advanced-shaping').then(
        () => {
          if (
            requestRevision !== advancedFontRequestRevisionRef.current ||
            requestedLocationRef.current.workload !== 'advanced-shaping' ||
            requestedLocationRef.current.technique !== technique ||
            requestedLocationRef.current.delivery !== delivery
          ) {
            return;
          }
          startTransition(() => {
            setAdvancedFontFixture(nextFontFixture);
          });
        },
        (caught: unknown) => {
          if (requestRevision !== advancedFontRequestRevisionRef.current) return;
          setError(caught instanceof Error ? caught.message : String(caught));
        },
      );
    });
  }

  function publishLiveStats(stats: LiveTextStats): void {
    runtimeWorld.set(RuntimeTelemetry, { stats });
  }

  function dispatchShowcase(command: AdvancedShapingCommand): void {
    if (command.kind === 'select-case') {
      setAdvancedFontFixture(advancedShapingCase(command.caseId).fontFixture);
    }
    setShowcaseState((state) => updateAdvancedShaping(state, command));
  }

  const advanceShowcase = useEffectEvent((elapsedMs: number) => {
    const next = advanceAdvancedShapingByTime(showcaseState, elapsedMs);
    setShowcaseState(next);
    setAdvancedFontFixture(advancedShapingCase(next.caseId).fontFixture);
  });
  useEffect(() => {
    if (location.workload !== 'advanced-shaping' || !showcaseState.playing || showcaseState.editedText !== undefined)
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
  }, [location.workload, showcaseState.editedText, showcaseState.playing]);

  const controls = (
    <RuntimeControls
      minimal={presentationMode}
      backend={location.backend}
      delivery={location.delivery}
      dpr={dpr}
      fontFixture={activeFontFixture}
      technique={location.technique}
      workload={location.workload}
      showcaseFrame={showcaseFrame}
      showcaseState={showcaseState}
      selectedFontFixture={fontFixture}
      webgpu={environment.webgpu}
      onBackend={(backend) => setLocation({ backend })}
      onDelivery={(delivery) => setLocation({ delivery })}
      onDpr={(value) => {
        setDpr(value);
        setLocation({ dpr: value });
      }}
      onFontNotices={() => setFontNoticesOpen(true)}
      onSelectedFontFixture={(value) => {
        setLocation({ fontFixture: value });
      }}
      onShowcase={dispatchShowcase}
    />
  );

  const reportRendererError = useCallback((caught: unknown): void => {
    setError(caught instanceof Error ? caught.message : String(caught));
  }, []);
  const sceneIdentity = [
    location.backend,
    location.delivery,
    location.technique,
    activeFontFixture,
    location.workload,
  ].join(':');
  const scene = (
    <SceneErrorBoundary identity={sceneIdentity} technique={location.technique} onError={reportRendererError}>
      <Suspense fallback={<SceneSuspenseFallback technique={location.technique} />}>
        <Scene
          activeFontFixture={activeFontFixture}
          dpr={dpr}
          error={error}
          location={location}
          demoMode={presentationPlaying}
          presentation={presentationMode ? 'presentation' : 'main'}
          presentationPreset={presentationPreset}
          showcaseFrame={showcaseFrame}
          onLiveStats={publishLiveStats}
        />
      </Suspense>
    </SceneErrorBoundary>
  );

  return (
    <>
      <PresentationPlayback
        location={location}
        playing={presentationPlaying}
        requestedLocation={requestedLocationRef}
        setAdvancedFontFixture={setAdvancedFontFixture}
        setLocation={setLocation}
        onPlaying={(playing) => {
          presentationActive.current = playing;
          setPresentationPlaying(playing);
        }}
        setPreset={setPresentationPreset}
        setShowcaseState={setShowcaseState}
      />
      <PersistentHarnessLayout
        activeFontFixture={activeFontFixture}
        backend={location.backend}
        controls={controls}
        desktop={desktop}
        dpr={dpr}
        fontNoticesOpen={fontNoticesOpen}
        location={location}
        phone={phone}
        presentationPlaying={presentationPlaying}
        scene={scene}
        showcaseFrame={showcaseFrame}
        webgpu={environment.webgpu}
        workloadPanelOpen={workloadPanelOpen}
        onAdvancedFontFixture={selectAdvancedFontFixture}
        onCloseFontNotices={() => setFontNoticesOpen(false)}
        onFormat={selectFormat}
        onLocation={setLocation}
        onRendererError={reportRendererError}
        onWorkloadPanelOpen={setWorkloadPanelOpen}
      />
    </>
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
