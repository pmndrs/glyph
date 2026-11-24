import type { ExampleEntry } from './types';

/** Paragraph layout: wrapping, alignment, justification, columns, flow. */
export const LAYOUT = {
  'paragraph-layout': {
    title: 'Paragraph layout',
    page: '/docs/guides/layout/wrap-and-align',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/paragraph-layout/scene'),
  },
  justify: {
    title: 'Justification and columns',
    page: '/docs/guides/layout/justify',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/justify/scene'),
  },
  'layout-constraints': {
    title: 'Width constraint modes',
    page: '/docs/guides/layout/size-a-paragraph',
    stage: {},
    load: () => import('../scenes/layout-constraints/scene'),
  },
  'layout-anchor': {
    title: 'Anchor and position',
    page: '/docs/guides/layout/anchor-text',
    stage: {},
    load: () => import('../scenes/layout-anchor/scene'),
  },
  'layout-anchor-references': {
    title: 'Vertical anchor references',
    page: '/docs/guides/layout/anchor-text',
    stage: {},
    load: () => import('../scenes/layout-anchor-references/scene'),
  },
  'layout-wrap': {
    title: 'Wrap modes',
    page: '/docs/guides/layout/wrap-and-align',
    stage: {},
    load: () => import('../scenes/layout-wrap/scene'),
  },
  'layout-align': {
    title: 'Alignment',
    page: '/docs/guides/layout/wrap-and-align',
    stage: {},
    load: () => import('../scenes/layout-align/scene'),
  },
  'layout-justify-bounds': {
    title: 'Justification bounds',
    page: '/docs/guides/layout/justify',
    stage: {},
    load: () => import('../scenes/layout-justify-bounds/scene'),
  },
  'layout-truncate': {
    title: 'Overflow and line caps',
    page: '/docs/guides/layout/truncate',
    stage: {},
    load: () => import('../scenes/layout-truncate/scene'),
  },
  'layout-indent-spacing': {
    title: 'Indent and paragraph spacing',
    page: '/docs/guides/layout/indent-and-spacing',
    stage: {},
    load: () => import('../scenes/layout-indent-spacing/scene'),
  },
  'layout-columns': {
    title: 'Columns',
    page: '/docs/guides/layout/columns',
    stage: {},
    load: () => import('../scenes/layout-columns/scene'),
  },
  'layout-flow-regions': {
    title: 'Flow regions',
    page: '/docs/guides/layout/flow-through-regions',
    stage: {},
    load: () => import('../scenes/layout-flow-regions/scene'),
  },
  'layout-exclusion': {
    title: 'Exclusion shape',
    page: '/docs/guides/layout/wrap-around-shapes',
    stage: {},
    load: () => import('../scenes/layout-exclusion/scene'),
  },
  'layout-wrap-side': {
    title: 'Exclusion wrap sides',
    page: '/docs/guides/layout/wrap-around-shapes',
    stage: {},
    load: () => import('../scenes/layout-wrap-side/scene'),
  },
  'layout-projected-exclusion': {
    title: 'Projected 3D exclusion',
    page: '/docs/guides/layout/wrap-around-3d-objects',
    stage: { lit: true },
    load: () => import('../scenes/layout-projected-exclusion/scene'),
  },
  'layout-drop-cap': {
    title: 'Drop caps',
    page: '/docs/guides/layout/drop-caps',
    stage: {},
    load: () => import('../scenes/layout-drop-cap/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
