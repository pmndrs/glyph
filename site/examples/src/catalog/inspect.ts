import type { ExampleEntry } from './types';

/** Measurement and glyph inspection. */
export const INSPECT = {
  measurement: {
    title: 'Measurement',
    page: '/docs/text/measurement',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/measurement/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
