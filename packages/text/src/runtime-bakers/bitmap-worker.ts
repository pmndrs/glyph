/// <reference lib="webworker" />

import bitmapBaker, { type BitmapBakerOptions } from '../bakers/bitmap.js';
import { startRasterBakeWorker } from '../internal/raster-bake-worker-entry.js';

startRasterBakeWorker(bitmapBaker, normalizeBitmapOptions);

function normalizeBitmapOptions(value: unknown): BitmapBakerOptions {
  if (
    !isObject(value) ||
    !Object.hasOwn(value, 'strikes') ||
    !Array.isArray(value.strikes) ||
    value.strikes.length === 0
  ) {
    throw new TypeError('bitmap runtime baker requires a nonempty strikes tuple');
  }
  return { strikes: value.strikes as unknown as BitmapBakerOptions['strikes'] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
