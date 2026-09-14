import type { BenchmarkFontFixture } from '../../benchmark/font-fixtures';
import {
  useRuntimeAnimationControls,
  useRuntimeLayoutControls,
  useRuntimePaintControls,
  useRuntimeTelemetry,
  useRuntimeViewControls,
  type RuntimeLiveStats,
} from '../../benchmark/runtime-world';
import type { HarnessLocation, RasterFormatName } from '../../benchmark/url-state';
import type { PresentationPreset } from '../../benchmark/presentation-sequence';
import { Chip } from '../../components/ui';
import type { AdvancedShapingFrame } from '../../workloads/advanced-shaping/scene';
import { benchmarkWorkloadDefinition } from '../../workloads/catalog';
import { BenchmarkSurface } from '../benchmark/benchmark-surface';
import { formatLabel } from '../benchmark/labels';

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
  dpr,
  error,
  location,
  demoMode,
  presentation,
  presentationPreset,
  showcaseFrame,
  onLiveStats,
}: {
  readonly activeFontFixture: BenchmarkFontFixture;
  readonly dpr: 1 | 2;
  readonly error: string | undefined;
  readonly location: HarnessLocation;
  readonly demoMode: boolean;
  readonly presentation: 'main' | 'presentation';
  readonly presentationPreset: PresentationPreset | undefined;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly onLiveStats: (stats: RuntimeLiveStats) => void;
}) {
  const { showGrid: grid, showLayoutBounds } = useRuntimeViewControls();
  const { fontSize, layoutWidthPercent, workloadAmount } = useRuntimeLayoutControls();
  const { animationEnabled, animationSpeed } = useRuntimeAnimationControls();
  const { paintOpacityPercent, paintShadowEnabled, paintStrokePercent } = useRuntimePaintControls();
  const { stats: liveStats } = useRuntimeTelemetry();
  const workload = benchmarkWorkloadDefinition(location.workload);
  const benchmarkSurface = (
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
      workload={location.workload}
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
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3" data-testid="scene">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="eyebrow">Live benchmark</p>
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
      <div className="contents">{benchmarkSurface}</div>
      {error !== undefined && (
        <div className="rounded-md border border-danger/50 bg-danger/10 p-3 text-xs text-danger">{error}</div>
      )}
    </section>
  );
}
