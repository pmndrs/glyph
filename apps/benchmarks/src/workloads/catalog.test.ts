import { describe, expect, it } from 'vitest';

import { workloadsFor } from '../benchmark/workloads';
import { COMPARISON_WORKLOAD_IDS } from './comparison/registry';
import {
  BENCHMARK_WORKLOAD_IDS,
  BENCHMARK_WORKLOADS,
  benchmarkWorkloadDefinition,
  isBenchmarkWorkloadId,
} from './catalog';

describe('benchmark workload catalog', () => {
  it('owns every live workload exactly once and preserves the current rail order', () => {
    expect(BENCHMARK_WORKLOAD_IDS).toEqual(workloadsFor('benchmark').map(({ id }) => id));
    expect(BENCHMARK_WORKLOAD_IDS).toEqual([
      'benchmark-ipsum',
      'advanced-shaping',
      'text-ladder',
      'zoom-text',
      'icon-grid',
      'off-axis-3d',
      'dynamic-layout',
      'paragraph-stress',
      'paint-effects',
    ]);
    expect(BENCHMARK_WORKLOAD_IDS.filter((id) => BENCHMARK_WORKLOADS[id].surface === 'comparison')).toEqual(
      COMPARISON_WORKLOAD_IDS,
    );
  });

  it('projects the current workload labels and descriptions without a second catalog', () => {
    expect(workloadsFor('benchmark').map(({ description, id, label }) => ({ description, id, label }))).toEqual(
      BENCHMARK_WORKLOAD_IDS.map((id) => {
        const definition = benchmarkWorkloadDefinition(id);
        return { description: definition.description, id: definition.id, label: definition.label };
      }),
    );
  });

  it('records complete reset defaults for both layouts', () => {
    expect(benchmarkWorkloadDefinition('benchmark-ipsum').defaults).toEqual({
      main: {
        animationEnabled: true,
        animationSpeed: 50,
        fontSize: 20,
        layoutWidthPercent: 82,
        paintOpacityPercent: 100,
        paintShadowEnabled: false,
        paintStrokePercent: 0,
        showGrid: true,
        showLayoutBounds: true,
        workloadAmount: 50,
      },
      presentation: {
        animationEnabled: true,
        animationSpeed: 50,
        fontSize: 24,
        layoutWidthPercent: 82,
        paintOpacityPercent: 100,
        paintShadowEnabled: false,
        paintStrokePercent: 0,
        showGrid: true,
        showLayoutBounds: true,
        workloadAmount: 50,
      },
    });
    expect(benchmarkWorkloadDefinition('off-axis-3d').defaults).toMatchObject({
      main: { fontSize: 96, layoutWidthPercent: 120, workloadAmount: 100 },
      presentation: { fontSize: 96, layoutWidthPercent: 120, workloadAmount: 100 },
    });
    expect(benchmarkWorkloadDefinition('icon-grid').defaults).toMatchObject({
      main: { fontSize: 56 },
      presentation: { fontSize: 64 },
    });
    expect(benchmarkWorkloadDefinition('advanced-shaping').defaults.presentation.fontSize).toBe(48);
    expect(benchmarkWorkloadDefinition('advanced-shaping').controls.layoutWidth).toBeUndefined();
    expect(benchmarkWorkloadDefinition('paragraph-stress').defaults.main.workloadAmount).toBe(100);
    expect(benchmarkWorkloadDefinition('paint-effects').defaults.presentation.fontSize).toBe(52);
  });

  it('makes font, interaction, and control capabilities explicit', () => {
    expect(benchmarkWorkloadDefinition('zoom-text')).toMatchObject({
      fontPolicy: { defaultFixture: 'inter', kind: 'fixed' },
      interaction: { pan: false, zoom: false },
    });
    expect(benchmarkWorkloadDefinition('icon-grid')).toMatchObject({
      controls: { fontSize: { maximum: 1_024, minimum: 8, scale: 'logarithmic' } },
      fontPolicy: { iconFixture: 'font-awesome-free-6.7.2', kind: 'icon-grid', labelDefaultFixture: 'inter' },
    });
    expect(benchmarkWorkloadDefinition('off-axis-3d')).toMatchObject({
      controls: {
        amount: { label: 'Perspective intensity' },
        layoutWidth: { maximum: 200 },
      },
      interaction: { pan: true, zoom: true },
    });
    expect(benchmarkWorkloadDefinition('paint-effects').controls.paint).toEqual({
      opacity: { label: 'Opacity', maximum: 100, minimum: 0, scale: 'linear', step: 1 },
      shadowTechniques: ['mtsdf'],
      strokeTechniques: ['mtsdf'],
    });
  });

  it('narrows a route candidate to one declared benchmark workload', () => {
    expect(isBenchmarkWorkloadId('text-ladder')).toBe(true);
    expect(isBenchmarkWorkloadId('text-accuracy')).toBe(false);
  });
});
