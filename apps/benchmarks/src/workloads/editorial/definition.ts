import {
  fontSizeControl,
  layoutWidthControl,
  noControls,
  readyFormats,
  textVolumeAmountControl,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const editorialDefinition = {
  controls: {
    ...noControls,
    amount: textVolumeAmountControl,
    animation: true,
    fontSize: fontSizeControl,
    layoutWidth: layoutWidthControl,
  },
  defaults: workloadDefaults(20, 24),
  description: 'Justified editorial columns exercising indent, paragraph spacing, and word-space bounds.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'editorial',
  interaction: { pan: true, zoom: false },
  label: 'Editorial',
  preload: 'comparison-module',
  surface: 'comparison',
  formats: readyFormats,
} as const satisfies BenchmarkWorkloadDefinition<'editorial'>;
