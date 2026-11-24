import type { ExampleEntry } from './types';

/** Text style, spans, decorations and effects. */
export const STYLING = {
  styling: {
    title: 'Styling',
    page: '/docs/text/styling',
    aspect: '3 / 4',
    stage: {},
    load: () => import('../scenes/styling/scene'),
  },
  decorations: {
    title: 'Decorations',
    page: '/docs/text/styling',
    aspect: '3 / 4',
    stage: {},
    load: () => import('../scenes/decorations/scene'),
  },
  'rich-text': {
    title: 'Rich text',
    page: '/docs/text/rich-text',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/rich-text/scene'),
  },
  effects: {
    title: 'Effects',
    page: '/docs/text/materials',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/effects/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
