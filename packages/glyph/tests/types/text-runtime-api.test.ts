import { loadFont, type Font } from '../../src/index.js';
import { createTextRuntime, type TextRuntime } from '../../src/core.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const runtime: TextRuntime;
runtime.disposed satisfies boolean;
// @ts-expect-error Runtime registration is private engine state.
void runtime.registry;
// @ts-expect-error Font loading is runtime-independent root vocabulary.
void runtime.loadFont;

async function loadPortableFonts(): Promise<void> {
  const created = await createTextRuntime();
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
