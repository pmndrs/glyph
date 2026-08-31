import { Constraints, ParagraphLayout, span, TextStyle, txt, type Font } from '../../src/index.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import { msdf } from '../../src/raster/msdf.js';
import { Decorations, FontLoader, Glyphs, Text, TextGroup } from '../../src/three.js';

declare const bitmapFont: Font<typeof bitmap>;
declare const mtsdfFont: Font<typeof msdf>;

const emphasis = span(bitmapFont, { color: '#ff00ff' });
const styles = TextStyle.create({ base: { fontSize: 16 }, accent: { color: '#00ff00' } });
const layouts = ParagraphLayout.create({ centered: { align: 'center' }, wrapped: { wrap: 'word' } });
const constraints = Constraints.create({
  card: { width: { mode: 'at-most', size: 320 } },
  naturalHeight: { height: { mode: 'unconstrained' } },
});
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
label.constraints = [constraints.card, constraints.naturalHeight];
label.setCapacity({ size: 64, policy: 'grow' });
const measurement = label.measure();
void measurement.contentWidth;
labels.setCapacity({ size: 4_096, policy: 'chunk' });

labels.add(new Text({ font: mtsdfFont, text: 'Mixed technique' }));

const [detachedGlyphs, detachedDecorations] = label.breakApart();
detachedGlyphs satisfies Glyphs;
detachedDecorations satisfies Decorations | undefined;
void detachedGlyphs;
void detachedDecorations;
// @ts-expect-error Detached glyph branches are created only by Text.breakApart().
const invalidGlyphs = new Glyphs();
void invalidGlyphs;
// @ts-expect-error No source-condition-only factory may leak through the public class.
Glyphs.create({});
// @ts-expect-error Detached decoration branches are created only by Text.breakApart().
const invalidDecorations = new Decorations();
void invalidDecorations;
// @ts-expect-error No source-condition-only factory may leak through the public class.
Decorations.create({});

TextStyle.create({
  // @ts-expect-error Paragraph flow belongs to ParagraphLayout.create.
  invalid: { align: 'center' },
});
ParagraphLayout.create({
  // @ts-expect-error Text presentation belongs to TextStyle.create.
  invalid: { color: '#ffffff' },
});
Constraints.create({
  // @ts-expect-error Paragraph flow belongs to ParagraphLayout.create.
  invalid: { align: 'center' },
});

const loader = new FontLoader();
const loaded = loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: bitmap, options: { strikes: [16] } },
});
void loaded;
void labels;
void compositing;
