import type { Font, msdf, slug } from '@pmndrs/glyph';
import { useMsdf, useSlug } from '@pmndrs/glyph/react';
import { FEATURE_FIELD } from '../letters/content';
import title from '../../assets/geist-black.font.glb?url';
import feature from '../../assets/geist-mono-bold.font.glb?url';
import robot from '../../assets/geist-pixel-grid.font.glb?url';
import icons from '../../assets/icons.font.glb?url';
import stars from '../../assets/stars.font.glb?url';

export type SlugFont = Font<typeof slug>;
export type MsdfFont = Font<typeof msdf>;

for (const url of [title, robot, icons, stars]) useSlug.preload(url);

useMsdf.preload(feature, FEATURE_FIELD);

/** Load only the fonts used by the sequence, before playback begins. */
export function useFonts() {
  return {
    title: useSlug(title),
    feature: useMsdf(feature, FEATURE_FIELD),
    robot: useSlug(robot),
    icons: useSlug(icons),
    stars: useSlug(stars),
  };
}
