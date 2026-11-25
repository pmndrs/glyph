/**
 * A decoration row has no identity but its place in the gather, so only its content revision tells the plan that the
 * row in the same place changed. The publication after a root's first one must still rewrite it.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFontLibrary } from '../../dist/loader.js';
import { bitmap, txt } from '@pmndrs/glyph';
import { decorationSchema } from '@pmndrs/glyph/core';
import { span } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';
import { assertCommitted } from '../support/three-render.mjs';

const UNDERLINE = { decoration: { underline: true, color: '#ff0088' } };

/** The one underline under `root` as `{ left, width }`, read from the rectangle lane its draw holds. */
function underline(root) {
  const rects = [];
  root.traverse((object) => {
    if (object.isMesh !== true || object.userData.pmndrsGlyphPrimitiveKind !== 'decoration') return;
    const rect = object.geometry.getAttribute(`_pmndrsGlyph_${decorationSchema.buffers.rect.id}`).array;
    const start = object.userData.pmndrsGlyphRunStart ?? 0;
    for (let record = start; record < start + object.geometry.instanceCount; record += 1) {
      rects.push({ left: rect[record * 4], width: rect[record * 4 + 2] });
    }
  });
  assert.equal(rects.length, 1);
  return rects[0];
}

test('the first edit of an underlined text republishes its underline', async (t) => {
  const library = createFontLibrary();
  t.after(() => library.dispose());
  const bytes = await readFile(
    new URL('../../../../benches/fixtures/rendering/amiri-bitmap-16.font.glb', import.meta.url),
  );
  const font = await library.loadFont({ baked: { bytes } }, bitmap({ strikes: [16] }));
  const three = await createThreeTestHandle(t);
  const scene = new THREE.Scene();
  const label = three.createText({ font, text: txt`${span(UNDERLINE)`iii`} x` });
  scene.add(label);
  scene.updateMatrixWorld();
  assertCommitted(label);
  const narrow = underline(label.parent);
  assert.ok(Math.abs(narrow.left + narrow.width - label.glyphs().x[3]) < 1e-3, 'the underline ends where "iii" does');
  // Three glyphs before and after: nothing about the row changes but the rectangle it holds.
  label.set({ text: txt`${span(UNDERLINE)`WWW`} x` });
  scene.updateMatrixWorld();
  assertCommitted(label);
  const wide = underline(label.parent);
  assert.ok(wide.width > narrow.width * 2, 'three wide letters');
  assert.ok(Math.abs(wide.left + wide.width - label.glyphs().x[3]) < 1e-3, 'the underline ends where "WWW" does');
  label.dispose();
});
