import type { ExampleEntry } from './types';

/** Raster formats, shaping and font selection. */
export const FONTS = {
  techniques: {
    title: 'Raster formats',
    page: '/docs/explanation/formats',
    aspect: '3 / 2',
    stage: {},
    load: () => import('../scenes/techniques/scene'),
  },
  'text-ladder': {
    title: 'Text ladder',
    page: '/docs/explanation/formats',
    aspect: '3 / 4',
    stage: { orthographic: true },
    load: () => import('../scenes/text-ladder/scene'),
  },
  zoom: {
    title: 'Zoom',
    page: '/docs/explanation/formats',
    aspect: '3 / 2',
    stage: { orthographic: true },
    load: () => import('../scenes/zoom/scene'),
  },
  'slug-anatomy': {
    title: 'Slug anatomy',
    page: '/docs/explanation/formats',
    stage: {},
    load: () => import('../scenes/slug-anatomy/scene'),
  },
  shaping: {
    title: 'Shaping',
    page: '/docs/explanation/how-it-works',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/shaping/scene'),
  },
  'fonts-fallback': {
    title: 'Fallback stack',
    page: '/docs/guides/fonts/fallback-stacks',
    stage: {},
    load: () => import('../scenes/fonts-fallback/scene'),
  },
  'fonts-icons': {
    title: 'Icon fonts',
    page: '/docs/guides/fonts/icons',
    stage: {},
    load: () => import('../scenes/fonts-icons/scene'),
  },
  'fonts-bitmap-strikes': {
    title: 'Bitmap strikes and pixel snapping',
    page: '/docs/guides/fonts/pixel-perfect-bitmap',
    stage: { orthographic: true },
    load: () => import('../scenes/fonts-bitmap-strikes/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
