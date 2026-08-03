import { noControls, readyTechniques, workloadDefaults, type BenchmarkWorkloadDefinition } from '../shared/definition';

export const textLadderDefinition = {
  controls: { ...noControls, animation: true },
  defaults: workloadDefaults(20, 24),
  description: 'Tests how text quality holds up from 8 to 1024 pixels.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'text-ladder',
  interaction: { pan: true, zoom: false },
  label: 'Text ladder',
  preload: 'comparison-module',
  surface: 'comparison',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'text-ladder'>;
