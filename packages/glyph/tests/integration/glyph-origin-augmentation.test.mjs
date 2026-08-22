/**
 * Glyph-origin augmentation gate.
 *
 * The origin lane indexes the live per-glyph origin buffer by stable glyph identity so an
 * application can read committed origins and override them. Two invariants make it trustworthy,
 * and both were broken:
 *
 *   1. Every committed glyph must be record-backed. A missing record is not benign: the snapshot
 *      silently substitutes the caller's layout-space fallback, returning one array holding two
 *      different coordinate spaces with nothing marking the boundary.
 *   2. The records must describe the CURRENT plan. `clearGlyphOriginOverrides` writes the recorded
 *      origin back into the buffer the renderer reads, so a stale record does not merely misreport
 *      -- it corrupts what is drawn.
 *
 * The oracle is construction from scratch: a node edited into some text may not disagree with a
 * node built with that text. It compares the augmentation lane against itself across two paths
 * rather than against the layout lane, so it stays correct without asserting which coordinate
 * space the buffer uses.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { createTextRuntime, FontRegistry } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import * as THREE from 'three/webgpu';

const fixtures = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const dataUrl = (bytes) => `data:model/gltf-binary;base64,${bytes.toString('base64')}`;

const contentBox = {
  align: 'center',
  maxLines: 1,
  overflow: 'clip',
  width: { mode: 'exact', size: 96 },
  wrap: 'none',
};
const style = { fontSize: 6, lineHeight: 1 };
const paint = { color: '#ffffff' };

async function loadFont() {
  const runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(gunzipSync(await readFile(new URL('inter-slug.font.glb.gz', fixtures)))) },
    raster: { technique: slug },
  });
  return { font, runtime };
}

function mount(font, text) {
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const node = new Text({ contentBox, font, paint, style, text });
  group.add(node);
  scene.updateMatrixWorld(true);
  return { node, scene };
}

/** Round to a stable precision so float noise cannot decide a comparison. */
const fixed = (values) => [...values].map((value) => Math.round(value * 1000) / 1000);

test('every committed glyph is origin-record backed', async () => {
  const { font } = await loadFont();
  const { node } = mount(font, 'ACTIVE');
  const layout = node.inspectLayout();
  const snapshot = node.snapshotGlyphOrigins();

  // A record-backed glyph reports the buffer origin. An unbacked one silently reports the layout
  // fallback instead, so equality with the fallback for SOME glyphs and not others is the
  // observable signature of a partially populated lane.
  const fallbackMatches = fixed(layout.x).map((value, index) => value === fixed(snapshot.shapedX)[index]);
  assert.equal(
    fallbackMatches.every((matched) => matched === fallbackMatches[0]),
    true,
    `origin records covered only part of the glyph run: ${JSON.stringify(fallbackMatches)}`,
  );
});

test('an edited node reports the origins of a node built with the same text', async () => {
  const { font } = await loadFont();
  const control = mount(font, 'ACTIVE').node.snapshotGlyphOrigins();

  const { node, scene } = mount(font, 'ACTIVATE');
  node.set({ contentBox, font, paint, spans: [], style, text: 'ACTIVE' });
  scene.updateMatrixWorld(true);
  const edited = node.snapshotGlyphOrigins();

  assert.deepEqual(fixed(edited.shapedX), fixed(control.shapedX), 'edited shaped origins diverged from a fresh build');
  assert.deepEqual(fixed(edited.shapedY), fixed(control.shapedY), 'edited shaped origins diverged from a fresh build');
  assert.deepEqual(
    fixed(edited.displayedX),
    fixed(control.displayedX),
    'edited displayed origins diverged from a fresh build',
  );
});

test('repeated edits keep the origin lane addressable', async () => {
  const { font } = await loadFont();
  const { node, scene } = mount(font, 'ACTIVATE');

  // Deletion and insertion alternate so the run both shrinks and grows, which is what retires and
  // reallocates the records the lane indexes.
  for (const text of ['ACTIVE', 'ACTIVATE', 'ACTIVE', 'ACTIVATE', 'ACTIVE']) {
    node.set({ contentBox, font, paint, spans: [], style, text });
    scene.updateMatrixWorld(true);
    const control = mount(font, text).node.snapshotGlyphOrigins();
    const edited = node.snapshotGlyphOrigins();
    assert.deepEqual(fixed(edited.shapedX), fixed(control.shapedX), `origins diverged after editing to ${text}`);
  }
});
