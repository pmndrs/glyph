import type { ExampleEntry } from './types';

/** Paragraph layout: wrapping, alignment, justification, columns, flow. */
export const LAYOUT = {
  'paragraph-layout': {
    title: 'Paragraph layout',
    page: '/docs/text/paragraph-layout',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/paragraph-layout/scene'),
  },
  justify: {
    title: 'Justification and columns',
    page: '/docs/text/paragraph-layout',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/justify/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
