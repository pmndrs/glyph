import { ParagraphLayout, span, TextStyle, txt, type Font } from '../../src/index.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { FontLoader, Text, TextGroup } from '../../src/three.js';

declare const bitmapFont: Font<typeof bitmap>;
declare const mtsdfFont: Font<typeof msdf>;

const emphasis = span(bitmapFont, { color: '#ff00ff' });
const styles = TextStyle.create({ base: { fontSize: 16 }, accent: { color: '#00ff00' } });
const layouts = ParagraphLayout.create({ centered: { align: 'center' }, wrapped: { wrap: 'word' } });
const label = new Text({
  font: bitmapFont,
  pixelSnapping: true,
  text: txt`Typed ${emphasis`span`}`,
  style: [styles.base, false, null, styles.accent],
  layout: [layouts.centered, layouts.wrapped],
});
const labels = new TextGroup({ compositing: 'independent', pixelSnapping: true });
const compositing: 'ordered' | 'independent' = labels.compositing;
labels.add(label);
label.text = 'Updated';
label.text = 'Updated!';
label.spans = [{ start: 0, end: 7, style: { color: '#00ff00' } }];
label.constraints = [{ width: { mode: 'at-most', size: 320 } }, { height: { mode: 'unconstrained' } }];
label.setCapacity({ size: 64, policy: 'grow' });
const measurement = label.measure();
void measurement.contentWidth;
labels.setCapacity({ size: 4_096, policy: 'chunk' });

labels.add(new Text({ font: mtsdfFont, text: 'Mixed technique' }));

TextStyle.create({
  // @ts-expect-error Paragraph flow belongs to ParagraphLayout.create.
  invalid: { align: 'center' },
});
ParagraphLayout.create({
  // @ts-expect-error Text presentation belongs to TextStyle.create.
  invalid: { color: '#ffffff' },
});

const loader = new FontLoader();
const loaded = loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: bitmap, options: { strikes: [16] } },
});
void loaded;
void labels;
void compositing;
