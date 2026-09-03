import { Activity } from 'react';

import type { BenchmarkSummary, RunnerEvent } from '../../benchmark/contracts';
import type { BenchmarkFontFixture, SelectableFontFixture } from '../../benchmark/font-fixtures';
import type { LiveBenchmarkCapture } from '../../benchmark/product-result';
import {
  useRuntimeAnimationControls,
  useRuntimeLayoutControls,
  useRuntimePaintControls,
  useRuntimeTelemetry,
  useRuntimeViewControls,
  type RuntimeLiveStats,
} from '../../benchmark/runtime-world';
import type { HarnessLocation, RasterFormatName } from '../../benchmark/url-state';
import { workloadById, type ConformanceWorkloadId, type WorkloadOption } from '../../benchmark/workloads';
import type { PresentationPreset } from '../../benchmark/presentation-sequence';
import type { ConformanceView } from '../../components/render-controls';
import { Chip } from '../../components/ui';
import type { AdvancedShapingFrame } from '../../workloads/advanced-shaping/scene';
import type { BenchmarkWorkloadId } from '../../workloads/catalog';
import { BenchmarkSurface } from '../benchmark/benchmark-surface';
import { formatLabel } from '../benchmark/labels';
import { ConformanceSurface } from '../conformance/conformance-surface';

type ActivityWorkloads = {
  readonly benchmark: BenchmarkWorkloadId;
  readonly conformance: ConformanceWorkloadId;
};

function formatMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`;
}

export function SceneSuspenseFallback({ technique }: { readonly technique: RasterFormatName }) {
  return (
    <div
      className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-background"
      data-testid="scene-loading"
    >
      <div className="rounded-md border border-border bg-black/80 px-4 py-3 font-mono text-[10px] text-muted">
        Loading {formatLabel(technique)} scene…
      </div>
    </div>
  );
}

export function Scene({
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
  readonly onLiveStats: (stats: RuntimeLiveStats) => void;
}) {
  const { showGrid: grid, showLayoutBounds } = useRuntimeViewControls();
  const { fontSize, layoutWidthPercent, workloadAmount } = useRuntimeLayoutControls();
  const { animationEnabled, animationSpeed } = useRuntimeAnimationControls();
  const { paintOpacityPercent, paintShadowEnabled, paintStrokePercent } = useRuntimePaintControls();
  const { stats: liveStats } = useRuntimeTelemetry();
  const workload = workloadById(location.mode, location.workload);
  const benchmarkWorkload = workloadById('benchmark', activityWorkloads.benchmark);
  const benchmarkStatus = benchmarkWorkload.formats[location.technique];
  const conformanceWorkload = workloadById('conformance', activityWorkloads.conformance);
  const conformanceStatus = conformanceWorkload.formats[location.technique];
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
          <Chip tone="accent">{formatLabel(location.technique)}</Chip>
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

export function PlannedWorkloadSurface({
  milestone,
  technique,
  workload,
}: {
  readonly milestone: 8 | 9;
  readonly technique: RasterFormatName;
  readonly workload: WorkloadOption;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-md border border-border bg-panel p-8 text-center">
      <div className="max-w-md">
        <p className="eyebrow">Milestone {milestone}</p>
        <h2 className="mt-2 text-lg font-semibold">
          {formatLabel(technique)} · {workload.label}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{workload.description}</p>
      </div>
    </div>
  );
}
