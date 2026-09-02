import type { ComponentType } from 'react';

import type { StageOptions } from './stage';

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
export interface ExampleEntry {
  readonly title: string;
  /** The docs page this example belongs to, as a site-absolute path. */
  readonly page: string;
  readonly stage: StageOptions;
  readonly load: () => Promise<{ readonly default: ComponentType }>;
}

export const EXAMPLES = {
  hello: {
    title: 'Hello world',
    page: '/docs/getting-started/introduction',
    stage: {},
    load: () => import('./scenes/hello/scene'),
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
    stage: {},
    load: () => import('./scenes/techniques/scene'),
  },
  'text-ladder': {
    title: 'Text ladder',
    page: '/docs/fonts/techniques',
    stage: { orthographic: true },
    load: () => import('./scenes/text-ladder/scene'),
  },
  groups: {
    title: 'Roots and groups',
    page: '/docs/text/text-and-groups',
    stage: {},
    load: () => import('./scenes/groups/scene'),
  },
  styling: {
    title: 'Styling',
    page: '/docs/text/styling',
    stage: {},
    load: () => import('./scenes/styling/scene'),
  },
  'paragraph-layout': {
    title: 'Paragraph layout',
    page: '/docs/text/paragraph-layout',
    stage: {},
    load: () => import('./scenes/paragraph-layout/scene'),
  },
  'rich-text': {
    title: 'Rich text',
    page: '/docs/text/rich-text',
    stage: {},
    load: () => import('./scenes/rich-text/scene'),
  },
  measurement: {
    title: 'Measurement',
    page: '/docs/text/measurement',
    stage: {},
    load: () => import('./scenes/measurement/scene'),
  },
  materials: {
    title: 'Materials',
    page: '/docs/text/materials',
    stage: { lit: true },
    load: () => import('./scenes/materials/scene'),
  },
  effects: {
    title: 'Effects',
    page: '/docs/text/materials',
    stage: {},
    load: () => import('./scenes/effects/scene'),
  },
  depth: {
    title: 'Depth and occlusion',
    page: '/docs/text/in-3d',
    stage: { lit: true },
    load: () => import('./scenes/depth/scene'),
  },
  labels: {
    title: 'Labels in a scene',
    page: '/docs/text/in-3d',
    stage: { lit: true },
    load: () => import('./scenes/labels/scene'),
  },
  'off-axis': {
    title: 'Off-axis',
    page: '/docs/text/in-3d',
    stage: {},
    load: () => import('./scenes/off-axis/scene'),
  },
  bloom: {
    title: 'Bloom',
    page: '/docs/text/in-3d',
    stage: {},
    load: () => import('./scenes/bloom/scene'),
  },
  'break-apart': {
    title: 'Break apart',
    page: '/docs/text/break-apart',
    stage: {},
    load: () => import('./scenes/break-apart/scene'),
  },
  arc: {
    title: 'Text on a circle',
    page: '/docs/text/break-apart',
    stage: {},
    load: () => import('./scenes/arc/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;

export type ExampleSlug = keyof typeof EXAMPLES;

export function isExampleSlug(value: string): value is ExampleSlug {
  return Object.hasOwn(EXAMPLES, value);
}
