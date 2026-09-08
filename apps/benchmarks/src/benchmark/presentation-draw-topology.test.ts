import { describe, expect, it } from 'vitest';

import type { ComparisonWorkloadId } from '../workloads/comparison/contracts';
import { assertPresentationDrawTopology } from './presentation-draw-topology';

describe('Presentation draw topology', () => {
  it.each([
    ['icon-grid', 2],
    ['billboard-labels', 1],
    ['paragraph-stress', 1],
    ['rich-text', 5],
    ['editorial', 3],
  ] satisfies ReadonlyArray<readonly [ComparisonWorkloadId, number]>)('pins %s at %i draws', (workload, drawCount) => {
    expect(() => assertPresentationDrawTopology(workload, drawCount)).not.toThrow();
    expect(() => assertPresentationDrawTopology(workload, drawCount + 1)).toThrow(
      `${workload} expected ${String(drawCount)} draws, received ${String(drawCount + 1)}`,
    );
  });

  it.each([
    'text-ladder',
    'zoom-text',
    'off-axis-3d',
    'dynamic-layout',
    'paint-effects',
  ] satisfies readonly ComparisonWorkloadId[])(
    'keeps %s inside the established one-to-three draw envelope',
    (workload) => {
      expect(() => assertPresentationDrawTopology(workload, 1)).not.toThrow();
      expect(() => assertPresentationDrawTopology(workload, 3)).not.toThrow();
      expect(() => assertPresentationDrawTopology(workload, 0)).toThrow(`${workload} expected 1–3 draws, received 0`);
      expect(() => assertPresentationDrawTopology(workload, 4)).toThrow(`${workload} expected 1–3 draws, received 4`);
    },
  );
});
