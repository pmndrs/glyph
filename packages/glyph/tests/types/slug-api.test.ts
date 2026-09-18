import type { RasterDecodeArtifact, RasterDecodeFont } from '@pmndrs/glyph';
import { slug, getSlugGlyphCurves, type SlugCurve, type SlugData, type Font, type bitmap } from '@pmndrs/glyph';
const descriptor = slug.descriptor(undefined);
const kind: 'slug' = slug.kind;
declare const font: RasterDecodeFont;
declare const raster: RasterDecodeArtifact<'slug'>;
const data: Promise<SlugData> = slug.decode(font, raster);

void descriptor;
void kind;
void data;
const request = slug();
void request;

declare const loaded: Font<typeof slug>;
const curves: SlugCurve[] = getSlugGlyphCurves(loaded, 0);
declare const bitmapFont: Font<typeof bitmap>;
// @ts-expect-error Bitmap fonts have no analytic curves.
getSlugGlyphCurves(bitmapFont, 0);
void curves;
