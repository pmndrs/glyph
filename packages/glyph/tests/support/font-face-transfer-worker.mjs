import { parentPort } from 'node:worker_threads';

import { glyph } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';

if (parentPort === null) throw new Error('FontFace transfer fixture requires a Worker parent port');

parentPort.once('message', async (serialized) => {
  globalThis.fetch = async () => {
    throw new Error('a complete SerializedFontFace must not fetch');
  };

  const face = glyph.fontFace(serialized, { format: bitmap({ strikes: [16] }) });
  try {
    const loaded = await face.bitmap.load();
    parentPort.postMessage({
      initialized: glyph.initialized,
      sameSelection: loaded === face.bitmap,
      loaded: face.bitmap.isLoaded(),
      formats: await face.formats(),
    });
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  } finally {
    face.dispose();
  }
});
