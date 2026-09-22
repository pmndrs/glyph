import type { Font, slug } from '@pmndrs/glyph';
import { useSlug } from '@pmndrs/glyph/react';
import face from '../../assets/geist-pixel-grid.font.glb?url';
import icons from '../../assets/icons.font.glb?url';

export type SlugFont = Font<typeof slug>;

for (const url of [face, icons]) useSlug.preload(url);

/** Two faces carry the whole film: the robot's pixel display, and the icons its wheels and its backdrop are made of. */
export function useFonts() {
  return { face: useSlug(face), icons: useSlug(icons) };
}
