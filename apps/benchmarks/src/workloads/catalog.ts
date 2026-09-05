import { advancedShapingDefinition } from './advanced-shaping/definition';
import { benchmarkIpsumDefinition } from './benchmark-ipsum/definition';
import { billboardLabelsDefinition } from './billboard-labels/definition';
import type { ComparisonWorkloadId } from './comparison/contracts';
import { dynamicLayoutDefinition } from './dynamic-layout/definition';
import { editorialDefinition } from './editorial/definition';
import { iconGridDefinition } from './icon-grid/definition';
import { offAxis3dDefinition } from './off-axis-3d/definition';
import { paintEffectsDefinition } from './paint-effects/definition';
import { paragraphStressDefinition } from './paragraph-stress/definition';
import { richTextDefinition } from './rich-text/definition';
import { textLadderDefinition } from './text-ladder/definition';
import { zoomTextDefinition } from './zoom-text/definition';

export type {
  BenchmarkWorkloadDefinition,
  LiveWorkloadPreloadKind,
  LiveWorkloadSurfaceKind,
  WorkloadControls,
  WorkloadFontPolicy,
  WorkloadInteraction,
  WorkloadPaintControls,
  WorkloadRange,
  WorkloadRuntimeDefaults,
} from './shared/definition';
import type { BenchmarkWorkloadDefinition } from './shared/definition';

/** Every runnable live example, including the two retained single-paragraph scenes. */
export type BenchmarkWorkloadId = 'benchmark-ipsum' | 'advanced-shaping' | ComparisonWorkloadId;

/** The one complete route catalog; each value is declared beside its authored workload scene, this file only preserves application order and lookup. */
export const BENCHMARK_WORKLOADS = {
  'benchmark-ipsum': benchmarkIpsumDefinition,
  'advanced-shaping': advancedShapingDefinition,
  'text-ladder': textLadderDefinition,
  'billboard-labels': billboardLabelsDefinition,
  'zoom-text': zoomTextDefinition,
  'icon-grid': iconGridDefinition,
  'off-axis-3d': offAxis3dDefinition,
  'dynamic-layout': dynamicLayoutDefinition,
  'paragraph-stress': paragraphStressDefinition,
  'paint-effects': paintEffectsDefinition,
  'rich-text': richTextDefinition,
  editorial: editorialDefinition,
} as const satisfies Record<BenchmarkWorkloadId, BenchmarkWorkloadDefinition>;

export const BENCHMARK_WORKLOAD_IDS = Object.freeze(Object.keys(BENCHMARK_WORKLOADS) as readonly BenchmarkWorkloadId[]);

export function benchmarkWorkloadDefinition(workload: BenchmarkWorkloadId): BenchmarkWorkloadDefinition {
  return BENCHMARK_WORKLOADS[workload];
}

export function comparisonWorkloadId(workload: BenchmarkWorkloadId): ComparisonWorkloadId | undefined {
  return benchmarkWorkloadDefinition(workload).surface === 'comparison'
    ? (workload as ComparisonWorkloadId)
    : undefined;
}

export function isBenchmarkWorkloadId(value: string): value is BenchmarkWorkloadId {
  return Object.hasOwn(BENCHMARK_WORKLOADS, value);
}
