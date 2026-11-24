import type { ExampleEntry } from './types';

/** The first scenes a reader meets. */
export const START = {
  'first-text': {
    title: 'Your first text',
    page: '/docs/getting-started/your-first-text',
    stage: {},
    load: () => import('../scenes/first-text/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
