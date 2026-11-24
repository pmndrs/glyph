import type { ExampleEntry } from './types';

/** Caret, selection, movement and exact edits. */
export const EDITING = {
  caret: {
    title: 'Caret and selection',
    page: '/docs/text/interaction',
    stage: {},
    load: () => import('../scenes/caret/scene'),
  },
  editing: {
    title: 'Editing',
    page: '/docs/text/rich-text',
    stage: {},
    load: () => import('../scenes/editing/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
