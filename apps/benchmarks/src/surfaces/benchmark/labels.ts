import type { RasterFormatName } from '../../benchmark/url-state';
import { benchmarkWorkloadDefinition, type BenchmarkWorkloadId } from '../../workloads/catalog';

export function formatLabel(technique: RasterFormatName): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

export function workloadAmountLabel(workload: BenchmarkWorkloadId, amount: number): string | undefined {
  const range = benchmarkWorkloadDefinition(workload).controls.amount;
  return range === undefined ? undefined : `${range.label} · ${amount}%`;
}
