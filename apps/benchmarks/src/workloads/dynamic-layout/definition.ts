import {
  fontSizeControl,
  layoutWidthControl,
  noControls,
  readyTechniques,
  reflowAmountControl,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const dynamicLayoutDefinition = {
  controls: {
    ...noControls,
    amount: reflowAmountControl,
    animation: true,
    fontSize: fontSizeControl,
    layoutBounds: true,
    layoutWidth: layoutWidthControl,
  },
  defaults: workloadDefaults(28, 32),
  description: 'Tests whether animated containers reflow text smoothly and correctly.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'dynamic-layout',
  interaction: { pan: true, zoom: false },
  label: 'Dynamic layout',
  preload: 'comparison-module',
  surface: 'comparison',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'dynamic-layout'>;
