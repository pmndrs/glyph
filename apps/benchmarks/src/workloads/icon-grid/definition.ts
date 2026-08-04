import {
  iconSizeControl,
  noControls,
  readyTechniques,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
} from '../shared/definition';
import { ICON_GRID_FONT_FIXTURE } from '../../benchmark/font-fixtures';

export const iconGridDefinition = {
  controls: { ...noControls, animation: true, fontSize: iconSizeControl },
  defaults: workloadDefaults(56, 64),
  description: 'Tests a labeled icon font across scale, movement, and raster techniques.',
  fontPolicy: { iconFixture: ICON_GRID_FONT_FIXTURE, kind: 'icon-grid', labelDefaultFixture: 'inter' },
  id: 'icon-grid',
  interaction: { pan: true, zoom: false },
  label: 'Icon grid',
  preload: 'comparison-module',
  surface: 'comparison',
  techniques: readyTechniques,
} as const satisfies BenchmarkWorkloadDefinition<'icon-grid'>;
