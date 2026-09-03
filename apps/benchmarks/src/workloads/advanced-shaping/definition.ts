import {
  fontSizeControl,
  noControls,
  readyFormats,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const advancedShapingDefinition = {
  controls: { ...noControls, fontSize: fontSizeControl },
  defaults: workloadDefaults(20, 48),
  description: 'Tests whether complex text stays correct as it types and wraps.',
  fontPolicy: { kind: 'advanced-case', defaultFixture: 'noto-sans-cjk-showcase' },
  id: 'advanced-shaping',
  interaction: { pan: true, zoom: false },
  label: 'Advanced shaping',
  preload: 'format-module',
  surface: 'advanced-shaping',
  formats: readyFormats,
} as const satisfies BenchmarkWorkloadDefinition<'advanced-shaping'>;
