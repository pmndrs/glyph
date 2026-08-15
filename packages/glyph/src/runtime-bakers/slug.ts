import type { SlugBakerOptions } from '../bakers/slug.js';
import { createRasterBakeWorkerHost } from '../internal/raster-bake-worker-host.js';
import { SLUG_KIND } from '../internal/slug-contract.js';
import type { RuntimeRasterBakerModule } from '../raster.js';

const slugRuntimeBaker: RuntimeRasterBakerModule<typeof SLUG_KIND, SlugBakerOptions> = createRasterBakeWorkerHost({
  kind: SLUG_KIND,
  name: 'pmndrs-glyph-slug-baker',
  workerUrl: new URL('./slug-worker.js', import.meta.url),
});

export default slugRuntimeBaker;
