import type { RasterKey, RuntimeRasterBakerModule } from '@pmndrs/glyph';

import { bakeGlyphExampleArtifact } from './artifact.js';
import { GLYPH_EXAMPLE_KIND, glyphExampleDescriptor, type GlyphExampleOptions } from './contract.js';

const runtimeBaker: RuntimeRasterBakerModule<typeof GLYPH_EXAMPLE_KIND, GlyphExampleOptions | undefined> = {
  kind: GLYPH_EXAMPLE_KIND,
  async bake(request) {
    return bakeGlyphExampleArtifact({
      font: {
        source: request.source,
        sourceFingerprint: request.sourceFingerprint,
        fontFaceIndex: request.fontFaceIndex,
        glyphCount: request.font.glyphCount,
        shapingFingerprint: request.font.shapingFingerprint,
      },
      rasterKey: request.rasterKey as RasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: glyphExampleDescriptor(request.options),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
    });
  },
};

export default runtimeBaker;
