import type { ComponentType } from 'react';

/**
 * Every hosted example. Each entry names the docs page it belongs to, the
 * stage it wants, and a loader for its scene module — one feature, one
 * scene, a few dozen lines each.
 *
 * A scene module exports its React component as `default` and, beside it, a
 * `three.ts` twin that states the same thing imperatively. The twin is
 * typechecked with the scene but never executed here: the docs show it as
 * the parallel, and the R3F scene is what runs.
 */
/** What a scene stands on; see `docs/components/pages/examples/stage.tsx`. */
export interface StageOptions {
  /** Pixel-unit orthographic camera; `fontSize` is then in frame pixels. */
  readonly orthographic?: boolean;
  /** A studio light rig and film-like tone mapping for PBR materials. */
  readonly lit?: boolean;
}

export interface ExampleEntry {
  readonly title: string;
  /** The docs page this example belongs to, as a site-absolute path. */
  readonly page: string;
  readonly stage: StageOptions;
  /** The card's shape in the gallery; 16 / 9 unless the scene wants otherwise. */
  readonly aspect?: '16 / 9' | '4 / 3' | '3 / 2' | '1 / 1' | '3 / 4';
  readonly load: () => Promise<{ readonly default: ComponentType }>;
}

export const EXAMPLES = {
  kinetic: {
    title: 'Kinetic typography',
    page: '/docs/getting-started/examples',
    stage: {},
    load: () => import('./scenes/kinetic/scene'),
  },
  'split-flap': {
    title: 'Split-flap board',
    page: '/docs/text/text-and-groups',
    stage: { lit: true },
    load: () => import('./scenes/split-flap/scene'),
  },
  relief: {
    title: 'Relief type',
    page: '/docs/text/materials',
    stage: { lit: true },
    load: () => import('./scenes/relief/scene'),
  },
  'slug-anatomy': {
    title: 'Slug anatomy',
    page: '/docs/fonts/techniques',
    stage: {},
    load: () => import('./scenes/slug-anatomy/scene'),
  },
  ribbon: {
    title: 'Ribbon',
    page: '/docs/text/break-apart',
    stage: {},
    load: () => import('./scenes/ribbon/scene'),
  },
  'first-text': {
    title: 'Your first text',
    page: '/docs/getting-started/your-first-text',
    stage: {},
    load: () => import('./scenes/first-text/scene'),
  },
  techniques: {
    title: 'Raster formats',
    page: '/docs/fonts/techniques',
    aspect: '3 / 2',
    stage: {},
    load: () => import('./scenes/techniques/scene'),
  },
  'text-ladder': {
    title: 'Text ladder',
    page: '/docs/fonts/techniques',
    aspect: '3 / 4',
    stage: { orthographic: true },
    load: () => import('./scenes/text-ladder/scene'),
  },
  zoom: {
    title: 'Zoom',
    page: '/docs/fonts/techniques',
    aspect: '3 / 2',
    stage: { orthographic: true },
    load: () => import('./scenes/zoom/scene'),
  },
  groups: {
    title: 'Roots and groups',
    page: '/docs/text/text-and-groups',
    aspect: '1 / 1',
    stage: {},
    load: () => import('./scenes/groups/scene'),
  },
  styling: {
    title: 'Styling',
    page: '/docs/text/styling',
    aspect: '3 / 4',
    stage: {},
    load: () => import('./scenes/styling/scene'),
  },
  'paragraph-layout': {
    title: 'Paragraph layout',
    page: '/docs/text/paragraph-layout',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/paragraph-layout/scene'),
  },
  justify: {
    title: 'Justification and columns',
    page: '/docs/text/paragraph-layout',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/justify/scene'),
  },
  decorations: {
    title: 'Decorations',
    page: '/docs/text/styling',
    aspect: '3 / 4',
    stage: {},
    load: () => import('./scenes/decorations/scene'),
  },
  'rich-text': {
    title: 'Rich text',
    page: '/docs/text/rich-text',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/rich-text/scene'),
  },
  editing: {
    title: 'Editing',
    page: '/docs/text/rich-text',
    stage: {},
    load: () => import('./scenes/editing/scene'),
  },
  caret: {
    title: 'Caret and selection',
    page: '/docs/text/interaction',
    stage: {},
    load: () => import('./scenes/caret/scene'),
  },
  measurement: {
    title: 'Measurement',
    page: '/docs/text/measurement',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/measurement/scene'),
  },
  materials: {
    title: 'Materials',
    page: '/docs/text/materials',
    aspect: '4 / 3',
    stage: { lit: true },
    load: () => import('./scenes/materials/scene'),
  },
  effects: {
    title: 'Effects',
    page: '/docs/text/materials',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/effects/scene'),
  },
  depth: {
    title: 'Depth and occlusion',
    page: '/docs/text/in-3d',
    aspect: '3 / 2',
    stage: { lit: true },
    load: () => import('./scenes/depth/scene'),
  },
  labels: {
    title: 'Labels in a scene',
    page: '/docs/text/in-3d',
    aspect: '4 / 3',
    stage: { lit: true },
    load: () => import('./scenes/labels/scene'),
  },
  'off-axis': {
    title: 'Off-axis',
    page: '/docs/text/in-3d',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/off-axis/scene'),
  },
  bloom: {
    title: 'Bloom',
    page: '/docs/text/in-3d',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/bloom/scene'),
  },
  'break-apart': {
    title: 'Break apart',
    page: '/docs/text/break-apart',
    aspect: '1 / 1',
    stage: {},
    load: () => import('./scenes/break-apart/scene'),
  },
  arc: {
    title: 'Text on a circle',
    page: '/docs/text/break-apart',
    aspect: '1 / 1',
    stage: {},
    load: () => import('./scenes/arc/scene'),
  },
  batching: {
    title: 'Batching',
    page: '/docs/advanced/performance',
    stage: {},
    load: () => import('./scenes/batching/scene'),
  },
  shaping: {
    title: 'Shaping',
    page: '/docs/advanced/how-it-works',
    aspect: '4 / 3',
    stage: {},
    load: () => import('./scenes/shaping/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;

export type ExampleSlug = keyof typeof EXAMPLES;

/** Every entry in catalog order, typed by slug. */
export const EXAMPLE_SLUGS = Object.keys(EXAMPLES) as readonly ExampleSlug[];

export function isExampleSlug(value: string): value is ExampleSlug {
  return Object.hasOwn(EXAMPLES, value);
}
