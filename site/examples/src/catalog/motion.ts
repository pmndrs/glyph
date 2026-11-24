import type { ExampleEntry } from './types';

/** Detached glyphs and kinetic showcases. */
export const MOTION = {
  'break-apart': {
    title: 'Break apart',
    page: '/docs/guides/scene/animate-glyphs',
    aspect: '1 / 1',
    stage: {},
    load: () => import('../scenes/break-apart/scene'),
  },
  arc: {
    title: 'Text on a circle',
    page: '/docs/guides/scene/animate-glyphs',
    aspect: '1 / 1',
    stage: {},
    load: () => import('../scenes/arc/scene'),
  },
  ribbon: {
    title: 'Ribbon',
    page: '/docs/guides/scene/animate-glyphs',
    stage: {},
    load: () => import('../scenes/ribbon/scene'),
  },
  kinetic: {
    title: 'Kinetic typography',
    page: '/docs/getting-started/examples',
    stage: {},
    load: () => import('../scenes/kinetic/scene'),
  },
  'split-flap': {
    title: 'Split-flap board',
    page: '/docs/getting-started/examples',
    stage: { lit: true },
    load: () => import('../scenes/split-flap/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
