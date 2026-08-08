import { slug } from '../raster/slug-technique.js';
import { registerThreeRasterProgram } from './program-registry.js';
import { ThreeSlugTarget, type ThreeSlugTargetOwner } from './slug-target.js';

registerThreeRasterProgram(slug, (owner: ThreeSlugTargetOwner) => new ThreeSlugTarget<never>(owner));

export * from '../raster/slug-technique.js';
