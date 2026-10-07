import { OUTLINED_INTER_FIXTURE } from '../../benchmark/font-fixtures';
import {
  fontSizeControl,
  layoutWidthControl,
  noControls,
  readyFormats,
  workloadDefaults,
  type BenchmarkWorkloadDefinition,
  type WorkloadRange,
} from '../shared/definition';

export const glyphCountAmountControl = {
  label: 'Glyph count',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

export const glyphPhysicsDefinition = {
  controls: {
    ...noControls,
    amount: glyphCountAmountControl,
    animation: true,
    colliders: true,
    fontSize: fontSizeControl,
    layoutWidth: layoutWidthControl,
  },
  defaults: workloadDefaults(20, 28, { workloadAmount: 30 }),
  description:
    'Breaks a paragraph into glyphs and drops them as rigid bodies whose colliders are built from the glyph outlines.',
  // The text runs on the outlined Inter fixture, which only baked delivery can supply; the selectable fonts have no outlines.
  fontPolicy: { companionFixtures: [OUTLINED_INTER_FIXTURE], defaultFixture: 'inter', kind: 'fixed' },
  id: 'glyph-physics',
  interaction: { pan: false, zoom: false },
  label: 'Glyph physics',
  preload: 'comparison-module',
  surface: 'comparison',
  formats: readyFormats,
} as const satisfies BenchmarkWorkloadDefinition<'glyph-physics'>;
