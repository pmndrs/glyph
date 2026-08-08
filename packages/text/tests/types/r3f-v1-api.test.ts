import { createElement } from 'react';

import type { LoadedFont } from '../../src/index.js';
import { Text, TextGroup, useFont } from '../../src/r3f.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';

declare const bitmapFont: LoadedFont<typeof bitmap>;
declare const mtsdfFont: LoadedFont<typeof msdf>;

const inline = createElement(Text<typeof bitmap>, { paint: { color: '#ff00ff' } }, 'span');
const label = createElement(Text<typeof bitmap>, { font: bitmapFont }, 'Typed ', inline);
const labels = createElement(TextGroup<typeof bitmap>, { technique: bitmap }, label);

function FontConsumer(): null {
  const loaded: LoadedFont<typeof bitmap> = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  void loaded;
  return null;
}

// @ts-expect-error The selected font technique must match the Text technique.
createElement(Text<typeof bitmap>, { font: mtsdfFont }, 'wrong technique');

void labels;
void FontConsumer;
