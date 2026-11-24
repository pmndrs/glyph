import type { ExampleEntry } from './types';

/** Text as scene objects: depth, groups, batching, materials. */
export const SCENE = {
  groups: {
    title: 'Roots and groups',
    page: '/docs/text/text-and-groups',
    aspect: '1 / 1',
    stage: {},
    load: () => import('../scenes/groups/scene'),
  },
  batching: {
    title: 'Batching',
    page: '/docs/advanced/performance',
    stage: {},
    load: () => import('../scenes/batching/scene'),
  },
  depth: {
    title: 'Depth and occlusion',
    page: '/docs/text/in-3d',
    aspect: '3 / 2',
    stage: { lit: true },
    load: () => import('../scenes/depth/scene'),
  },
  labels: {
    title: 'Labels in a scene',
    page: '/docs/text/in-3d',
    aspect: '4 / 3',
    stage: { lit: true },
    load: () => import('../scenes/labels/scene'),
  },
  'off-axis': {
    title: 'Off-axis',
    page: '/docs/text/in-3d',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/off-axis/scene'),
  },
  orbit: {
    title: 'Text in orbit',
    page: '/docs/text/in-3d',
    stage: {},
    load: () => import('../scenes/orbit/scene'),
  },
  bloom: {
    title: 'Bloom',
    page: '/docs/text/in-3d',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/bloom/scene'),
  },
  materials: {
    title: 'Materials',
    page: '/docs/text/materials',
    aspect: '4 / 3',
    stage: { lit: true },
    load: () => import('../scenes/materials/scene'),
  },
  relief: {
    title: 'Relief type',
    page: '/docs/text/materials',
    stage: { lit: true },
    load: () => import('../scenes/relief/scene'),
  },
  ripple: {
    title: 'Text on a wave',
    page: '/docs/text/materials',
    stage: {},
    load: () => import('../scenes/ripple/scene'),
  },
  'marble-type': {
    title: 'Marble type',
    page: '/docs/text/materials',
    stage: {},
    load: () => import('../scenes/marble-type/scene'),
  },
  'card-cycle': {
    title: 'Card cycle',
    page: '/docs/text/materials',
    stage: { lit: true },
    load: () => import('../scenes/card-cycle/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
