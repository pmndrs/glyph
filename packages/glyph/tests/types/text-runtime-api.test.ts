import { createTextRuntime, type TextRuntime } from '../../src/core.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const runtime: TextRuntime;
runtime.disposed satisfies boolean;
// @ts-expect-error The runtime registry is private engine state.
void runtime.registry;

async function loadTargetV1Fonts(): Promise<void> {
  const created = await createTextRuntime();
  await created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  await created.loadFont({ input: { baked: '/fonts/Inter.font.glb' }, raster: { technique: msdf } });
  await created.loadFont({ input: { baked: '/fonts/Inter.font.glb' }, raster: { technique: slug } });
  const [bitmapFont, msdfFont, slugFont] = await created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    rasters: [{ technique: bitmap, options: { strikes: [16, 32] } }, { technique: msdf }, { technique: slug }],
  });
  bitmapFont satisfies import('../../src/index.js').LoadedFont<typeof bitmap>;
  msdfFont satisfies import('../../src/index.js').LoadedFont<typeof msdf>;
  slugFont satisfies import('../../src/index.js').LoadedFont<typeof slug>;
  await created.loadFont({
    input: {
      source: '/fonts/Inter.ttf',
      runtimeBake: async () => new Uint8Array(),
      unicodeRanges: [{ start: 0x20, end: 0x7e }],
    },
    rasters: [{ technique: bitmap, options: { strikes: [16] } }, { technique: slug }],
  });

  created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    // @ts-expect-error Bitmap technique options are required.
    raster: { technique: bitmap },
  });
  created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    rasters: [
      // @ts-expect-error Bitmap options remain required inside a multi-technique request.
      { technique: bitmap },
      { technique: msdf },
    ],
  });
}

void loadTargetV1Fonts;
