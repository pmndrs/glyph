import {
  fontSizeControl,
  layoutWidthControl,
  noControls,
  paintControls,
  readyTechniques,
  spanDensityAmountControl,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const richTextDefinition = {
  controls: {
    ...noControls,
    amount: spanDensityAmountControl,
    animation: true,
    fontSize: fontSizeControl,
    layoutWidth: layoutWidthControl,
    paint: paintControls,
  },
  defaults: workloadDefaults(20, 26),
  description: 'Tests composed spans that carry shaping data, not only paint.',
  // Order is the scene's contract: the foreign script the body face cannot shape, then the emphasis face it should not.
  fontPolicy: {
    companionFixtures: ['noto-sans-devanagari', 'source-serif-4'],
    defaultFixture: 'inter',
    kind: 'composed',
  },
  id: 'rich-text',
  interaction: { pan: true, zoom: false },
  label: 'Rich text spans',
  preload: 'comparison-module',
  surface: 'comparison',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'rich-text'>;
