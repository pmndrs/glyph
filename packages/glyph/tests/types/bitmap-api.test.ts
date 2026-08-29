import type { RasterDecodeArtifact, RasterDecodeFont } from '@pmndrs/glyph';
import {
  bitmap,
  bitmapDescriptor,
  bitmapRasterKey,
  type BitmapData,
  type BitmapOptions,
} from '@pmndrs/glyph/raster/bitmap';

const inline = bitmapDescriptor({ strikes: [16, 32] });
const tuple = [16, 32] as const;
const fromTuple = bitmapDescriptor({ strikes: tuple });
void inline;
void fromTuple;

const configured: BitmapOptions<typeof tuple> = { strikes: tuple };
const configuredRasterKey: RasterKey = bitmapRasterKey(configured);
void configuredRasterKey;
declare const font: RasterDecodeFont;
declare const raster: RasterDecodeArtifact<'bitmap'>;
const bitmapData: Promise<BitmapData> = bitmap.decode(font, raster);
void bitmapData;

declare const dynamicStrike: number;
declare const dynamicStrikes: number[];

// @ts-expect-error Strike values must be literal numbers.
bitmapDescriptor({ strikes: [dynamicStrike] });
// @ts-expect-error Strikes must be non-empty.
bitmapDescriptor({ strikes: [] });
// @ts-expect-error Broad arrays cannot describe bake-time payloads.
bitmapDescriptor({ strikes: dynamicStrikes });
// @ts-expect-error Broad arrays cannot configure the portable bitmap technique.
bitmap.descriptor({ strikes: dynamicStrikes });
