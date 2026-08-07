import {
  bitmap,
  type BitmapBinding,
  type BitmapData,
  type BitmapGlyphBatchStorage,
} from '../../src/raster/bitmap-technique.js';
import { mtsdf, type MtsdfBinding, type MtsdfData, type MtsdfGlyphBatchStorage } from '../../src/raster/mtsdf.js';
import { slug, type SlugBinding, type SlugData, type SlugGlyphBatchStorage } from '../../src/raster/slug-technique.js';
import type { GlyphBatchStorageOf, RasterBindingOf, RasterDataOf } from '../../src/index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type _BitmapData = Expect<Equal<RasterDataOf<typeof bitmap>, BitmapData>>;
type _BitmapBinding = Expect<Equal<RasterBindingOf<typeof bitmap>, BitmapBinding>>;
type _BitmapStorage = Expect<Equal<GlyphBatchStorageOf<typeof bitmap>, BitmapGlyphBatchStorage>>;

type _MtsdfData = Expect<Equal<RasterDataOf<typeof mtsdf>, MtsdfData>>;
type _MtsdfBinding = Expect<Equal<RasterBindingOf<typeof mtsdf>, MtsdfBinding>>;
type _MtsdfStorage = Expect<Equal<GlyphBatchStorageOf<typeof mtsdf>, MtsdfGlyphBatchStorage>>;

type _SlugData = Expect<Equal<RasterDataOf<typeof slug>, SlugData>>;
type _SlugBinding = Expect<Equal<RasterBindingOf<typeof slug>, SlugBinding>>;
type _SlugStorage = Expect<Equal<GlyphBatchStorageOf<typeof slug>, SlugGlyphBatchStorage>>;
