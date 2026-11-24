import { EDITING } from './catalog/editing.ts';
import { FONTS } from './catalog/fonts.ts';
import { INSPECT } from './catalog/inspect.ts';
import { LAYOUT } from './catalog/layout.ts';
import { MOTION } from './catalog/motion.ts';
import { SCENE } from './catalog/scene.ts';
import { START } from './catalog/start.ts';
import { STYLING } from './catalog/styling.ts';
import type { ExampleEntry } from './catalog/types.ts';

export type { ExampleEntry, StageOptions } from './catalog/types.ts';

/**
 * Every hosted example, grouped by the explainer section that owns it. A docs page loads one section, and
 * inside it one scene module per proxy that goes live; the gallery lists them all. A slug is unique across
 * sections, because it is also the example's URL and its poster's file name.
 */
export const SECTIONS = {
  start: START,
  layout: LAYOUT,
  styling: STYLING,
  fonts: FONTS,
  editing: EDITING,
  inspect: INSPECT,
  scene: SCENE,
  motion: MOTION,
} as const satisfies Record<string, Record<string, ExampleEntry>>;

export type SectionName = keyof typeof SECTIONS;

export const SECTION_NAMES = Object.keys(SECTIONS) as readonly SectionName[];

export const EXAMPLES = {
  ...START,
  ...LAYOUT,
  ...STYLING,
  ...FONTS,
  ...EDITING,
  ...INSPECT,
  ...SCENE,
  ...MOTION,
} as const satisfies Record<string, ExampleEntry>;

export type ExampleSlug = keyof typeof EXAMPLES;

/** Every entry in catalog order, typed by slug. */
export const EXAMPLE_SLUGS = Object.keys(EXAMPLES) as readonly ExampleSlug[];

export function isExampleSlug(value: string): value is ExampleSlug {
  return Object.hasOwn(EXAMPLES, value);
}
