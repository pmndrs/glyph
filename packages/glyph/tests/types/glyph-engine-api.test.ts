import { type Font } from '../../src/index.js';
import { loadFont } from '../../src/loader.js';
import { createGlyphEngine, type GlyphEngine } from '../../src/glyph-engine.js';
import { bitmap } from '../../src/raster/bitmap.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug.js';

declare const glyphEngine: GlyphEngine;
glyphEngine.disposed satisfies boolean;
// @ts-expect-error Runtime registration is private engine state.
void glyphEngine.registry;
// @ts-expect-error Font loading is engine-independent root vocabulary.
void glyphEngine.loadFont;
// @ts-expect-error Renderer integration state is created only by glyph.handle(name, config).
void glyphEngine.createBackend;

async function loadPortableFonts(): Promise<void> {
  const created = await createGlyphEngine();
  const bitmapFont: Font<typeof bitmap> = await loadFont(
    { baked: '/fonts/Inter.font.glb' },
    { raster: bitmap, options: { strikes: [16, 32] } },
  );
  const msdfFont: Font<typeof msdf> = await loadFont({ baked: '/fonts/Inter.font.glb' }, msdf);
  const slugFont: Font<typeof slug> = await loadFont({ baked: '/fonts/Inter.font.glb' }, slug);
  const tuple: Promise<readonly [Font<typeof bitmap>, Font<typeof msdf>, Font<typeof slug>]> = loadFont(
    { baked: '/fonts/Inter.font.glb' },
    [{ raster: bitmap, options: { strikes: [16] } }, msdf, slug],
  );
  void [created, bitmapFont, msdfFont, slugFont, tuple];

  // @ts-expect-error Bitmap technique options are required.
  loadFont({ baked: '/fonts/Inter.font.glb' }, { raster: bitmap });
  // @ts-expect-error Multi-raster loading requires a nonempty tuple.
  loadFont({ baked: '/fonts/Inter.font.glb' }, []);
}

void loadPortableFonts;
