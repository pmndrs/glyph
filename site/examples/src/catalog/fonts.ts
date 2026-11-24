import type { ExampleEntry } from './types';

/** Raster formats, shaping and font selection. */
export const FONTS = {
  techniques: {
    title: 'Raster formats',
    page: '/docs/fonts/techniques',
    aspect: '3 / 2',
    stage: {},
    load: () => import('../scenes/techniques/scene'),
  },
  'text-ladder': {
    title: 'Text ladder',
    page: '/docs/fonts/techniques',
    aspect: '3 / 4',
    stage: { orthographic: true },
    load: () => import('../scenes/text-ladder/scene'),
  },
  zoom: {
    title: 'Zoom',
    page: '/docs/fonts/techniques',
    aspect: '3 / 2',
    stage: { orthographic: true },
    load: () => import('../scenes/zoom/scene'),
  },
  'slug-anatomy': {
    title: 'Slug anatomy',
    page: '/docs/fonts/techniques',
    stage: {},
    load: () => import('../scenes/slug-anatomy/scene'),
  },
  shaping: {
    title: 'Shaping',
    page: '/docs/advanced/how-it-works',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/shaping/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
