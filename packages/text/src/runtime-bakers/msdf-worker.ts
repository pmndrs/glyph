/// <reference lib="webworker" />

import msdfBaker, { type MsdfBakerOptions } from '../bakers/msdf.js'
import { normalizeMsdfOptions as normalizeOptions } from '../internal/msdf-contract.js'
import { startRasterBakeWorker } from '../internal/raster-bake-worker-entry.js'

startRasterBakeWorker(msdfBaker, normalizeMsdfOptions)

function normalizeMsdfOptions(value: unknown): MsdfBakerOptions {
  return normalizeOptions(value)
}
