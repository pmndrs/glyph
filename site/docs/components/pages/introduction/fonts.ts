import { useFont } from '@pmndrs/glyph/react';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';

import cjkFontUrl from '../../../assets/fonts/mplus1p-japanese.font.glb?url';
import geistFontUrl from '../../../assets/fonts/geist-msdf.font.glb?url';
import geistSlugFontUrl from '../../../assets/fonts/geist-slug-alphanumeric.font.glb?url';
import iconFontUrl from '../../../assets/fonts/font-awesome-icons-msdf.font.glb?url';
import loversQuarrelFontUrl from '../../../assets/fonts/lovers-quarrel-slug.font.glb?url';
import vt323FontUrl from '../../../assets/fonts/vt323-bitmap.font.glb?url';

/**
 * Every explainer font is one `{ src, format }` pair. `src` is the baked `.glb`
 * and `format` is the raster format the page asks that face to be read through,
 * which is exactly the shape `useFont(src, { format })` and its preload take.
 */
export const SLUG_FONT = { src: loversQuarrelFontUrl, format: slug } as const;
export const MSDF_FONT = { src: geistFontUrl, format: msdf({ emSize: 32, pixelRange: 6 }) } as const;
export const GEIST_SLUG_FONT = { src: geistSlugFontUrl, format: slug } as const;
export const BITMAP_FONT = { src: vt323FontUrl, format: bitmap({ strikes: [16, 24, 32] }) } as const;
export const ICON_FONT = { src: iconFontUrl, format: msdf({ emSize: 32, pixelRange: 6 }) } as const;
export const CJK_FONT = { src: cjkFontUrl, format: msdf({ emSize: 32, pixelRange: 6 }) } as const;

useFont.preload(SLUG_FONT.src, { format: SLUG_FONT.format });
useFont.preload(MSDF_FONT.src, { format: MSDF_FONT.format });
useFont.preload(GEIST_SLUG_FONT.src, { format: GEIST_SLUG_FONT.format });
useFont.preload(BITMAP_FONT.src, { format: BITMAP_FONT.format });
useFont.preload(ICON_FONT.src, { format: ICON_FONT.format });
useFont.preload(CJK_FONT.src, { format: CJK_FONT.format });
