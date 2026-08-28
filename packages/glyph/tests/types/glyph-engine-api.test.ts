import { loadFont, type Font } from '../../src/index.js';
import { createGlyphEngine, type GlyphEngine } from '../../src/core.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const glyphEngine: GlyphEngine;
glyphEngine.disposed satisfies boolean;
// @ts-expect-error Runtime registration is private engine state.
void glyphEngine.registry;
// @ts-expect-error Font loading is engine-independent root vocabulary.
void glyphEngine.loadFont;

async function loadPortableFonts(): Promise<void> {
  const created = await createGlyphEngine();
  const bitmapFont: Font<typeof bitmap> = await loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  const msdfFont: Font<typeof msdf> = await loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: msdf },
  });
  const slugFont: Font<typeof slug> = await loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: slug },
  });
  void [created, bitmapFont, msdfFont, slugFont];

  loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    // @ts-expect-error Bitmap technique options are required.
    raster: { technique: bitmap },
  });
}

void loadPortableFonts;
