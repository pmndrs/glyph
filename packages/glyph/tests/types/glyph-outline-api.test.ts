import type { bitmap, GlyphOutlineContour, GlyphOutlineCurve, slug } from '@pmndrs/glyph';
import type { Text } from '@pmndrs/glyph/three';
import type { NodeBakeOptions } from '@pmndrs/glyph/bake';

declare const bitmapText: Text<typeof bitmap>;
declare const slugText: Text<typeof slug>;

const outlines: GlyphOutlineContour[][] = [bitmapText, slugText].map((text) =>
  text.withGlyphs((glyphs) => glyphs.outlineAt(0)),
);
const curve: GlyphOutlineCurve | undefined = outlines[0]?.[0]?.[0];
// @ts-expect-error A curve is six coordinates: start, control, end.
const shortCurve: GlyphOutlineCurve = [0, 0, 1, 1];

const bake: NodeBakeOptions = {
  input: 'Inter.ttf',
  output: 'inter.font.glb',
  font: { fontFaceIndex: 0, outlines: true },
};

void curve;
void shortCurve;
void bake;
