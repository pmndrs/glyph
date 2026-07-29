import {
  bitmap,
  bitmapDescriptor,
  bitmapRasterKey,
  type BitmapOptions,
  type BitmapResource,
} from '@pmndrs/text/raster/bitmap';
import type { RasterKey, RegisteredFont, RegisteredRaster } from '@pmndrs/text';

const inline = bitmapDescriptor({ strikes: [16, 32] });
const tuple = [16, 32] as const;
const fromTuple = bitmapDescriptor({ strikes: tuple });
void inline;
void fromTuple;

const configured: BitmapOptions<typeof tuple> = { strikes: tuple };
void bitmapRasterKey(configured);
const request = bitmap(configured);
declare const font: RegisteredFont;
declare const raster: RegisteredRaster<'bitmap'>;
const bitmapResource: Promise<BitmapResource> = request.module.decode(font, raster);
void bitmapResource;
declare const rasterKey: RasterKey;
const loadedBitmap: Promise<RegisteredRaster<'bitmap'>> = font.loadRaster({
  rasterKey,
  kind: 'bitmap',
});
void loadedBitmap;

declare const dynamicStrike: number;
declare const dynamicStrikes: number[];

// @ts-expect-error Strike values must be literal numbers.
bitmapDescriptor({ strikes: [dynamicStrike] });
// @ts-expect-error Strikes must be non-empty.
bitmapDescriptor({ strikes: [] });
// @ts-expect-error Broad arrays cannot describe bake-time payloads.
bitmapDescriptor({ strikes: dynamicStrikes });
// @ts-expect-error Broad arrays cannot configure the bitmap runtime module.
bitmap({ strikes: dynamicStrikes });
