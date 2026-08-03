import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';

import type { FontDelivery, GraphicsBackend } from '../../benchmark/url-state';
import { createLatestAsyncQueue, type LatestAsyncQueue } from '../../renderer/latest-async-queue';
import type { MtsdfTextLiveStats, MtsdfTextPersistentScene } from '../../renderer/mtsdf-text';
import { usePersistentRenderHost } from '../../renderer/persistent-render-host-context';
import type { SlugTextLiveStats, SlugTextPersistentScene } from '../../renderer/slug-text';
import {
  benchmarkContentWidth,
  BENCHMARK_CONTENT_INSET,
  BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH,
} from '../../workloads/shared/text-style';
import type { BenchmarkWorkloadId } from '../../workloads/catalog';

import { BakeProgressOverlay, useBakeProgress } from './bake-progress-overlay';
import type { LiveTextConfiguration, RetainedLiveTextUpdate } from './live-text-viewport-contracts';

function loadMtsdfTextRenderer() {
  return import('../../renderer/mtsdf-text');
}

function loadSlugTextRenderer() {
  return import('../../renderer/slug-text');
}

interface SdfTextViewportProps<TStats> {
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly suppressLoading: boolean;
  readonly stats: TStats | undefined;
  readonly surfaceAnchorRef: RefObject<HTMLDivElement | null>;
  readonly textConfiguration: LiveTextConfiguration;
  readonly workload: BenchmarkWorkloadId;
  readonly onStats: (stats: TStats) => void;
}

