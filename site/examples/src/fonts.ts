/**
 * The fonts every example draws from. All are baked once, checked in, and
 * shared with the examples app and the landing page, so nothing here is
 * downloaded twice.
 *
 * - Inter Latin: Basic Latin (U+0020–007E) with Bitmap 32, MSDF, and Slug in one GLB.
 * - Font Awesome world: six globe glyphs, the same three formats.
 * - Playwrite: the landing wordmark script face, Slug only.
 * - Chorus faces: per-script MSDF subsets (emSize 32, pixelRange 6) of the word "glyph" in many languages.
 */
export const INTER = new URL('../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url).href;
export const ICONS = new URL('../../../apps/r3f-hello-world/assets/font-awesome-world.font.glb', import.meta.url).href;
export const PLAYWRITE = new URL('../../landing/assets/playwrite-glyph.font.glb', import.meta.url).href;

/** Strikes the checked-in Inter GLB actually carries; a different tuple would be a different raster. */
export const INTER_STRIKES = { strikes: [32] } as const;

/** Must match site/scripts/bake-chorus.mts. */
export const CHORUS_MSDF = { emSize: 32, pixelRange: 6 } as const;

export const CHORUS = {
  latin: new URL('../../landing/assets/chorus-latin.font.glb', import.meta.url).href,
  hebrew: new URL('../../landing/assets/chorus-hebrew.font.glb', import.meta.url).href,
  devanagari: new URL('../../landing/assets/chorus-devanagari.font.glb', import.meta.url).href,
  bengali: new URL('../../landing/assets/chorus-bengali.font.glb', import.meta.url).href,
  tamil: new URL('../../landing/assets/chorus-tamil.font.glb', import.meta.url).href,
  khmer: new URL('../../landing/assets/chorus-khmer.font.glb', import.meta.url).href,
  thai: new URL('../../landing/assets/chorus-thai.font.glb', import.meta.url).href,
  japanese: new URL('../../landing/assets/chorus-japanese.font.glb', import.meta.url).href,
  korean: new URL('../../landing/assets/chorus-korean.font.glb', import.meta.url).href,
} as const;

/** The globe from the icon subset. */
export const WORLD_ICON = '';
