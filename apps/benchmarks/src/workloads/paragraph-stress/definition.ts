import {
  fontSizeControl,
  layoutWidthControl,
  noControls,
  readyTechniques,
  textVolumeAmountControl,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const paragraphStressDefinition = {
  controls: {
    ...noControls,
    amount: textVolumeAmountControl,
    animation: true,
    fontSize: fontSizeControl,
    layoutWidth: layoutWidthControl,
  },
  defaults: workloadDefaults(20, 24, { workloadAmount: 100 }),
  description: 'Tests rendering cost as paragraphs, glyphs, and atlas pressure grow.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'paragraph-stress',
  interaction: { pan: true, zoom: false },
  label: 'Paragraph stress',
  preload: 'comparison-module',
  surface: 'comparison',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'paragraph-stress'>;
