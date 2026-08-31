import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import { useFont } from '@pmndrs/glyph/react';

import cjkFontUrl from '../../../assets/fonts/mplus1p-japanese.font.glb?url';
import geistFontUrl from '../../../assets/fonts/geist-msdf.font.glb?url';
import geistSlugFontUrl from '../../../assets/fonts/geist-slug-alphanumeric.font.glb?url';
import iconFontUrl from '../../../assets/fonts/font-awesome-icons-msdf.font.glb?url';
import loversQuarrelFontUrl from '../../../assets/fonts/lovers-quarrel-slug.font.glb?url';
import vt323FontUrl from '../../../assets/fonts/vt323-bitmap.font.glb?url';

export const SLUG_FONT = { input: loversQuarrelFontUrl, raster: { technique: slug } } as const;
export const MSDF_FONT = {
  input: geistFontUrl,
  raster: { technique: msdf, options: { emSize: 32, pixelRange: 6 } },
} as const;
export const GEIST_SLUG_FONT = { input: geistSlugFontUrl, raster: { technique: slug } } as const;
export const BITMAP_FONT = {
  input: vt323FontUrl,
  raster: { technique: bitmap, options: { strikes: [16, 24, 32] } },
} as const;
export const ICON_FONT = {
  input: iconFontUrl,
  raster: { technique: msdf, options: { emSize: 32, pixelRange: 6 } },
} as const;
export const CJK_FONT = {
  input: cjkFontUrl,
  raster: { technique: msdf, options: { emSize: 32, pixelRange: 6 } },
} as const;

useFont.preload(SLUG_FONT.input, SLUG_FONT.raster.technique);
useFont.preload(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
useFont.preload(GEIST_SLUG_FONT.input, GEIST_SLUG_FONT.raster.technique);
useFont.preload(BITMAP_FONT.input, BITMAP_FONT.raster.technique, BITMAP_FONT.raster.options);
useFont.preload(ICON_FONT.input, ICON_FONT.raster.technique, ICON_FONT.raster.options);
useFont.preload(CJK_FONT.input, CJK_FONT.raster.technique, CJK_FONT.raster.options);
