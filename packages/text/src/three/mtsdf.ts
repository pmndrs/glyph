import { mtsdf } from '../raster/mtsdf.js';
import { ThreeMtsdfTarget, type ThreeMtsdfTargetOwner } from './mtsdf-target.js';
import { registerThreeRasterProgram } from './program-registry.js';

registerThreeRasterProgram(mtsdf, (owner: ThreeMtsdfTargetOwner) => new ThreeMtsdfTarget<never>(owner));

export * from '../raster/mtsdf.js';
