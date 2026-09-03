import { bitmapShader } from '../tsl/bitmap-shader.js';
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
  BITMAP_KIND,
  MAX_BITMAP_PPEM,
  bitmap,
  bitmapDescriptor,
  bitmapDescriptorRasterKey,
  bitmapPlanProgram,
  bitmapRasterKey,
  bitmapSchema,
  canonicalizeBitmapDescriptor,
  selectBitmapStrikePpem,
  type BitmapData,
  type BitmapDescriptor,
  type BitmapOptions,
  type BitmapPageData,
  type BitmapStrikeData,
  type BitmapFormatOptions,
} from '../raster/bitmap.js';
import { registerThreeBitmapShader } from './internal/builtin-shaders.js';

registerThreeBitmapShader(bitmapShader);

export {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
  BITMAP_KIND,
  MAX_BITMAP_PPEM,
  bitmap,
  bitmapDescriptor,
  bitmapDescriptorRasterKey,
  bitmapPlanProgram,
  bitmapRasterKey,
  bitmapSchema,
  canonicalizeBitmapDescriptor,
  selectBitmapStrikePpem,
};
export type { BitmapData, BitmapDescriptor, BitmapOptions, BitmapPageData, BitmapStrikeData, BitmapFormatOptions };
