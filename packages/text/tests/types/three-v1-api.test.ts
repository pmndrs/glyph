import type { LoadedFont } from '../../src/index.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { FontLoader, span, Text, TextGroup, txt } from '../../src/three.js';

declare const bitmapFont: LoadedFont<typeof bitmap>;
declare const mtsdfFont: LoadedFont<typeof msdf>;

const emphasis = span(bitmapFont, { color: '#ff00ff' });
const label = new Text({ font: bitmapFont, text: txt`Typed ${emphasis`span`}` });
const labels = new TextGroup({ technique: bitmap });
labels.add(label);
label.text = 'Updated';
label.setCapacity({ size: 64, policy: 'grow' });
labels.setCapacity({ size: 4_096, policy: 'chunk' });

// @ts-expect-error Directly adding another technique is rejected statically.
labels.add(new Text({ font: mtsdfFont, text: 'Wrong technique' }));

const loader = new FontLoader();
const loaded = loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: bitmap, options: { strikes: [16] } },
});
void loaded;
void labels;
