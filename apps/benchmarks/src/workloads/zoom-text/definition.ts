import { noControls, readyFormats, workloadDefaults, type BenchmarkWorkloadDefinition } from '../shared/definition';

export const zoomTextDefinition = {
  controls: { ...noControls, animation: true },
  defaults: workloadDefaults(20, 24),
  description: 'Cycles through translations of “Shape” while scaling from 8 pt to the largest size that fits.',
  fontPolicy: { kind: 'fixed', defaultFixture: 'inter' },
  id: 'zoom-text',
  interaction: { pan: false, zoom: false },
  label: 'Zoom text',
  preload: 'comparison-module',
  surface: 'comparison',
  formats: readyFormats,
} as const satisfies BenchmarkWorkloadDefinition<'zoom-text'>;
