import { bitmapShader } from '../tsl/bitmap-shader.js';
import { registerThreeBitmapShader } from './internal/builtin-shaders.js';

registerThreeBitmapShader(bitmapShader);

export * from '../raster/bitmap-technique.js';
