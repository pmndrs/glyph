import type { ComparisonWorkloadId } from '../workloads/comparison/contracts';

const exactDrawCounts: Partial<Record<ComparisonWorkloadId, number>> = {
  'billboard-labels': 1,
  editorial: 3,
  'icon-grid': 2,
  'paragraph-stress': 1,
  'rich-text': 5,
};

/** Enforces the retained draw topology shared by the TSL and TypeGPU Presentation matrices. */
export function assertPresentationDrawTopology(workload: ComparisonWorkloadId, drawCount: number): void {
  const exactDrawCount = exactDrawCounts[workload];
  if (exactDrawCount !== undefined) {
    if (drawCount !== exactDrawCount) {
      throw new Error(`${workload} expected ${String(exactDrawCount)} draws, received ${String(drawCount)}`);
    }
    return;
  }
  if (!Number.isSafeInteger(drawCount) || drawCount < 1 || drawCount > 3) {
    throw new Error(`${workload} expected 1–3 draws, received ${String(drawCount)}`);
  }
}
