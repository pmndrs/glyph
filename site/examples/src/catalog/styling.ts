import type { ExampleEntry } from './types';

/** Text style, spans, decorations, effects, OpenType features, languages and direction. */
export const STYLING = {
  'text-style-basics': {
    title: 'Style basics',
    page: '/docs/guides/text/style-text',
    stage: {},
    load: () => import('../scenes/text-style-basics/scene'),
  },
  'text-style-composition': {
    title: 'Style composition',
    page: '/docs/guides/text/reuse-styles',
    stage: {},
    load: () => import('../scenes/text-style-composition/scene'),
  },
  'text-spans': {
    title: 'Spans',
    page: '/docs/guides/text/rich-text',
    stage: {},
    load: () => import('../scenes/text-spans/scene'),
  },
  'text-outline-shadow': {
    title: 'Outline and shadow',
    page: '/docs/guides/text/outline-and-shadow',
    stage: {},
    load: () => import('../scenes/text-outline-shadow/scene'),
  },
  decorations: {
    title: 'Decorations',
    page: '/docs/guides/text/decorations',
    aspect: '3 / 4',
    stage: {},
    load: () => import('../scenes/decorations/scene'),
  },
  'text-opentype-features': {
    title: 'OpenType features',
    page: '/docs/guides/text/opentype-features',
    stage: {},
    load: () => import('../scenes/text-opentype-features/scene'),
  },
  'text-language-shaping': {
    title: 'Language-specific shaping',
    page: '/docs/guides/text/languages-and-scripts',
    stage: {},
    load: () => import('../scenes/text-language-shaping/scene'),
  },
  'text-cjk-line-breaking': {
    title: 'CJK line breaking',
    page: '/docs/guides/text/languages-and-scripts',
    stage: {},
    load: () => import('../scenes/text-cjk-line-breaking/scene'),
  },
  'text-bidi': {
    title: 'Bidirectional text',
    page: '/docs/guides/text/bidirectional-text',
    stage: {},
    load: () => import('../scenes/text-bidi/scene'),
  },
} as const satisfies Record<string, ExampleEntry>;
