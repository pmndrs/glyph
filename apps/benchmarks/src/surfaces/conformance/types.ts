import type { BenchmarkSummary, RunnerEvent } from '../../benchmark/contracts';
import type { SelectableFontFixture } from '../../benchmark/font-fixtures';
import type { ConformanceWorkloadId } from '../../benchmark/workloads';
import type { GraphicsBackend, RasterFormatName } from '../../benchmark/url-state';
import type { ConformanceView } from '../../components/render-controls';

export interface ConformanceSurfaceProps {
  readonly backend: GraphicsBackend;
  readonly comparisonText: string;
  readonly conformanceView: ConformanceView;
  readonly dpr: 1 | 2;
  readonly event: RunnerEvent | undefined;
  readonly fontFixture: SelectableFontFixture;
  readonly summary: BenchmarkSummary | undefined;
  readonly technique: RasterFormatName;
  readonly workload: ConformanceWorkloadId;
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void;
  readonly onZoom: (zoom: number) => void;
}
