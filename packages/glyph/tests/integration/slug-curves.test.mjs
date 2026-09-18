import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { getSlugGlyphCurves, glyph, slug } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';

test('shaped Slug glyphs expose independent em-space curves including counters and disconnected parts', async () => {
  await glyph.init();
  const bytes = gunzipSync(
    await readFile(new URL('../../../../benches/fixtures/rendering/inter-slug.font.glb.gz', import.meta.url)),
  );
  const face = glyph.fontFace(new Blob([bytes]), { format: slug });
  const handle = glyph.handle('slug-curves', ThreeConfig);
  try {
    await face.load();
    const text = handle.createText({ font: face.slug, text: 'Oi ', style: { fontSize: 1 } });
    const { glyphIds } = text.glyphs();
    const font = text.font;
    for (const glyphId of glyphIds.slice(0, 2)) {
      const curves = getSlugGlyphCurves(font, glyphId);
      assert.ok(curves.length > 0);
      assert.ok(curves.every((curve) => curve.every(Number.isFinite)));
      assert.ok(
        curves.every((curve) => curve.every((value) => Math.abs(value) < 1)),
        'coordinates stay in em units',
      );
      const contours = [];
      let contour = [];
      for (const curve of curves) {
        if (contour.length > 0) assert.deepEqual(curve.slice(0, 2), contour.at(-1).slice(4));
        contour.push(curve);
        if (curve[4] === contour[0][0] && curve[5] === contour[0][1]) {
          contours.push(contour);
          contour = [];
        }
      }
      assert.equal(contour.length, 0, 'each path closes');
      assert.equal(contours.length, 2, 'O has a counter and i has a detached dot');
      const before = getSlugGlyphCurves(font, glyphId);
      curves[0][0] = 99;
      assert.deepEqual(getSlugGlyphCurves(font, glyphId), before, 'callers cannot mutate retained raster data');
    }
    assert.deepEqual(getSlugGlyphCurves(font, glyphIds[2]), []);
    for (const invalid of [-1, 0.5, NaN, font.glyphCount]) {
      assert.throws(() => getSlugGlyphCurves(font, invalid), /glyphId/);
    }
    const retained = getSlugGlyphCurves(font, glyphIds[0]);
    const expected = structuredClone(retained);
    text.dispose();
    assert.deepEqual(retained, expected);
    assert.throws(() => getSlugGlyphCurves(font, glyphIds[0]), /disposed/);
  } finally {
    handle.dispose();
    face.dispose();
  }
});
