import type { RasterKey, RuntimeRasterBakerModule } from '@pmndrs/text';

import { bakeGlyphDebugArtifact } from './artifact.js';
import { GLYPH_DEBUG_KIND, glyphDebugDescriptor, type GlyphDebugOptions } from './contract.js';

const runtimeBaker: RuntimeRasterBakerModule<typeof GLYPH_DEBUG_KIND, GlyphDebugOptions | undefined> = {
  kind: GLYPH_DEBUG_KIND,
  async bake(request) {
    return bakeGlyphDebugArtifact({
      font: {
        source: request.source,
        fontFaceIndex: request.fontFaceIndex,
        glyphCount: request.font.glyphCount,
        shapingHash: request.font.shapingHash,
      },
      rasterKey: request.rasterKey as RasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: glyphDebugDescriptor(request.options),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
    });
  },
};

export default runtimeBaker;
