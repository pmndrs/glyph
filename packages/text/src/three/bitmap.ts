import { bitmap } from '../raster/bitmap-technique.js';
import { ThreeBitmapTarget, type ThreeBitmapTargetOwner } from './bitmap-target.js';
import { registerThreeRasterProgram } from './program-registry.js';

// Pairing the technique with its program here is what keeps them separable: importing this subpath wires exactly one
// technique, so an application that never names MSDF or Slug does not carry their shaders, decoders, or targets.
registerThreeRasterProgram(bitmap, (owner: ThreeBitmapTargetOwner) => new ThreeBitmapTarget<never>(owner));

export * from '../raster/bitmap-technique.js';
