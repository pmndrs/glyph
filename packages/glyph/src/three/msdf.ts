import { msdfShader } from '../tsl/msdf-shader.js';
import { registerThreeMsdfShader } from './internal/builtin-shaders.js';

registerThreeMsdfShader(msdfShader);

export * from '../raster/msdf.js';
