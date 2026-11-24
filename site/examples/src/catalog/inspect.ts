import type { ExampleEntry } from './types';

/** Measurement and glyph inspection. */
export const INSPECT = {
  measurement: {
    title: 'Measurement',
    page: '/docs/guides/inspect/measure-text',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/measurement/scene'),
  },
  'inspect-line-metrics': {
    title: 'Line metrics',
    page: '/docs/guides/inspect/measure-text',
    stage: {},
    load: () => import('../scenes/inspect-line-metrics/scene'),
  },
  'inspect-glyphs': {
    title: 'Glyph advance and ink boxes',
    page: '/docs/guides/inspect/read-glyphs',
    stage: {},
    load: () => import('../scenes/inspect-glyphs/scene'),
  },
  'inspect-outlines': {
    title: 'Glyph outlines',
    page: '/docs/guides/inspect/glyph-outlines',
    stage: {},
    load: () => import('../scenes/inspect-outlines/scene'),
  },
  'inspect-on-layout': {
    title: 'A panel sized in onLayout',
    page: '/docs/guides/inspect/react-to-layout',
    stage: {},
    load: () => import('../scenes/inspect-on-layout/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
