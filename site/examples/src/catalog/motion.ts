import type { ExampleEntry } from './types';

/** Detached glyphs and kinetic showcases. */
export const MOTION = {
  'break-apart': {
    title: 'Break apart',
    page: '/docs/text/break-apart',
    aspect: '1 / 1',
    stage: {},
    load: () => import('../scenes/break-apart/scene'),
  },
  arc: {
    title: 'Text on a circle',
    page: '/docs/text/break-apart',
    aspect: '1 / 1',
    stage: {},
    load: () => import('../scenes/arc/scene'),
  },
  ribbon: {
    title: 'Ribbon',
    page: '/docs/text/break-apart',
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
    page: '/docs/text/text-and-groups',
    stage: { lit: true },
    load: () => import('../scenes/split-flap/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
