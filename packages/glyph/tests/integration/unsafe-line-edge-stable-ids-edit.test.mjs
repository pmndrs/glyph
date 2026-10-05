import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import * as THREE from 'three/webgpu';
import { ThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace3 shapes an `a` alone at a line start as the two glyphs `a a.tail`, so a line-start edge record draws one
// glyph more than the paragraph cluster owns. Its stable id must follow the cluster's text unit, not its text offset.
const fixtureUrl = new URL('../../../../benches/fixtures/rendering/cross-space-3-bitmap-16.font.glb', import.meta.url);
const A = 27;
const A_TAIL = 102;

const lines = (paragraph, scene, text) => {
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

test('an edge glyph keeps its stable id when text inserted before it moves its offset', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fixtureUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle('three:integration:unsafe-line-edge-stable-ids-edit', {
    ...ThreeConfig,
    // A renderer that acknowledges every frame, so each relayout commits as it does under a real renderer.
    renderer: () => ({
      decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
      syncTransforms: () => undefined,
      dispose: () => undefined,
    }),
  });
  const before =
    'the apple ate a banana while the eagle and the ape made a cake at the lake; a bee came and ate a pear';
  const after = before.replace('the apple', 'thee apple');
  const scene = new THREE.Scene();
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  let compared = 0;
  for (const width of [200, 220, 340]) {
    const paragraph = root.createText({
      font,
      text: before,
      style: { fontSize: 24 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size: width } },
    });
    scene.add(paragraph);
    const first = lines(paragraph, scene, before);
    paragraph.text = after;
    const second = lines(paragraph, scene, after);
    for (const line of first) {
      const same = second.find((other) => other.text === line.text);
      if (same === undefined || !line.text.startsWith('a') || line.ids[1] !== A_TAIL) continue;
      assert.equal(line.ids[0], A, `"${line.text}" starts with the edge's two glyphs`);
      assert.deepEqual(same.stable, line.stable, `width ${String(width)}: "${line.text}" keeps its glyph stable ids`);
      compared += 1;
    }
    assert.equal(new Set(second.flatMap((line) => line.stable)).size, second.flatMap((line) => line.stable).length);
    scene.remove(paragraph);
    paragraph.dispose();
  }
  assert.equal(compared > 0, true, 'an edge line survives the insertion unchanged');
});
