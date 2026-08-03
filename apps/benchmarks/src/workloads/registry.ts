import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition, ComparisonWorkloadId } from './contracts';
import { dynamicLayoutWorkload } from './dynamic-layout';
import { iconGridWorkload } from './icon-grid';
import { offAxis3dWorkload } from './off-axis-3d';
import { paintEffectsWorkload } from './paint-effects';
import { paragraphStressWorkload } from './paragraph-stress';
import { textLadderWorkload } from './text-ladder';
import { zoomTextWorkload } from './zoom-text';

/**
 * The one complete map from a comparison workload ID to its canonical example.
 * Keep host ownership outside this registry: a workload may define scene content
 * without being allowed to allocate a renderer, canvas, RAF loop, or telemetry.
 */
export const COMPARISON_WORKLOADS = {
  'text-ladder': textLadderWorkload,
  'zoom-text': zoomTextWorkload,
  'icon-grid': iconGridWorkload,
  'off-axis-3d': offAxis3dWorkload,
  'dynamic-layout': dynamicLayoutWorkload,
  'paragraph-stress': paragraphStressWorkload,
  'paint-effects': paintEffectsWorkload,
} satisfies Record<ComparisonWorkloadId, ComparisonWorkloadDefinition>;

export const COMPARISON_WORKLOAD_IDS = Object.freeze(
  Object.keys(COMPARISON_WORKLOADS) as readonly ComparisonWorkloadId[],
);

export function comparisonWorkloadDefinition(workload: ComparisonWorkloadId): ComparisonWorkloadDefinition {
  return COMPARISON_WORKLOADS[workload];
}

export function comparisonWorkloadUpdateKind(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
): 'rebuild' | 'retained' {
  if (previous.workload !== next.workload) return 'rebuild';
  return comparisonWorkloadDefinition(next.workload).updateKind(previous, next);
}

export function comparisonWorkloadRequiresIconWindowSuspension(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
): boolean {
  return (
    comparisonWorkloadDefinition(previous.workload).suspendsIconWindow ||
    comparisonWorkloadDefinition(next.workload).suspendsIconWindow
  );
}
