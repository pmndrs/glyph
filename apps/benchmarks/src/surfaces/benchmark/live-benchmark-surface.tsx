import type { ReactNode, RefObject } from 'react';

import type { RuntimeLiveStats } from '../../benchmark/runtime-world';
import { TelemetryCharts } from '../../components/telemetry-charts';
import { Metric } from '../../components/ui';
import type { AdvancedShapingFrame } from '../../workloads/advanced-shaping/scene';
import { benchmarkWorkloadDefinition, type BenchmarkWorkloadId } from '../../workloads/catalog';

export function LiveBenchmarkSurface({
  advanced,
  presentation,
  showcaseFrame,
  stats,
  surfaceAnchorRef,
  viewport,
  workload,
}: {
  readonly advanced: boolean;
  readonly presentation: 'main' | 'presentation';
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly stats: RuntimeLiveStats | undefined;
  readonly surfaceAnchorRef: RefObject<HTMLDivElement | null>;
  readonly viewport: ReactNode;
  readonly workload: BenchmarkWorkloadId;
}) {
  return (
    <div
      className={
        presentation === 'presentation'
          ? 'grid h-full min-h-0 grid-rows-[0_minmax(0,1fr)] overflow-hidden'
          : 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3'
      }
      data-advanced-case={advanced ? showcaseFrame.caseDefinition.id : undefined}
      data-advanced-progress={advanced ? showcaseFrame.progress : undefined}
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
          presentation === 'presentation'
            ? 'flex min-h-0 flex-col overflow-hidden'
            : 'flex min-h-0 flex-col rounded-md border border-border bg-surface p-3'
        }
      >
        <div className={presentation === 'main' ? 'mb-3 flex items-start justify-between gap-3' : 'hidden'}>
          {presentation === 'main' && (
            <>
              <div>
                <p className="eyebrow">Realtime scene</p>
                <p className="mt-1 text-xs text-muted">{workloadSceneDescription(workload, showcaseFrame)}</p>
              </div>
              <span className="shrink-0 font-mono text-[9px] text-success">LIVE</span>
            </>
          )}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden" ref={surfaceAnchorRef}>
          {viewport}
        </div>
      </div>
    </div>
  );
}

function workloadSceneDescription(workload: BenchmarkWorkloadId, showcaseFrame: AdvancedShapingFrame): string {
  return workload === 'advanced-shaping'
    ? `Tests whether ${showcaseFrame.caseDefinition.label.toLowerCase()} stay correct while the paragraph types and wraps.`
    : benchmarkWorkloadDefinition(workload).description;
}
