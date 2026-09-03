import { registerRasterCodec } from '@pmndrs/glyph/config/raster';

import { glyphExampleCodecDefinition } from './portable.js';

/** Renderer-neutral registration performed by the portable package root. */
export const glyphExampleCodec: typeof glyphExampleCodecDefinition = registerRasterCodec(glyphExampleCodecDefinition);