export function MtsdfTextViewport(props: SdfTextViewportProps<MtsdfTextLiveStats>) {
  const {
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
  } = props;
  const { activateSurface } = usePersistentRenderHost();
  const activatePersistentSurface = useEffectEvent(activateSurface);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<MtsdfTextPersistentScene>(undefined);
  const updateQueueRef = useRef<LatestAsyncQueue<RetainedLiveTextUpdate, void>>(undefined);
  const pendingSettledWorkloadRef = useRef<string>(undefined);
  const [error, setError] = useState<string>();
  const [settledWorkload, setSettledWorkload] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress('MSDF');
  const { anchor, direction, features, fontFixture, language, layoutWidthRatio, text, textAlign, timelineTick } =
    textConfiguration;
  const publishStats = useEffectEvent((next: MtsdfTextLiveStats) => {
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
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
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
  const publishSettledWorkload = useEffectEvent((value: string) => {
    pendingSettledWorkloadRef.current = value;
  });
  useEffect(() => {
    const container = containerRef.current;
    const surfaceAnchor = surfaceAnchorRef.current;
    if (container === null || surfaceAnchor === null) return;
    const controller = new AbortController();
    const configuration = previewConfiguration();
    let preview: MtsdfTextPersistentScene | undefined;
    let updateQueue: LatestAsyncQueue<RetainedLiveTextUpdate, void> | undefined;
    let surfaceLease: Awaited<ReturnType<typeof activateSurface>> | undefined;
    let cancelled = false;
    const initialization = (async () => {
      const { createMtsdfTextPersistentScene } = await loadMtsdfTextRenderer();
      if (cancelled) return;
      const created = createMtsdfTextPersistentScene({
        anchor: configuration.anchor,
        backend,
        delivery,
        fontSize: configuration.fontSize,
        fontFixture: configuration.fontFixture,
        showGrid: configuration.showGrid,
        layoutWidth: benchmarkContentWidth(container.clientWidth, configuration.layoutWidthRatio),
        layoutWidthRatio: configuration.layoutWidthRatio,
        text: configuration.text,
        textAlign: configuration.textAlign,
        language: configuration.language,
        direction: configuration.direction,
        features: configuration.features,
        onError: publishError,
        onStats: publishStats,
        onBakeProgress: publishBakeProgress,
      });
      preview = created;
      previewRef.current = created;
      updateQueue = createLatestAsyncQueue((update: RetainedLiveTextUpdate) => created.update(update));
      updateQueueRef.current = updateQueue;
      surfaceLease = await activatePersistentSurface(
        {
          anchor: surfaceAnchor,
          controller: previewRef,
          label: `Live MSDF benchmark using ${backend}`,
          pan: true,
          scene: created,
          zoom: false,
        },
        controller.signal,
      );
      if (cancelled) await surfaceLease.release();
      else {
        const committed = await updateQueue.enqueue(previewConfiguration());
        publishSettledWorkload(committed.input.workload);
      }
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
          if (updateQueueRef.current === updateQueue) updateQueueRef.current = undefined;
          await surfaceLease?.release();
        },
        () => {
          const current = preview;
          preview = undefined;
          if (previewRef.current === current) previewRef.current = undefined;
          if (updateQueueRef.current === updateQueue) updateQueueRef.current = undefined;
        },
      );
    };
  }, [backend, delivery, publishBakeProgress, surfaceAnchorRef]);
  useEffect(() => {
    previewRef.current?.setGridVisible(grid);
  }, [grid]);
  useEffect(() => {
    const updateQueue = updateQueueRef.current;
    if (updateQueue === undefined) return;
    void updateQueue
      .enqueue({
        anchor,
        direction,
        features,
        fontFixture,
        fontSize,
        language,
        layoutWidthRatio,
        text,
        textAlign,
        timelineTick,
        workload,
      })
      .then(({ input }) => publishSettledWorkload(input.workload))
      .catch(publishError);
  }, [
    anchor,
    direction,
    dpr,
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
    <MtsdfViewportChrome
      anchor={anchor}
      containerRef={containerRef}
      backend={backend}
      bakeProgressActive={bakeProgressActive}
      bakeProgressValue={bakeProgressValue}
      dpr={dpr}
      error={error}
      fontFixture={fontFixture}
      fontSize={fontSize}
      grid={grid}
      layoutWidthRatio={layoutWidthRatio}
      stats={stats}
      suppressLoading={suppressLoading}
      text={text}
      textAlign={textAlign}
      timelineTick={timelineTick}
      workload={workload}
      settledWorkload={settledWorkload}
    />
  );
}

function MtsdfViewportChrome({
  anchor,
  containerRef,
  backend,
  bakeProgressActive,
  bakeProgressValue,
  dpr,
  error,
  fontFixture,
  fontSize,
  grid,
  layoutWidthRatio,
  stats,
  suppressLoading,
  text,
  textAlign,
  timelineTick,
  workload,
  settledWorkload,
}: {
  readonly anchor: LiveTextConfiguration['anchor'];
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly backend: GraphicsBackend;
  readonly bakeProgressActive: boolean;
  readonly bakeProgressValue: ReturnType<typeof useBakeProgress>['value'];
  readonly dpr: 1 | 2;
  readonly error: string | undefined;
  readonly fontFixture: string;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly layoutWidthRatio: number;
  readonly stats: MtsdfTextLiveStats | undefined;
  readonly suppressLoading: boolean;
  readonly text: string;
  readonly textAlign: LiveTextConfiguration['textAlign'];
  readonly timelineTick: number | undefined;
  readonly workload: BenchmarkWorkloadId;
  readonly settledWorkload: string | undefined;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-border"
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
      data-timeline-tick={timelineTick}
      data-testid="mtsdf-live-viewport"
      data-workload={settledWorkload}
      data-presentation-pending={settledWorkload !== workload}
      ref={containerRef}
    >
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
      {!suppressLoading && (stats === undefined || bakeProgressActive) && error === undefined && (
        <BakeProgressOverlay backend={backend} progress={bakeProgressValue} technique="MSDF" />
      )}
      {error !== undefined && (
        <div
          className="absolute inset-0 z-10 grid place-items-center bg-background p-3 text-center text-[10px] text-danger"
          data-testid="slug-live-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}

export function SlugTextViewport(props: SdfTextViewportProps<SlugTextLiveStats>) {
  const {
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
  } = props;
  const { activateSurface } = usePersistentRenderHost();
  const activatePersistentSurface = useEffectEvent(activateSurface);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<SlugTextPersistentScene>(undefined);
  const updateQueueRef = useRef<LatestAsyncQueue<RetainedLiveTextUpdate, void>>(undefined);
  const pendingSettledWorkloadRef = useRef<string>(undefined);
  const [error, setError] = useState<string>();
  const [settledWorkload, setSettledWorkload] = useState<string>();
  const {
    active: bakeProgressActive,
    finish: finishBakeProgress,
    publish: publishBakeProgress,
    value: bakeProgressValue,
  } = useBakeProgress('Slug');
  const { anchor, direction, features, fontFixture, language, layoutWidthRatio, text, textAlign, timelineTick } =
    textConfiguration;
  const publishStats = useEffectEvent((next: SlugTextLiveStats) => {
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
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
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
  const publishSettledWorkload = useEffectEvent((value: string) => {
    pendingSettledWorkloadRef.current = value;
  });
  useEffect(() => {
    const container = containerRef.current;
    const surfaceAnchor = surfaceAnchorRef.current;
    if (container === null || surfaceAnchor === null) return;
    const controller = new AbortController();
    const configuration = previewConfiguration();
    let preview: SlugTextPersistentScene | undefined;
    let updateQueue: LatestAsyncQueue<RetainedLiveTextUpdate, void> | undefined;
    let surfaceLease: Awaited<ReturnType<typeof activateSurface>> | undefined;
    let cancelled = false;
    const initialization = (async () => {
      const { createSlugTextPersistentScene } = await loadSlugTextRenderer();
      if (cancelled) return;
      const created = createSlugTextPersistentScene({
        anchor: configuration.anchor,
        backend,
        delivery,
        fontSize: configuration.fontSize,
        fontFixture: configuration.fontFixture,
        showGrid: configuration.showGrid,
        layoutWidthRatio: configuration.layoutWidthRatio,
        text: configuration.text,
        textAlign: configuration.textAlign,
        language: configuration.language,
        direction: configuration.direction,
        features: configuration.features,
        onError: publishError,
        onStats: publishStats,
        onBakeProgress: publishBakeProgress,
      });
      preview = created;
      previewRef.current = created;
      updateQueue = createLatestAsyncQueue((update: RetainedLiveTextUpdate) => created.update(update));
      updateQueueRef.current = updateQueue;
      surfaceLease = await activatePersistentSurface(
        {
          anchor: surfaceAnchor,
          controller: previewRef,
          label: `Live Slug benchmark using ${backend}`,
          pan: true,
          scene: created,
          zoom: false,
        },
        controller.signal,
      );
      if (cancelled) await surfaceLease.release();
      else {
        const committed = await updateQueue.enqueue(previewConfiguration());
        publishSettledWorkload(committed.input.workload);
      }
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
          if (updateQueueRef.current === updateQueue) updateQueueRef.current = undefined;
          await surfaceLease?.release();
        },
        () => {
          const current = preview;
          preview = undefined;
          if (previewRef.current === current) previewRef.current = undefined;
          if (updateQueueRef.current === updateQueue) updateQueueRef.current = undefined;
        },
      );
    };
  }, [backend, delivery, publishBakeProgress, surfaceAnchorRef]);
  useEffect(() => {
    previewRef.current?.setGridVisible(grid);
  }, [grid]);
  useEffect(() => {
    const updateQueue = updateQueueRef.current;
    if (updateQueue === undefined) return;
    void updateQueue
      .enqueue({
        anchor,
        direction,
        features,
        fontFixture,
        fontSize,
        language,
        layoutWidthRatio,
        text,
        textAlign,
        timelineTick,
        workload,
      })
      .then(({ input }) => publishSettledWorkload(input.workload))
      .catch(publishError);
  }, [
    anchor,
    direction,
    dpr,
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
    <SlugViewportChrome
      anchor={anchor}
      containerRef={containerRef}
      backend={backend}
      bakeProgressActive={bakeProgressActive}
      bakeProgressValue={bakeProgressValue}
      dpr={dpr}
      error={error}
      fontFixture={fontFixture}
      fontSize={fontSize}
      grid={grid}
      layoutWidthRatio={layoutWidthRatio}
      stats={stats}
      suppressLoading={suppressLoading}
      text={text}
      textAlign={textAlign}
      timelineTick={timelineTick}
      workload={workload}
      settledWorkload={settledWorkload}
    />
  );
}

function SlugViewportChrome({
  anchor,
  containerRef,
  backend,
  bakeProgressActive,
  bakeProgressValue,
  dpr,
  error,
  fontFixture,
  fontSize,
  grid,
  layoutWidthRatio,
  stats,
  suppressLoading,
  text,
  textAlign,
  timelineTick,
  workload,
  settledWorkload,
}: {
  readonly anchor: LiveTextConfiguration['anchor'];
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly backend: GraphicsBackend;
  readonly bakeProgressActive: boolean;
  readonly bakeProgressValue: ReturnType<typeof useBakeProgress>['value'];
  readonly dpr: 1 | 2;
  readonly error: string | undefined;
  readonly fontFixture: string;
  readonly fontSize: number;
  readonly grid: boolean;
  readonly layoutWidthRatio: number;
  readonly stats: SlugTextLiveStats | undefined;
  readonly suppressLoading: boolean;
  readonly text: string;
  readonly textAlign: LiveTextConfiguration['textAlign'];
  readonly timelineTick: number | undefined;
  readonly workload: BenchmarkWorkloadId;
  readonly settledWorkload: string | undefined;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-border"
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
      data-timeline-tick={timelineTick}
      data-testid="slug-live-viewport"
      data-workload={settledWorkload}
      data-presentation-pending={settledWorkload !== workload}
      ref={containerRef}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted"
        data-testid="canvas-render-status"
      >
        <span>
          SLUG ANALYTIC · {stats?.slugPageCount ?? '—'} PAGE{stats?.slugPageCount === 1 ? '' : 'S'} · {fontSize} CSS PX
          / {stats?.renderedPpem ?? '—'} DEVICE PX
        </span>
        <span>{dpr}× DPR</span>
      </div>
      {!suppressLoading && (stats === undefined || bakeProgressActive) && error === undefined && (
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
