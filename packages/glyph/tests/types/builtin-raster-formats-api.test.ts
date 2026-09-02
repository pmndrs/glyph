import { bitmap, type BitmapData, type BitmapFormatOptions } from '../../src/raster/bitmap.js';
import { msdf, type MsdfData } from '../../src/raster/msdf.js';
import { slug, type SlugData } from '../../src/raster/slug.js';
import type { RasterDataOf, RasterOptionsOf } from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type _BitmapData = Expect<Equal<RasterDataOf<typeof bitmap>, BitmapData>>;
type _BitmapOptions = Expect<Equal<RasterOptionsOf<typeof bitmap>, BitmapFormatOptions>>;
type _MsdfData = Expect<Equal<RasterDataOf<typeof msdf>, MsdfData>>;
type _SlugData = Expect<Equal<RasterDataOf<typeof slug>, SlugData>>;
