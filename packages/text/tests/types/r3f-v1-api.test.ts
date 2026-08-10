import { createElement } from 'react';

import type { FontStack, LoadedFont } from '../../src/index.js';
import { Text, TextGroup, useFont } from '../../src/react.js';
import type { ThreeTextMaterial } from '../../src/three.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug-technique.js';

declare const bitmapFont: LoadedFont<typeof bitmap>;
declare const mtsdfFont: LoadedFont<typeof msdf>;
declare const slugFont: LoadedFont<typeof slug>;
declare const selectedStack: FontStack<typeof bitmap> | FontStack<typeof msdf> | FontStack<typeof slug>;
declare const material: ThreeTextMaterial;

const inline = createElement(Text<typeof bitmap>, { paint: { color: '#ff00ff' } }, 'span');
const label = createElement(Text<typeof bitmap>, { font: bitmapFont, material, pixelSnapping: true }, 'Typed ', inline);
const labels = createElement(TextGroup, { compositing: 'independent', material, pixelSnapping: true }, label);
const selected = createElement(Text, { font: selectedStack }, 'Selected at runtime');

function FontConsumer(): null {
  const loaded: LoadedFont<typeof bitmap> = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  void loaded;
  const [loadedBitmap, loadedMsdf, loadedSlug] = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    rasters: [{ technique: bitmap, options: { strikes: [16] } }, { technique: msdf }, { technique: slug }],
  });
  loadedBitmap satisfies LoadedFont<typeof bitmap>;
  loadedMsdf satisfies LoadedFont<typeof msdf>;
  loadedSlug satisfies LoadedFont<typeof slug>;
  return null;
}

// @ts-expect-error The selected font technique must match the Text technique.
createElement(Text<typeof bitmap>, { font: mtsdfFont }, 'wrong technique');

// @ts-expect-error An outer Text font must be a loaded font selection.
createElement(Text, { font: 42 }, 'invalid font');

void labels;
void selected;
void slugFont;
void FontConsumer;
