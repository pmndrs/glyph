import {
  fontSizeControl,
  hueSpreadAmountControl,
  layoutWidthControl,
  noControls,
  paintControls,
  readyFormats,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const paintEffectsDefinition = {
  controls: {
    ...noControls,
    amount: hueSpreadAmountControl,
    animation: true,
    fontSize: fontSizeControl,
    layoutWidth: layoutWidthControl,
    paint: paintControls,
  },
  defaults: workloadDefaults(44, 52),
  description: 'Tests the live cost and visual quality of animated text effects.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'paint-effects',
  interaction: { pan: true, zoom: false },
  label: 'Paint & effects',
  preload: 'comparison-module',
  surface: 'comparison',
  formats: readyFormats,
} as const satisfies BenchmarkWorkloadDefinition<'paint-effects'>;
