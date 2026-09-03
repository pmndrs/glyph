import type { HarnessMode, RasterFormatName } from './url-state';
import { BENCHMARK_WORKLOAD_IDS, BENCHMARK_WORKLOADS, type BenchmarkWorkloadId } from '../workloads/catalog';

export type ConformanceWorkloadId =
  | 'mtsdf-slug-compare'
  | 'runtime-fallback'
  | 'text-accuracy'
  | 'cross-technique-fidelity';

export interface WorkloadOption<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly formats: Readonly<Record<RasterFormatName, WorkloadFormatStatus>>;
}

export interface WorkloadScrollEdges {
  readonly before: boolean;
  readonly after: boolean;
}

type WorkloadFormatStatus = { readonly kind: 'ready' } | { readonly kind: 'planned'; readonly milestone: 8 | 9 };

const READY: WorkloadFormatStatus = { kind: 'ready' };

const benchmarkWorkloads: readonly WorkloadOption<BenchmarkWorkloadId>[] = BENCHMARK_WORKLOAD_IDS.map(
  (id) => BENCHMARK_WORKLOADS[id],
);

const conformanceWorkloads: readonly WorkloadOption<ConformanceWorkloadId>[] = [
  {
    id: 'mtsdf-slug-compare',
    label: 'MSDF / Slug compare',
    description: 'Renders MSDF and Slug side by side and compares their coverage in a live GPU heatmap.',
    formats: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'runtime-fallback',
    label: 'Runtime fallback parity',
    description: 'Tests whether source-font runtime baking reproduces the checked-in baked render.',
    formats: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'text-accuracy',
    label: 'Pipeline accuracy',
    description: 'Raster-format-specific renderer output, sampling reference, difference, and error statistics.',
    formats: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'cross-technique-fidelity',
    label: 'Cross-technique fidelity',
    description: 'Bitmap, MSDF, and Slug compared independently with the same outline-derived coverage reference.',
    formats: { bitmap: READY, mtsdf: READY, slug: READY },
  },
];

export function workloadScrollEdges({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}): WorkloadScrollEdges {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  return {
    before: scrollTop > 0.5,
    after: scrollTop < maximumScrollTop - 0.5,
  };
}

export function workloadsFor(mode: 'benchmark'): readonly WorkloadOption<BenchmarkWorkloadId>[];
export function workloadsFor(mode: 'conformance'): readonly WorkloadOption<ConformanceWorkloadId>[];
export function workloadsFor(mode: HarnessMode): readonly WorkloadOption<BenchmarkWorkloadId | ConformanceWorkloadId>[];
export function workloadsFor(
  mode: HarnessMode,
): readonly WorkloadOption<BenchmarkWorkloadId | ConformanceWorkloadId>[] {
  return mode === 'benchmark' ? benchmarkWorkloads : conformanceWorkloads;
}

export function workloadById(mode: 'benchmark', id: string): WorkloadOption<BenchmarkWorkloadId>;
export function workloadById(mode: 'conformance', id: string): WorkloadOption<ConformanceWorkloadId>;
export function workloadById(
  mode: HarnessMode,
  id: string,
): WorkloadOption<BenchmarkWorkloadId | ConformanceWorkloadId>;
export function workloadById(
  mode: HarnessMode,
  id: string,
): WorkloadOption<BenchmarkWorkloadId | ConformanceWorkloadId> {
  const workloads = workloadsFor(mode);
  return workloads.find((workload) => workload.id === id) ?? workloads[0]!;
}

export function isConformanceWorkloadId(value: string): value is ConformanceWorkloadId {
  return conformanceWorkloads.some(({ id }) => id === value);
}
