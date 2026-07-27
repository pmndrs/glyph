import type { MsdfBakerOptions } from '../bakers/msdf.js'
import { MSDF_KIND } from '../internal/msdf-contract.js'
import { createRasterBakeWorkerHost } from '../internal/raster-bake-worker-host.js'
import type { RuntimeRasterBakerModule } from '../raster.js'

const msdfRuntimeBaker: RuntimeRasterBakerModule<typeof MSDF_KIND, MsdfBakerOptions> =
  createRasterBakeWorkerHost({
    kind: MSDF_KIND,
    name: 'pmndrs-text-mtsdf-baker',
    workerUrl: new URL('./msdf-worker.js', import.meta.url),
  })

export default msdfRuntimeBaker
