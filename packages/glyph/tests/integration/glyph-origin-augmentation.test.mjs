/**
 * Glyph-origin augmentation gate.
 *
 * The origin lane indexes the live per-glyph origin buffer by stable glyph identity so an
 * application can read committed origins and override them. Two invariants make it trustworthy,
 * and both were broken:
 *
 *   1. Every committed glyph must be record-backed. A missing record is not benign: the snapshot
 *      silently substituted the caller's layout-space fallback, returning one array holding two
 *      different coordinate spaces with nothing marking the boundary.
 *   2. The records must describe the CURRENT plan. `restoreGlyphs` writes the recorded
 *      origin back into the buffer the renderer reads, so a stale record does not merely misreport
 *      -- it corrupts what is drawn.
 *
 * The API now states both facts itself -- `GlyphPlacements.incomplete` names every glyph whose
 * record could not be read, and `applyGlyphs` returns what it did not reach -- so these tests
 * assert the stated reports AND prove them independently.
 *
 * Backing is proved POSITIVELY, by writing a per-glyph sentinel through `applyGlyphs` and reading it
 * back: an override only lands where a record exists, so an unbacked glyph reports the shaped origin
 * instead of its sentinel. Comparing a snapshot against the shaped origins proves nothing on its own
 * -- if every record were missing, every glyph would report the shaped origin and agree with it. The
 * sentinel is what keeps `incomplete` honest rather than self-confirming.
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

import { FontLoader, Text, TextGroup } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import * as THREE from 'three/webgpu';

const fixtures = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);

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
let loader;
let loaded;

async function loadFont() {
  if (loaded !== undefined) return loaded;
  loader = new FontLoader();
  loaded = await loader.loadAsync({
    input: {
      baked: {
        bytes: gunzipSync(await readFile(new URL('inter-slug.font.glb.gz', fixtures))),
        ownership: 'copy',
      },
    },
    raster: { technique: slug },
  });
  return loaded;
}

after(() => {
  loaded?.dispose();
  loader?.dispose();
  loader = undefined;
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

test('every committed glyph is origin-record backed, and the API says so', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'ACTIVE');
  try {
    const before = mounted.node.snapshotGlyphs();
    assert.ok(before.glyphs.length > 0, 'the fixture committed no glyphs to check');

    // The API now states backing directly. The sentinel round-trip below is kept as the independent
    // oracle: it proves the stated report by observation rather than by trusting the same code path.
    assert.deepEqual([...before.incomplete], [], 'a committed glyph had no origin record');

    // Sentinels are far outside any plausible layout coordinate, so a glyph that reports its
    // sentinel is provably reading its record and not a substituted layout value.
    for (const glyph of before.glyphs) {
      glyph.x = -9_000 - glyph.index;
      glyph.y = 9_000 + glyph.index;
    }
    const application = mounted.node.applyGlyphs(before);
    assert.equal(application.requested, before.glyphs.length);
    assert.equal(application.applied, application.requested, 'a write did not reach every glyph');
    assert.deepEqual([...application.unapplied], [], 'a write skipped a glyph');

    const overridden = mounted.node.snapshotGlyphs();
    assert.deepEqual(
      overridden.glyphs.map((glyph) => glyph.x),
      before.glyphs.map((glyph) => -9_000 - glyph.index),
      'a glyph without an origin record kept a substituted position',
    );
    assert.deepEqual(
      overridden.glyphs.map((glyph) => glyph.y),
      before.glyphs.map((glyph) => 9_000 + glyph.index),
      'a glyph without an origin record kept a substituted position',
    );
    // The shaped origin is the pre-override value, which is what `restoreGlyphs` must put back.
    assert.deepEqual(
      fixed(overridden.glyphs.map((glyph) => glyph.shapedX)),
      fixed(before.glyphs.map((glyph) => glyph.shapedX)),
      'an override rewrote the shaped origin',
    );

    mounted.node.restoreGlyphs();
    const cleared = mounted.node.snapshotGlyphs();
    assert.deepEqual(
      fixed(cleared.glyphs.map((glyph) => glyph.x)),
      fixed(cleared.glyphs.map((glyph) => glyph.shapedX)),
      'restoring did not return every glyph to its shaped origin',
    );
    assert.deepEqual(
      fixed(cleared.glyphs.map((glyph) => glyph.y)),
      fixed(cleared.glyphs.map((glyph) => glyph.shapedY)),
      'restoring did not return every glyph to its shaped origin',
    );
  } finally {
    unmount(mounted);
  }
});

test('an edited node reports the origins of a node built with the same text', async () => {
  const font = await loadFont();
  const control = mount(font, 'ACTIVE');
  const mounted = mount(font, 'ACTIVATE');
  try {
    const want = control.node.snapshotGlyphs();
    mounted.node.set({ contentBox, font, paint, spans: [], style, text: 'ACTIVE' });
    mounted.scene.updateMatrixWorld(true);
    const edited = mounted.node.snapshotGlyphs();

    for (const lane of ['shapedX', 'shapedY', 'x', 'y']) {
      assert.deepEqual(
        fixed(edited.glyphs.map((glyph) => glyph[lane])),
        fixed(want.glyphs.map((glyph) => glyph[lane])),
        `edited ${lane} diverged from a fresh build`,
      );
    }
    // Identity is the point of the lane, so it is compared too rather than only the coordinates.
    assert.deepEqual(
      edited.glyphs.map((glyph) => glyph.key),
      want.glyphs.map((glyph) => glyph.key),
      'an edited node produced different glyph identities than a fresh build',
    );
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
        const want = control.node.snapshotGlyphs();
        const edited = mounted.node.snapshotGlyphs();
        assert.deepEqual([...edited.incomplete], [], `a glyph lost its record after editing to ${text}`);
        for (const lane of ['shapedX', 'shapedY', 'x', 'y']) {
          assert.deepEqual(
            fixed(edited.glyphs.map((glyph) => glyph[lane])),
            fixed(want.glyphs.map((glyph) => glyph[lane])),
            `${lane} diverged after editing to ${text}`,
          );
        }
      } finally {
        unmount(control);
      }
    }
  } finally {
    unmount(mounted);
  }
});

test('a snapshot taken before a reflow cannot be written to the layout that replaced it', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'ACTIVATE');
  try {
    const stale = mounted.node.snapshotGlyphs();
    mounted.node.set({ contentBox, font, paint, spans: [], style, text: 'ACTIVE' });
    mounted.scene.updateMatrixWorld(true);
    // The identities in `stale` address glyphs the current layout no longer has. Writing it would
    // move whichever records inherited those slots, which is precisely the corruption the retained
    // buffer makes possible and the reason the snapshot carries its layout.
    assert.throws(() => mounted.node.applyGlyphs(stale), TypeError);
  } finally {
    unmount(mounted);
  }
});
