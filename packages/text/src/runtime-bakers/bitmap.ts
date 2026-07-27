import type { BitmapBakerOptions } from '../bakers/bitmap.js'
import { BITMAP_KIND } from '../internal/bitmap-contract.js'
import { createRasterBakeWorkerHost } from '../internal/raster-bake-worker-host.js'
import type { RuntimeRasterBakerModule } from '../raster.js'

const bitmapRuntimeBaker: RuntimeRasterBakerModule<typeof BITMAP_KIND, BitmapBakerOptions> =
  createRasterBakeWorkerHost({
    kind: BITMAP_KIND,
    name: 'pmndrs-text-bitmap-baker',
    workerUrl: new URL('./bitmap-worker.js', import.meta.url),
  })

export default bitmapRuntimeBaker
