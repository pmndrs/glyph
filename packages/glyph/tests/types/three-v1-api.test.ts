import {
  Constraints,
  glyph,
  ParagraphLayout,
  span,
  TextStyle,
  txt,
  type Font,
  type FontFaceTransfer,
  type SerializedFontFace,
} from '../../src/index.js';
import { bitmap } from '../../src/raster/bitmap.js';
import { msdf } from '../../src/raster/msdf.js';
import { slug } from '../../src/raster/slug.js';
import { defineGlyphConfig } from '../../src/config/glyph.js';
import {
  Decorations,
  Glyphs,
  Text,
  TextGroup,
  ThreeRoot,
  ThreeConfig,
  ThreeFontFormats,
  defineTextMaterial,
  span as threeSpan,
  type ThreeHandle,
} from '../../src/three.js';

declare const bitmapFont: Font<typeof bitmap>;
declare const mtsdfFont: Font<typeof msdf>;

const emphasis = span(bitmapFont, { color: '#ff00ff' });
const green = span({ color: '#00ff00' });
const warningMaterial = defineTextMaterial((context) => context.createDefaultMaterial());
const warning = threeSpan(warningMaterial, { color: '#ffcc00' });
const styles = TextStyle.create({ base: { fontSize: 16 }, accent: { color: '#00ff00' } });
const layouts = ParagraphLayout.create({ centered: { align: 'center' }, wrapped: { wrap: 'word' } });
const constraints = Constraints.create({
  card: { width: { mode: 'at-most', size: 320 } },
  naturalHeight: { height: { mode: 'unconstrained' } },
});
const three: ThreeHandle = glyph.handle('three:type-fixture', ThreeConfig);
const extendedThreeConfig = defineGlyphConfig({
  ...ThreeConfig,
  fonts: {
    default: 'experimental',
    formats: { ...ThreeFontFormats, experimental: bitmap },
  },
});
glyph.handle('three:extended-type-fixture', extendedThreeConfig) satisfies ThreeHandle;
const hud = three('hud');
hud.createText({ font: bitmapFont, text: 'Named root' });
// @ts-expect-error Calling a handle only creates or selects named roots.
three();
// @ts-expect-error A named root is terminal; roots cannot create nested roots.
hud('nested');
// @ts-expect-error Text construction is owned by a Three handle root.
const rootlessText = new Text({ font: bitmapFont, text: 'rootless' });
void rootlessText;
// @ts-expect-error TextGroup construction is owned by a Three handle root.
const rootlessGroup = new TextGroup();
void rootlessGroup;
// @ts-expect-error ThreeRoot construction is owned by a Three handle.
const rootlessThreeRoot = new ThreeRoot(undefined, undefined, () => undefined);
void rootlessThreeRoot;
const inter = glyph.fontFace('/fonts/Inter.font.glb', {
  family: 'Inter',
  format: [slug, bitmap({ strikes: [8, 16] })],
});
// @ts-expect-error Bitmap requires its bake contract; use bitmap({ strikes: [...] }).
glyph.fontFace('/fonts/bitmap-without-options.font.glb', { format: bitmap });
// @ts-expect-error A FontFace format declaration must not be empty.
glyph.fontFace('/fonts/no-formats.font.glb', { format: [] });
inter.default satisfies typeof inter;
void inter.bitmap;
// @ts-expect-error Undeclared formats are not present on a typed FontFace.
void inter.msdf;
inter.slug.load() satisfies Promise<typeof inter.slug>;
inter.slug.clone() satisfies Promise<FontFaceTransfer>;
inter.formats() satisfies Promise<readonly string[]>;
// @ts-expect-error Format selections inspect through their owning FontFace declaration.
inter.slug.formats();
const discovered = glyph.fontFace('/fonts/discovered.font.glb');
glyph.fontFace(new URL('/fonts/discovered.font.glb', 'https://example.com'));
glyph.fontFace(new Blob(), { family: 'BlobFont' });
// @ts-expect-error Omitted format declarations do not synthesize technique members.
void discovered.slug;
// @ts-expect-error FontFace accepts the canonical source directly, not the legacy loader request object.
glyph.fontFace({ baked: '/fonts/legacy.font.glb' });
// @ts-expect-error FontFace does not accept unowned byte views; wrap bytes in a Blob or SerializedFontFace.
glyph.fontFace(new Uint8Array());
declare const transferred: SerializedFontFace;
glyph.fontFace(transferred) satisfies import('../../src/index.js').FontFace<never>;
three.createText({ font: inter.slug, text: 'Loaded before construction' }) satisfies import('../../src/three.js').Text<
  typeof slug
>;
three.createText({ font: 'Inter', text: 'Root family lookup' });
const label = three.createText({
  font: bitmapFont,
  pixelSnapping: true,
  text: txt`Typed ${emphasis`span`}`,
  style: [styles.base, false, null, styles.accent],
  layout: [layouts.centered, layouts.wrapped],
});
const labels = three.createTextGroup({ pixelSnapping: true });
three.setCompositing('independent');
three.setCapacity({ size: 4_096, policy: 'chunk' });
three.createText({ font: bitmapFont, text: txt`Warning: ${warning`100`}` });
const compositing: 'ordered' | 'independent' = three.compositing;
labels.add(label);
glyph.shape();
label.text = 'Updated';
label.text = 'Updated!';
label.text = txt`${green`Updated`}`;
label.constraints = [constraints.card, constraints.naturalHeight];
const measurement = label.measure();
void measurement.contentWidth;

labels.add(three.createText({ font: mtsdfFont, text: 'Mixed technique' }));

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

void labels;
void compositing;
