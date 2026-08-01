import { defineRasterBaker, type RasterBakerModule } from '@pmndrs/text';

import { bakeGlyphDebugArtifact } from './artifact.js';
import {
  GLYPH_DEBUG_EXTENSION,
  GLYPH_DEBUG_FORMAT_VERSION,
  GLYPH_DEBUG_KIND,
  glyphDebugDescriptor,
  type GlyphDebugDescriptor,
  type GlyphDebugOptions,
} from './contract.js';

const glyphDebugBaker: RasterBakerModule<typeof GLYPH_DEBUG_KIND, GlyphDebugOptions, GlyphDebugDescriptor> =
  defineRasterBaker({
    kind: GLYPH_DEBUG_KIND,
    extension: GLYPH_DEBUG_EXTENSION,
    version: GLYPH_DEBUG_FORMAT_VERSION,
    descriptor(options: GlyphDebugOptions) {
      return glyphDebugDescriptor(options);
    },
    bake: bakeGlyphDebugArtifact,
  });

export default glyphDebugBaker;
