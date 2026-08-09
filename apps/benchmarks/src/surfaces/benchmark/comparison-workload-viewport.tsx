import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';

import { liveWorkloadFontFixtures, type BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { RuntimeLiveStats } from '../../benchmark/runtime-world';
import type { FontDelivery, GraphicsBackend, RasterTechnique } from '../../benchmark/url-state';
import type { PresentationPreset } from '../../benchmark/presentation-sequence';
import { BENCHMARK_CONTENT_INSET, BENCHMARK_CONTENT_MINIMUM_VIEWPORT_WIDTH } from '../../workloads/shared/text-style';

import { benchmarkWorkloadDefinition } from '../../workloads/catalog';
import type {
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadId,
  ComparisonWorkloadPersistentScene,
  ComparisonWorkloadStats,
} from './scenes/comparison-workload';
import { usePersistentRenderHost } from '../../renderer/persistent-render-host-context';
import { BakeProgressOverlay, useBakeProgress } from './bake-progress-overlay';
import { techniqueLabel, workloadAmountLabel } from './labels';
import { preloadComparisonWorkload } from './scene-preload';

export interface ComparisonWorkloadViewportProps {
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
  readonly onStats: (stats: RuntimeLiveStats) => void;
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

export function ComparisonWorkloadViewport({
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
}: ComparisonWorkloadViewportProps) {
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
    if (next.workload === workload && next.appliedFontFixture === fontFixture) setError(undefined);
  });
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    finishBakeProgress();
    console.error('comparison workload update failed', caught);
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
    // Applied immediately. The paragraph-stress motion drives width and font size through this same path on its own
    // animation frames, so delaying here would stall the workload rather than settle an input. Debouncing belongs on
    // the controls a person drags, not on the path an animation shares with them.
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
