import {
  bitmap,
  type BitmapBinding,
  type BitmapData,
  type BitmapGlyphBatchStorage,
} from '../../src/raster/bitmap-technique.js';
import { msdf, type MsdfBinding, type MsdfData, type MsdfGlyphBatchStorage } from '../../src/raster/msdf.js';
import { slug, type SlugBinding, type SlugData, type SlugGlyphBatchStorage } from '../../src/raster/slug-technique.js';
import type { GlyphBatchStorageOf, RasterBindingOf, RasterDataOf } from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type _BitmapData = Expect<Equal<RasterDataOf<typeof bitmap>, BitmapData>>;
type _BitmapBinding = Expect<Equal<RasterBindingOf<typeof bitmap>, BitmapBinding>>;
type _BitmapStorage = Expect<Equal<GlyphBatchStorageOf<typeof bitmap>, BitmapGlyphBatchStorage>>;

type _MsdfData = Expect<Equal<RasterDataOf<typeof msdf>, MsdfData>>;
type _MsdfBinding = Expect<Equal<RasterBindingOf<typeof msdf>, MsdfBinding>>;
type _MtsdfStorage = Expect<Equal<GlyphBatchStorageOf<typeof msdf>, MsdfGlyphBatchStorage>>;

type _SlugData = Expect<Equal<RasterDataOf<typeof slug>, SlugData>>;
type _SlugBinding = Expect<Equal<RasterBindingOf<typeof slug>, SlugBinding>>;
type _SlugStorage = Expect<Equal<GlyphBatchStorageOf<typeof slug>, SlugGlyphBatchStorage>>;
