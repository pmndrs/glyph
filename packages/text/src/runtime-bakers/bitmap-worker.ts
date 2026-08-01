/// <reference lib="webworker" />

import bitmapBaker, { type BitmapBakerOptions } from '../bakers/bitmap.js';
import { normalizeBitmapOptions as normalizeOptions } from '../internal/bitmap-contract.js';
import { startRasterBakeWorker } from '../internal/raster-bake-worker-entry.js';

startRasterBakeWorker(bitmapBaker, normalizeBitmapOptions);

function normalizeBitmapOptions(value: unknown): BitmapBakerOptions {
  return normalizeOptions(value);
}
