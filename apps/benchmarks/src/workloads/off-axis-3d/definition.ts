import {
  fontSizeControl,
  noControls,
  offAxisLayoutWidthControl,
  perspectiveAmountControl,
  readyTechniques,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const offAxis3dDefinition = {
  controls: {
    ...noControls,
    amount: perspectiveAmountControl,
    animation: true,
    fontSize: fontSizeControl,
    layoutWidth: offAxisLayoutWidthControl,
  },
  defaults: workloadDefaults(96, 96, { layoutWidthPercent: 120, workloadAmount: 100 }),
  description: 'Tests text quality and cost at steep, moving viewing angles.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'off-axis-3d',
  interaction: { pan: true, zoom: true },
  label: 'Off-axis / 3D',
  preload: 'comparison-module',
  surface: 'comparison',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'off-axis-3d'>;
