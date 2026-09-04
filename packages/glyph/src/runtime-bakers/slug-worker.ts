/// <reference lib="webworker" />

import slugBaker from '../bakers/slug.js';
import { startRasterBakeWorker } from '../internal/raster-bake-worker-entry.js';
import { normalizeSlugOptions } from '../internal/slug-contract.js';

startRasterBakeWorker(slugBaker, normalizeSlugOptions);
