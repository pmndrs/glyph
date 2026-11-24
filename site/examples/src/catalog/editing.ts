import type { ExampleEntry } from './types';

/** Caret, selection, movement and exact edits. */
export const EDITING = {
  caret: {
    title: 'Caret and selection',
    page: '/docs/guides/editing/caret-and-selection',
    stage: {},
    load: () => import('../scenes/caret/scene'),
  },
  editing: {
    title: 'Editing',
    page: '/docs/guides/editing/edit-text',
    stage: {},
    load: () => import('../scenes/editing/scene'),
  },
  'editing-field': {
    title: 'Editable text field',
    page: '/docs/tutorials/editable-text-field',
    stage: {},
    load: () => import('../scenes/editing-field/scene'),
  },
  'editing-movement': {
    title: 'Movement by unit',
    page: '/docs/guides/editing/keyboard-movement',
    stage: {},
    load: () => import('../scenes/editing-movement/scene'),
  },
  'editing-boundary': {
    title: 'Word, sentence and line boundaries',
    page: '/docs/guides/editing/keyboard-movement',
    stage: {},
    load: () => import('../scenes/editing-boundary/scene'),
  },
  'editing-bidi-caret': {
    title: 'Split caret at a direction boundary',
    page: '/docs/guides/editing/caret-and-selection',
    stage: {},
    load: () => import('../scenes/editing-bidi-caret/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
