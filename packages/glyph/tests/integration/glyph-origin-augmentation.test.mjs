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
 * Backing is proved POSITIVELY, by writing a per-glyph sentinel through `setGlyphOrigins` and
 * reading it back: an override only lands where a record exists, so an unbacked glyph reports the
 * layout fallback instead of its sentinel. Comparing a snapshot against the fallback proves
 * nothing on its own -- if every record were missing, every glyph would report the fallback and
 * agree with it.
 *
 * The staleness oracle is construction from scratch: a node edited into some text may not disagree
 * with a node built with that text. It compares the augmentation lane against itself across two
 * paths rather than against the layout lane, so it stays correct without asserting which
 * coordinate space the buffer uses.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
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

// One Wasm runtime and one baked font for the whole file; each test mounts its own scene on them.
let runtime;
let loaded;

async function loadFont() {
  if (loaded !== undefined) return loaded;
  runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  loaded = await runtime.loadFont({
    input: { baked: dataUrl(gunzipSync(await readFile(new URL('inter-slug.font.glb.gz', fixtures)))) },
    raster: { technique: slug },
  });
  return loaded;
}

after(() => {
  runtime?.dispose();
  runtime = undefined;
  loaded = undefined;
});

function mount(font, text) {
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const node = new Text({ contentBox, font, paint, style, text });
  group.add(node);
  scene.updateMatrixWorld(true);
  return { group, node, scene };
}

function unmount(mounted) {
  mounted.node.dispose();
  mounted.group.dispose();
}

/** Round to a stable precision so float noise cannot decide a comparison. */
const fixed = (values) => [...values].map((value) => Math.round(value * 1000) / 1000);

test('every committed glyph is origin-record backed', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'ACTIVE');
  try {
    const before = mounted.node.snapshotGlyphOrigins();
    assert.ok(before.layout.glyphStableIds.length > 0, 'the fixture committed no glyphs to check');

    // Sentinels are far outside any plausible layout coordinate, so a glyph that reports its
    // sentinel is provably reading its record and not the fallback the snapshot substitutes.
    const x = before.shapedX.map((_, index) => -9_000 - index);
    const y = before.shapedY.map((_, index) => 9_000 + index);
    mounted.node.setGlyphOrigins({ layout: before.layout, x, y });

    const overridden = mounted.node.snapshotGlyphOrigins();
    assert.deepEqual([...overridden.displayedX], [...x], 'a glyph without an origin record kept the layout fallback');
    assert.deepEqual([...overridden.displayedY], [...y], 'a glyph without an origin record kept the layout fallback');
    // The recorded origin is the pre-override value, which is what `clear` must restore.
    assert.deepEqual(fixed(overridden.shapedX), fixed(before.shapedX), 'an override rewrote the recorded origin');
    assert.deepEqual(fixed(overridden.shapedY), fixed(before.shapedY), 'an override rewrote the recorded origin');

    mounted.node.clearGlyphOriginOverrides();
    const cleared = mounted.node.snapshotGlyphOrigins();
    assert.deepEqual(fixed(cleared.displayedX), fixed(before.displayedX), 'clearing did not restore every record');
    assert.deepEqual(fixed(cleared.displayedY), fixed(before.displayedY), 'clearing did not restore every record');
  } finally {
    unmount(mounted);
  }
});

test('an edited node reports the origins of a node built with the same text', async () => {
  const font = await loadFont();
  const control = mount(font, 'ACTIVE');
  const mounted = mount(font, 'ACTIVATE');
  try {
    const want = control.node.snapshotGlyphOrigins();
    mounted.node.set({ contentBox, font, paint, spans: [], style, text: 'ACTIVE' });
    mounted.scene.updateMatrixWorld(true);
    const edited = mounted.node.snapshotGlyphOrigins();

    for (const lane of ['shapedX', 'shapedY', 'displayedX', 'displayedY']) {
      assert.deepEqual(fixed(edited[lane]), fixed(want[lane]), `edited ${lane} diverged from a fresh build`);
    }
  } finally {
    unmount(mounted);
    unmount(control);
  }
});

test('repeated edits keep the origin lane addressable', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'ACTIVATE');
  try {
    // Deletion and insertion alternate so the run both shrinks and grows, which is what retires and
    // reallocates the records the lane indexes.
    for (const text of ['ACTIVE', 'ACTIVATE', 'ACTIVE', 'ACTIVATE', 'ACTIVE']) {
      mounted.node.set({ contentBox, font, paint, spans: [], style, text });
      mounted.scene.updateMatrixWorld(true);
      const control = mount(font, text);
      try {
        const want = control.node.snapshotGlyphOrigins();
        const edited = mounted.node.snapshotGlyphOrigins();
        for (const lane of ['shapedX', 'shapedY', 'displayedX', 'displayedY']) {
          assert.deepEqual(fixed(edited[lane]), fixed(want[lane]), `${lane} diverged after editing to ${text}`);
        }
      } finally {
        unmount(control);
      }
    }
  } finally {
    unmount(mounted);
  }
});
