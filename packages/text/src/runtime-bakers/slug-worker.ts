/// <reference lib="webworker" />

import slugBaker, { type SlugBakerOptions } from '../bakers/slug.js'
import { startRasterBakeWorker } from '../internal/raster-bake-worker-entry.js'

startRasterBakeWorker(slugBaker, normalizeSlugOptions)

function normalizeSlugOptions(value: unknown): SlugBakerOptions {
  if (value !== undefined) throw new TypeError('Slug runtime baker does not accept options')
  return undefined
}
