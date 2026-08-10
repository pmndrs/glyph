import { bitmap, type BitmapData, type BitmapTechniqueOptions } from '../../src/raster/bitmap-technique.js';
import { msdf, type MsdfData } from '../../src/raster/msdf.js';
import { slug, type SlugData } from '../../src/raster/slug-technique.js';
import type { RasterDataOf, RasterOptionsOf } from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type _BitmapData = Expect<Equal<RasterDataOf<typeof bitmap>, BitmapData>>;
type _BitmapOptions = Expect<Equal<RasterOptionsOf<typeof bitmap>, BitmapTechniqueOptions>>;
type _MsdfData = Expect<Equal<RasterDataOf<typeof msdf>, MsdfData>>;
type _SlugData = Expect<Equal<RasterDataOf<typeof slug>, SlugData>>;
