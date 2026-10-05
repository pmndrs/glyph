import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import * as THREE from 'three/webgpu';
import { ThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace3 substitutes `space a' -> a.init` in the paragraph, while an `a` shaped alone at a line start becomes
// the two glyphs `a a.tail`: a line-start edge record draws one more glyph than the paragraph cluster owns.
const fixtureUrl = new URL('../../../../benches/fixtures/rendering/cross-space-3-bitmap-16.font.glb', import.meta.url);
const A = 27;
const A_TAIL = 102;
const text = 'the apple ate a banana while the eagle and the ape made a cake at the lake; a bee came and ate a pear';

const snapshot = (paragraph, scene) => {
  scene.updateMatrixWorld(true);
  glyph.shape();
  const glyphs = paragraph.glyphs();
  return Array.from(glyphs.lineTextStarts, (start, line) => {
    const first = glyphs.lineGlyphStarts[line];
    const end = first + glyphs.lineGlyphCounts[line];
    return {
      text: text.slice(start, glyphs.lineTextEnds[line]),
      ids: Array.from(glyphs.glyphIds.slice(first, end)),
      stable: Array.from(glyphs.glyphStableIds.slice(first, end)),
    };
  });
};

test('the extra glyphs of a line-start edge keep their stable ids across a relayout that keeps the break', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fixtureUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle('three:integration:unsafe-line-edge-stable-ids', {
    ...ThreeConfig,
    // A renderer that acknowledges every frame, so each relayout commits as it does under a real renderer.
    renderer: () => ({
      decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
      syncTransforms: () => undefined,
      dispose: () => undefined,
    }),
  });
  const paragraph = root.createText({
    font,
    text,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 240 } },
  });
  const scene = new THREE.Scene();
  scene.add(paragraph);
  t.after(() => {
    paragraph.dispose();
    root.dispose();
    font.dispose();
  });
  let compared = 0;
  for (const width of [200, 240, 280, 320, 360]) {
    paragraph.constraints = { width: { mode: 'exact', size: width } };
    const before = snapshot(paragraph, scene);
    paragraph.constraints = { width: { mode: 'exact', size: width + 3 } };
    const after = snapshot(paragraph, scene);
    for (const line of before) {
      const same = after.find((other) => other.text === line.text);
      if (same === undefined || !line.text.startsWith('a')) continue;
      assert.deepEqual(line.ids.slice(0, 2), [A, A_TAIL], `"${line.text}" starts with the edge's two glyphs`);
      assert.deepEqual(same.stable, line.stable, `"${line.text}" keeps its glyph stable ids`);
      compared += 1;
    }
  }
  assert.equal(compared > 0, true, 'the fixture wraps at the contextual boundary');
});
