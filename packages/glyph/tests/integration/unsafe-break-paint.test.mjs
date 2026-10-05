import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { bitmap, glyph, span, txt } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { bitmapSchema } from '../../dist/raster/bitmap.js';
import { decorationSchema } from '../../dist/three/codec.js';
import { loadFont } from '../../dist/loader.js';

// CrossSpace2 adds `space a' p p -> a.init`: the line "apple" starts at a corrected boundary whose island is `app`.
const fixtures = new URL('../../../../benches/fixtures/rendering/', import.meta.url);
const A = 28;
const attribute = (draw, buffer) => draw.geometry.getAttribute(`_pmndrsGlyph_${buffer.id}`);
const underline = span({ decoration: { underline: true } });
const red = span({ color: '#ff0000' });

for (const [name, align] of [
  ['left-aligned', 'start'],
  ['justified', 'justify'],
]) {
  test(`paint and decoration spans that begin and end inside a corrected ${name} line start keep their own extents`, async (t) => {
    await checkSpans(t, align);
  });
}

async function checkSpans(t, align) {
  await glyph.init();
  const font = await loadFont(
    { baked: { bytes: await readFile(new URL('cross-space-2-bitmap-16.font.glb', fixtures)) } },
    bitmap({ strikes: [16] }),
  );
  const root = glyph.handle('three:integration:unsafe-break-paint', defineThreeConfig());
  const label = root.createText({
    font,
    // Clusters 33 and 36 are underlined, 34 and 35 red: both edges fall inside the island `app`.
    text: txt`the apple ate a banana while the ${underline`a`}${red`pp`}${underline`l`}e ate a pear`,
    style: { fontSize: 24 },
    layout: { wrap: 'word', align },
    constraints: { width: { mode: 'exact', size: 120 } },
  });
  const scene = new THREE.Scene();
  scene.add(label);
  t.after(() => {
    label.dispose();
    root.dispose();
    font.dispose();
  });
  scene.updateMatrixWorld(true);

  const glyphs = label.glyphs();
  const line = Array.from(glyphs.lineTextStarts).indexOf(33);
  assert.equal(glyphs.glyphIds[glyphs.lineGlyphStarts[line]], A, 'the line starts at the corrected boundary');

  const expected = [];
  for (const cluster of [33, 36]) {
    const index = Array.from(glyphs.clusters).indexOf(cluster);
    expected.push({ left: glyphs.x[index], width: glyphs.glyphAdvances[index] });
  }
  const draws = scene.getObjectByName('@pmndrs/glyph:anonymous').children.filter((child) => child.isMesh);
  const decorations = draws.filter((draw) => draw.userData.pmndrsGlyphPrimitiveKind === 'decoration');
  assert.equal(decorations.length, 1);
  const rects = attribute(decorations[0], decorationSchema.buffers.rect);
  const start = decorations[0].userData.pmndrsGlyphRunStart;
  const actual = Array.from({ length: decorations[0].geometry.instanceCount }, (_, i) => ({
    left: rects.getX(start + i),
    width: rects.getZ(start + i),
  }));
  assert.equal(actual.length, expected.length, `underlines ${JSON.stringify(actual)} skip the red cluster`);
  for (const [i, rect] of expected.entries()) {
    assert.ok(Math.abs(actual[i].left - rect.left) < 0.05, `underline ${i} starts at its own cluster`);
    assert.ok(Math.abs(actual[i].width - rect.width) < 0.05, `underline ${i} covers only its own cluster`);
  }

  let reds = 0;
  for (const draw of draws.filter((d) => d.userData.pmndrsGlyphPrimitiveKind === 'glyph')) {
    const color = attribute(draw, bitmapSchema.buffers.color);
    const first = draw.userData.pmndrsGlyphRunStart;
    for (let i = 0; i < draw.geometry.instanceCount; i++) {
      reds += Number(color.getY(first + i) === 0 && color.getX(first + i) === 1);
    }
  }
  assert.equal(reds, 2, 'the two red glyphs keep their paint');
}
