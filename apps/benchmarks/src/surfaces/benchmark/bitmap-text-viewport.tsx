import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { FontDelivery, GraphicsBackend } from '../../benchmark/url-state';
import type {
  BitmapTextLiveStats,
  BitmapTextPersistentScene,
  BitmapTextSceneSnapshot,
} from '../../techniques/bitmap/persistent-scene';
import { usePersistentRenderHost } from '../../renderer/persistent-render-host-context';
import {
  benchmarkContentWidth,
  BENCHMARK_CONTENT_INSET,
  BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH,
} from '../../workloads/shared/text-style';
import type { BenchmarkWorkloadId } from '../../workloads/catalog';
import type { BakeProgress } from '@pmndrs/glyph';

import { BakeProgressOverlay, useBakeProgress } from './bake-progress-overlay';
import type {
  LiveTextConfiguration,
  PresentationEvidence,
  RetainedLiveTextUpdate,
} from './live-text-viewport-contracts';

function loadBitmapTextRenderer() {
  return import('../../techniques/bitmap/persistent-scene');
}

interface LiveTextUpdateHandlers {
  readonly onSettled: (snapshot: BitmapTextSceneSnapshot, input: RetainedLiveTextUpdate) => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Applies one authored configuration to the live scene and returns a cancel function for React's cleanup.
 *
 * The update is committed in this turn whenever the scene already holds the requested fixture, which is every change
 * but a fixture swap. Only fetching and decoding a replacement fixture is awaited, and nothing coalesces or defers the
 * shaping itself: a queue in front of `update` would drop work during continuous animation and quietly present text
 * that lags the state the surface is already rendering from.
 */
function applyLiveTextUpdate(
  scene: BitmapTextPersistentScene,
  update: RetainedLiveTextUpdate,
  handlers: LiveTextUpdateHandlers,
): () => void {
  let cancelled = false;
  const commit = (): void => {
    if (cancelled) return;
    const snapshot = scene.update(update);
    handlers.onSettled(snapshot, update);
  };
  if (scene.hasFontFixture(update.fontFixture)) {
    try {
      commit();
    } catch (error) {
      handlers.onError(error);
    }
  } else {
    void scene.loadFontFixture(update.fontFixture).then(commit).catch(handlers.onError);
  }
  return () => {
    cancelled = true;
  };
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
    'data-presentation-transitioned': presentationEvidence.transitioned,
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

export interface BitmapTextViewportProps {
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly suppressLoading: boolean;
  readonly stats: BitmapTextLiveStats | undefined;
  readonly surfaceAnchorRef: RefObject<HTMLDivElement | null>;
  readonly textConfiguration: LiveTextConfiguration;
  readonly workload: BenchmarkWorkloadId;
  readonly onStats: (stats: BitmapTextLiveStats) => void;
}

export function BitmapTextViewport({
  backend,
  delivery,
  dpr,
  fontSize,
  grid,
  suppressLoading,
  stats,
  surfaceAnchorRef,
  textConfiguration,
  workload,
  onStats,
}: BitmapTextViewportProps) {
  const { activateSurface } = usePersistentRenderHost();
  const activatePersistentSurface = useEffectEvent(activateSurface);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BitmapTextPersistentScene>(undefined);
  // The host owns `sceneRef` from the moment the scene is constructed; updates need the narrower window that starts
  // once activation has actually committed a first layout.
  const activeSceneRef = useRef<BitmapTextPersistentScene>(undefined);
  const pendingSettledWorkloadRef = useRef<string>(undefined);
  const [settledRevision, setSettledRevision] = useState(0);
  const [settledTextLength, setSettledTextLength] = useState(0);
  const [settledTimelineTick, setSettledTimelineTick] = useState<number>();
  const [settledWorkload, setSettledWorkload] = useState<string>();
  const [presentationEvidence, setPresentationEvidence] = useState<PresentationEvidence>({
    revision: 0,
    progress: 1,
    transitioned: false,
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
    const pendingWorkload = pendingSettledWorkloadRef.current;
    if (pendingWorkload !== undefined) {
      pendingSettledWorkloadRef.current = undefined;
      setSettledWorkload(pendingWorkload);
    }
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    setError(caught instanceof Error ? caught.message : String(caught));
  });
  const sceneConfiguration = useEffectEvent(() => ({
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
    workload,
  }));
  const publishPresentation = useEffectEvent((snapshot: BitmapTextSceneSnapshot, progress: 0 | 1) => {
    setPresentationEvidence({
      revision: snapshot.revision,
      progress,
      transitioned: snapshot.transitioned,
      matchedGlyphs: snapshot.matchedGlyphs,
      targetGlyphs: snapshot.targetGlyphs,
    });
  });
  const publishSettled = useEffectEvent((snapshot: BitmapTextSceneSnapshot, input: RetainedLiveTextUpdate) => {
    publishPresentation(snapshot, 1);
    setSettledRevision(snapshot.revision);
    setSettledTimelineTick(input.timelineTick);
    setSettledTextLength(input.text.length);
    pendingSettledWorkloadRef.current = input.workload;
  });

  useEffect(() => {
    const container = containerRef.current;
    const surfaceAnchor = surfaceAnchorRef.current;
    if (container === null || surfaceAnchor === null) return;
    const controller = new AbortController();
    const configuration = sceneConfiguration();
    let scene: BitmapTextPersistentScene | undefined;
    let cancelInitialUpdate: (() => void) | undefined;
    let surfaceLease: Awaited<ReturnType<typeof activateSurface>> | undefined;
    let cancelled = false;
    const initialization = (async () => {
      const { createBitmapTextPersistentScene } = await loadBitmapTextRenderer();
      if (cancelled) return;
      const created = createBitmapTextPersistentScene({
        anchor: configuration.anchor,
        backend,
        delivery,
        ...(configuration.expectedGlyphCount === undefined
          ? {}
          : { expectedGlyphCount: configuration.expectedGlyphCount }),
        fontFixture: configuration.fontFixture,
        fontSize: configuration.fontSize,
        showGrid: configuration.showGrid,
        layoutWidth: benchmarkContentWidth(container.clientWidth, configuration.layoutWidthRatio),
        layoutWidthRatio: configuration.layoutWidthRatio,
        text: configuration.text,
        language: configuration.language,
        direction: configuration.direction,
        features: configuration.features,
        textAlign: configuration.textAlign,
        onError: publishError,
        onStats: publishStats,
        onBakeProgress: publishBakeProgress,
      });
      scene = created;
      sceneRef.current = created;
      surfaceLease = await activatePersistentSurface(
        {
          anchor: surfaceAnchor,
          controller: sceneRef,
          label: `Live bitmap benchmark using ${backend}`,
          pan: true,
          scene: created,
          zoom: false,
        },
        controller.signal,
      );
      if (cancelled) {
        await surfaceLease.release();
        return;
      }
      // Activation committed the configuration this scene was constructed from; catch up with whatever the surface
      // has moved on to since, then hand later changes to the synchronous effect below.
      activeSceneRef.current = created;
      setSettledWorkload(configuration.workload);
      cancelInitialUpdate = applyLiveTextUpdate(created, sceneConfiguration(), {
        onSettled: publishSettled,
        onError: publishError,
      });
    })();
    void initialization.catch(publishError);
    return () => {
      cancelled = true;
      controller.abort();
      cancelInitialUpdate?.();
      void initialization.then(
        async () => {
          const current = scene;
          scene = undefined;
          if (sceneRef.current === current) sceneRef.current = undefined;
          if (activeSceneRef.current === current) activeSceneRef.current = undefined;
          await surfaceLease?.release();
        },
        () => {
          const current = scene;
          scene = undefined;
          if (sceneRef.current === current) sceneRef.current = undefined;
          if (activeSceneRef.current === current) activeSceneRef.current = undefined;
        },
      );
    };
  }, [backend, delivery, publishBakeProgress, surfaceAnchorRef]);

  useEffect(() => {
    sceneRef.current?.setGridVisible(grid);
  }, [grid]);

  useEffect(() => {
    const scene = activeSceneRef.current;
    if (scene === undefined) return;
    return applyLiveTextUpdate(
      scene,
      {
        anchor,
        fontFixture,
        fontSize,
        layoutWidthRatio,
        text,
        language,
        direction,
        expectedGlyphCount,
        features,
        textAlign,
        timelineTick,
        workload,
      },
      { onSettled: publishSettled, onError: publishError },
    );
  }, [
    anchor,
    direction,
    dpr,
    expectedGlyphCount,
    features,
    fontFixture,
    fontSize,
    language,
    layoutWidthRatio,
    text,
    textAlign,
    timelineTick,
    workload,
  ]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-border"
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
      data-workload={settledWorkload}
      data-presentation-pending={settledWorkload !== workload}
      ref={containerRef}
    >
      <BitmapViewportChrome
        backend={backend}
        bakeProgressActive={bakeProgressActive}
        bakeProgressValue={bakeProgressValue}
        delivery={delivery}
        dpr={dpr}
        error={error}
        fontSize={fontSize}
        stats={stats}
        suppressLoading={suppressLoading}
      />
    </div>
  );
}

function BitmapViewportChrome({
  backend,
  bakeProgressActive,
  bakeProgressValue,
  delivery,
  dpr,
  error,
  fontSize,
  stats,
  suppressLoading,
}: {
  readonly backend: GraphicsBackend;
  readonly bakeProgressActive: boolean;
  readonly bakeProgressValue: BakeProgress | undefined;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly error: string | undefined;
  readonly fontSize: number;
  readonly stats: BitmapTextLiveStats | undefined;
  readonly suppressLoading: boolean;
}) {
  return (
    <>
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
      {!suppressLoading && (stats === undefined || bakeProgressActive) && error === undefined && (
        <BakeProgressOverlay backend={backend} progress={bakeProgressValue} technique="BITMAP" />
      )}
      {error !== undefined && (
        <div
          className="absolute inset-0 z-10 grid place-items-center bg-background p-3 text-center text-[10px] text-danger"
          data-testid="bitmap-live-error"
        >
          {error}
        </div>
      )}
    </>
  );
}
