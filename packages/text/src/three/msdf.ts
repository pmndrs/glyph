import { msdf } from '../raster/msdf.js';
import { ThreeMsdfTarget, type ThreeMsdfTargetOwner } from './msdf-target.js';
import { registerThreeRasterProgram } from './program-registry.js';

registerThreeRasterProgram(msdf, (owner: ThreeMsdfTargetOwner) => new ThreeMsdfTarget<never>(owner));

export * from '../raster/msdf.js';
