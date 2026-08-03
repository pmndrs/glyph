import {
  fontSizeControl,
  layoutWidthControl,
  noControls,
  readyTechniques,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';

export const benchmarkIpsumDefinition = {
  controls: { ...noControls, fontSize: fontSizeControl, layoutWidth: layoutWidthControl },
  defaults: workloadDefaults(20, 24),
  description: 'Tests the everyday cost of rendering and reflowing a full paragraph.',
  fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
  id: 'benchmark-ipsum',
  interaction: { pan: true, zoom: false },
  label: 'Benchmark ipsum',
  preload: 'technique-module',
  surface: 'single-paragraph',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'benchmark-ipsum'>;
