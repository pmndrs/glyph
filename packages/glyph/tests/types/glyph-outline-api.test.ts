import type { bitmap, GlyphOutlineContour, GlyphOutlineCurve, GlyphOutlineView, slug } from '@pmndrs/glyph';
import type { Text } from '@pmndrs/glyph/three';
import type { NodeBakeOptions } from '@pmndrs/glyph/bake';

declare const bitmapText: Text<typeof bitmap>;
declare const slugText: Text<typeof slug>;

const target: GlyphOutlineView = {
  fontHandle: 0,
  glyphId: 0,
  points: new Float32Array(0),
  contourEnds: new Uint32Array(0),
  segmentLines: new Uint8Array(0),
};
const views: GlyphOutlineView[] = [bitmapText, slugText].map((text) =>
  text.withGlyphs((glyphs) => glyphs.outlineAt(0, target)),
);
const points: Float32Array | undefined = views[0]?.points;
// @ts-expect-error A borrowed outline is a view, not owned contours.
const borrowedContours: GlyphOutlineContour[] = bitmapText.withGlyphs((glyphs) => glyphs.outlineAt(0));

const curve: GlyphOutlineCurve = [0, 0, 0.5, 0, 1, 0, true];
const isLine: boolean = curve[6];
// @ts-expect-error A curve is start, control, end, and whether it is a line.
const shortCurve: GlyphOutlineCurve = [0, 0, 1, 1, 2, 2];

const bake: NodeBakeOptions = {
  input: 'Inter.ttf',
  output: 'inter.font.glb',
  font: { fontFaceIndex: 0, outlines: true },
};

void points;
void borrowedContours;
void isLine;
void shortCurve;
void bake;
