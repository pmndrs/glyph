import { defineRasterBaker, type RasterBakerModule } from '@pmndrs/text';

import { bakeGlyphExampleArtifact } from './artifact.js';
import {
  GLYPH_EXAMPLE_EXTENSION,
  GLYPH_EXAMPLE_FORMAT_VERSION,
  GLYPH_EXAMPLE_KIND,
  glyphExampleDescriptor,
  type GlyphExampleDescriptor,
  type GlyphExampleOptions,
} from './contract.js';

const glyphExampleBaker: RasterBakerModule<typeof GLYPH_EXAMPLE_KIND, GlyphExampleOptions, GlyphExampleDescriptor> =
  defineRasterBaker({
    kind: GLYPH_EXAMPLE_KIND,
    extension: GLYPH_EXAMPLE_EXTENSION,
    version: GLYPH_EXAMPLE_FORMAT_VERSION,
    descriptor(options: GlyphExampleOptions) {
      return glyphExampleDescriptor(options);
    },
    bake: bakeGlyphExampleArtifact,
  });

export default glyphExampleBaker;
