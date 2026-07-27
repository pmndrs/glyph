/// <reference lib="webworker" />

import msdfBaker, { type MsdfBakerOptions } from '../bakers/msdf.js'
import { startRasterBakeWorker } from '../internal/raster-bake-worker-entry.js'

startRasterBakeWorker(msdfBaker, normalizeMsdfOptions)

function normalizeMsdfOptions(value: unknown): MsdfBakerOptions {
  if (value !== undefined) throw new TypeError('MTSDF runtime baker does not accept options')
  return undefined
}
