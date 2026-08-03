import { describe, expect, it } from 'vitest';

import { COMPARISON_WORKLOAD_IDS, COMPARISON_WORKLOADS, comparisonWorkloadDefinition } from './registry';

describe('comparison workload registry', () => {
  it('owns every retained comparison example exactly once', () => {
    expect(COMPARISON_WORKLOAD_IDS).toEqual([
      'text-ladder',
      'zoom-text',
      'icon-grid',
      'off-axis-3d',
      'dynamic-layout',
      'paragraph-stress',
      'paint-effects',
    ]);
    expect(Object.values(COMPARISON_WORKLOADS).map(({ id }) => id)).toEqual(COMPARISON_WORKLOAD_IDS);
  });

  it('gives every example one host-safe update, camera, and content-width policy', () => {
    for (const id of COMPARISON_WORKLOAD_IDS) {
      const definition = comparisonWorkloadDefinition(id);
      expect(definition.id).toBe(id);
      expect(['orthographic', 'perspective']).toContain(definition.cameraKind);
      expect(definition.contentWidth === 'none' || typeof definition.contentWidth === 'object').toBe(true);
      expect(typeof definition.updateKind).toBe('function');
    }
  });
});
