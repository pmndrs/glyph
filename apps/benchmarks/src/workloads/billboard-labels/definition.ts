import {
  noControls,
  labelDensityAmountControl,
  readyFormats,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const billboardLabelsDefinition = {
  controls: { ...noControls, animation: true, amount: labelDensityAmountControl },
  defaults: workloadDefaults(14, 18),
  description:
    'Orbits a camera around billboarded labels scattered in depth, resorting them front to back every frame.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'billboard-labels',
  interaction: { pan: false, zoom: false },
  label: 'Billboard labels',
  preload: 'comparison-module',
  surface: 'comparison',
  formats: readyFormats,
} as const satisfies BenchmarkWorkloadDefinition<'billboard-labels'>;
