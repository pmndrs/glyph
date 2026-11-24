import type { ExampleEntry } from './types';

/** Text as scene objects: depth, groups, batching, materials. */
export const SCENE = {
  groups: {
    title: 'Roots and groups',
    page: '/docs/guides/scene/group-and-batch',
    aspect: '1 / 1',
    stage: {},
    load: () => import('../scenes/groups/scene'),
  },
  batching: {
    title: 'Batching',
    page: '/docs/guides/scene/group-and-batch',
    stage: {},
    load: () => import('../scenes/batching/scene'),
  },
  depth: {
    title: 'Depth and occlusion',
    page: '/docs/guides/scene/place-text-in-3d',
    aspect: '3 / 2',
    stage: { lit: true },
    load: () => import('../scenes/depth/scene'),
  },
  labels: {
    title: 'Labels in a scene',
    page: '/docs/guides/scene/labels',
    aspect: '4 / 3',
    stage: { lit: true },
    load: () => import('../scenes/labels/scene'),
  },
  'off-axis': {
    title: 'Off-axis',
    page: '/docs/guides/scene/place-text-in-3d',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/off-axis/scene'),
  },
  orbit: {
    title: 'Text in orbit',
    page: '/docs/guides/scene/place-text-in-3d',
    stage: {},
    load: () => import('../scenes/orbit/scene'),
  },
  bloom: {
    title: 'Bloom',
    page: '/docs/guides/scene/post-processing',
    aspect: '4 / 3',
    stage: {},
    load: () => import('../scenes/bloom/scene'),
  },
  materials: {
    title: 'Materials',
    page: '/docs/guides/scene/custom-materials',
    aspect: '4 / 3',
    stage: { lit: true },
    load: () => import('../scenes/materials/scene'),
  },
  relief: {
    title: 'Relief type',
    page: '/docs/guides/scene/custom-materials',
    stage: { lit: true },
    load: () => import('../scenes/relief/scene'),
  },
  ripple: {
    title: 'Text on a wave',
    page: '/docs/guides/scene/custom-materials',
    stage: {},
    load: () => import('../scenes/ripple/scene'),
  },
  'marble-type': {
    title: 'Marble type',
    page: '/docs/guides/scene/custom-materials',
    stage: {},
    load: () => import('../scenes/marble-type/scene'),
  },
  'card-cycle': {
    title: 'Card cycle',
    page: '/docs/guides/scene/custom-materials',
    stage: { lit: true },
    load: () => import('../scenes/card-cycle/scene'),
  },
  'scene-culling': {
    title: 'Frustum culling',
    page: '/docs/guides/scene/culling',
    stage: {},
    load: () => import('../scenes/scene-culling/scene'),
  },
  'scene-material-positions': {
    title: 'Material positions',
    page: '/docs/guides/scene/custom-materials',
    stage: {},
    load: () => import('../scenes/scene-material-positions/scene'),
  },
  'scene-draw-order': {
    title: 'Draw order',
    page: '/docs/guides/scene/group-and-batch',
    stage: {},
    load: () => import('../scenes/scene-draw-order/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
