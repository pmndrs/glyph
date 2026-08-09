import { createTextRuntime, type TextRuntime } from '../../src/index.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const runtime: TextRuntime;
runtime.registry satisfies TextRuntime['registry'];

async function loadTargetV1Fonts(): Promise<void> {
  const created = await createTextRuntime();
  await created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  await created.loadFont({ input: { baked: '/fonts/Inter.font.glb' }, raster: { technique: msdf } });
  await created.loadFont({ input: { baked: '/fonts/Inter.font.glb' }, raster: { technique: slug } });

  created.loadFont({
    input: { baked: '/fonts/Inter.font.glb' },
    // @ts-expect-error Bitmap technique options are required.
    raster: { technique: bitmap },
  });
}

void loadTargetV1Fonts;
