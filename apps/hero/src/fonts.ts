import type { Font } from '@pmndrs/glyph';
import { useMsdf } from '@pmndrs/glyph/react';
import { useSlug } from '@pmndrs/glyph/react';
import type { msdf } from '@pmndrs/glyph';
import type { slug } from '@pmndrs/glyph';

import amiri from '../assets/amiri.font.glb?url';
import cjk from '../assets/cjk.font.glb?url';
import dancingScript from '../assets/dancing-script.font.glb?url';
import devanagari from '../assets/devanagari.font.glb?url';
import dotgothic from '../assets/dotgothic.font.glb?url';
import geistBlack from '../assets/geist-black.font.glb?url';
import amiriBold from '../assets/amiri-bold.font.glb?url';
import devanagariBold from '../assets/devanagari-bold.font.glb?url';
import notoCjkWords from '../assets/noto-cjk-words.font.glb?url';
import geistMedium from '../assets/geist-medium.font.glb?url';
import geistMonoBold from '../assets/geist-mono-bold.font.glb?url';
import geistPixelGrid from '../assets/geist-pixel-grid.font.glb?url';
import icons from '../assets/icons.font.glb?url';
import stars from '../assets/stars.font.glb?url';
import sourceSerif from '../assets/source-serif.font.glb?url';
import { FEATURE_FIELD, type FaceId } from './content';

export type SlugFont = Font<typeof slug>;
export type MsdfFont = Font<typeof msdf>;
export type Faces = Readonly<Record<FaceId | 'icons' | 'stars', SlugFont>>;

const URLS = {
  'geist-black': geistBlack,
  'noto-cjk-words': notoCjkWords,
  'amiri-bold': amiriBold,
  'devanagari-bold': devanagariBold,
  'geist-medium': geistMedium,
  'geist-mono-bold': geistMonoBold,
  'geist-pixel-grid': geistPixelGrid,
  'source-serif': sourceSerif,
  'dancing-script': dancingScript,
  dotgothic,
  amiri,
  devanagari,
  cjk,
  icons,
  stars,
} as const satisfies Record<FaceId | 'icons' | 'stars', string>;

// Start every load before React first asks for a face.
for (const url of Object.values(URLS)) useSlug.preload(url);
// The feature line is MSDF outright: over the icon field it needs a stroke, which only the distance field carries.
useMsdf.preload(URLS['geist-mono-bold'], FEATURE_FIELD);

/** The feature line's MSDF raster: the distance field behind its white outline. */
export function useFeatureField(): MsdfFont {
  return useMsdf(URLS['geist-mono-bold'], FEATURE_FIELD);
}

/** Every face the hero draws, all Slug. Suspends until each is loaded. */
export function useFaces(): Faces {
  return {
    'geist-black': useSlug(URLS['geist-black']),
    'noto-cjk-words': useSlug(URLS['noto-cjk-words']),
    'amiri-bold': useSlug(URLS['amiri-bold']),
    'devanagari-bold': useSlug(URLS['devanagari-bold']),
    'geist-medium': useSlug(URLS['geist-medium']),
    'geist-mono-bold': useSlug(URLS['geist-mono-bold']),
    'geist-pixel-grid': useSlug(URLS['geist-pixel-grid']),
    'source-serif': useSlug(URLS['source-serif']),
    'dancing-script': useSlug(URLS['dancing-script']),
    dotgothic: useSlug(URLS.dotgothic),
    amiri: useSlug(URLS.amiri),
    devanagari: useSlug(URLS.devanagari),
    cjk: useSlug(URLS.cjk),
    icons: useSlug(URLS.icons),
    stars: useSlug(URLS.stars),
  };
}
