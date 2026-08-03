import { use, useEffect, useRef } from 'react';

import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import type { RuntimeLiveStats } from '../../benchmark/runtime-world';
import type { FontDelivery, GraphicsBackend, RasterTechnique } from '../../benchmark/url-state';
import type { PresentationPreset } from '../../benchmark/presentation-sequence';
import { comparisonWorkloadId, type BenchmarkWorkloadId } from '../../workloads/catalog';
import type { AdvancedShapingFrame } from '../../workloads/advanced-shaping/scene';
import type { ComparisonWorkloadStats } from '../../workloads/comparison/scene';
import type { LiveTextScene } from '../../workloads/live-text-scene';
import { liveTextSceneForWorkload } from '../../workloads/live-text-scenes';
import { BitmapTextViewport } from './bitmap-text-viewport';
import { ComparisonWorkloadViewport } from './comparison-workload-viewport';
import type { LiveTextConfiguration } from './live-text-viewport-contracts';
import { LiveBenchmarkSurface } from './live-benchmark-surface';
import { MtsdfTextViewport, SlugTextViewport } from './sdf-text-viewports';
import { liveSceneAssetResource, scheduleComparisonWorkloadPreload } from './scene-preload';

export interface BenchmarkSurfaceProps {
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
  readonly stats: RuntimeLiveStats | undefined;
  readonly technique: RasterTechnique;
  readonly workload: BenchmarkWorkloadId;
  readonly onStats: (stats: RuntimeLiveStats) => void;
}

export function BenchmarkSurface({
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
}: BenchmarkSurfaceProps) {
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

function isComparisonWorkloadStats(stats: RuntimeLiveStats | undefined): stats is ComparisonWorkloadStats {
  return stats !== undefined && 'workload' in stats;
}
