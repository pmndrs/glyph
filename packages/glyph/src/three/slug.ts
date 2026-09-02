import { slugShader } from '../tsl/slug-shader.js';
import { registerThreeSlugShader } from './internal/builtin-shaders.js';

registerThreeSlugShader(slugShader);

export * from '../raster/slug-technique.js';
