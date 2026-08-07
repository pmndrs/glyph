import { dynamicLayoutWorkload } from '../dynamic-layout/scene';
import { iconGridWorkload } from '../icon-grid/scene';
import { offAxis3dWorkload } from '../off-axis-3d/scene';
import { paintEffectsWorkload } from '../paint-effects/scene';
import { paragraphStressWorkload } from '../paragraph-stress/scene';
import { richTextWorkload } from '../rich-text/scene';
import { textLadderWorkload } from '../text-ladder/scene';
import { zoomTextWorkload } from '../zoom-text/scene';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition, ComparisonWorkloadId } from './contracts';

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
  'rich-text': richTextWorkload,
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
