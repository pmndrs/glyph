/**
 * Incremental text mutation, verified through to the GPU.
 *
 * Every lane this engine already tested -- `measureLayout`, `inspectLayout`, glyph ids, glyph
 * origins, draw counts, `instanceCount` -- reads the ENGINE. The packed instanced attributes are
 * what the GPU actually samples, and nothing asserted them. An incremental edit that leaves one
 * record slot holding its pre-edit occupant therefore passes every engine-side check while
 * rendering the wrong glyph, which is exactly the defect this file exists to catch.
 *
 * The oracle is construction from scratch. A node edited into some text may not differ, in any
 * lane, from a node built with that text: same glyphs, same layout, same packed bytes. That
 * invariant needs no knowledge of what each buffer means, so it holds as techniques and packing
 * policies change.
 *
 * Sequences are seeded and fixed. A failure names the case and step that reproduce it, with no
 * wall-clock input and no `Math.random`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { createTextRuntime, FontRegistry } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import * as THREE from 'three/webgpu';

const fixtures = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const dataUrl = (bytes) => `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
const timeout = 5 * 60 * 1_000;

/** The product-shaped box from the reported regression: centered, single line, clipped. */
const contentBox = {
  align: 'center',
  maxLines: 1,
  overflow: 'clip',
  width: { mode: 'exact', size: 96 },
  wrap: 'none',
};
const style = { fontSize: 6, lineHeight: 1 };
const paint = { color: '#ffffff' };

const TECHNIQUES = {
  bitmap: { file: 'inter-bitmap-16.font.glb', gzip: false, raster: { technique: bitmap, options: { strikes: [16] } } },
  msdf: { file: 'inter-mtsdf.font.glb.gz', gzip: true, raster: { technique: msdf } },
  slug: { file: 'inter-slug.font.glb.gz', gzip: true, raster: { technique: slug } },
};

async function loadFont(name) {
  const spec = TECHNIQUES[name];
  const runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  const bytes = await readFile(new URL(spec.file, fixtures));
  return runtime.loadFont({
    input: { baked: dataUrl(spec.gzip ? gunzipSync(bytes) : bytes) },
    raster: spec.raster,
  });
}

function mount(font, text) {
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const node = new Text({ contentBox, font, paint, style, text });
  group.add(node);
  scene.updateMatrixWorld(true);
  return { group, node, scene };
}

/**
 * Read every lane a draw exposes, engine-side and GPU-side.
 *
 * Only the first `instanceCount` instances are read: capacity beyond the committed run is
 * allowed to hold anything, and asserting it would fail on legal slack rather than on a defect.
 */
function lanes(group, node) {
  const layout = node.inspectLayout();
  const measured = node.measureLayout();
  const draws = [];
  group.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined) return;
    const geometry = object.geometry;
    if (geometry === undefined) return;
    const instances = geometry.instanceCount;
    const attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes ?? {})) {
      // Per-vertex attributes describe the unit quad, not the run, so they carry no edit state.
      if (!(attribute instanceof THREE.InstancedBufferAttribute)) continue;
      const width = attribute.itemSize ?? 1;
      const values = [...attribute.array].slice(0, instances * width);
      // Float lanes are compared at a fixed precision so representation noise cannot decide a
      // comparison; integer lanes are compared exactly.
      attributes[name] =
        attribute.array instanceof Float32Array ? values.map((v) => Math.round(v * 1_000) / 1_000) : values;
    }
    draws.push({ attributes, instances, start: object.userData.pmndrsGlyphRunStart });
  });
  draws.sort((left, right) => left.start - right.start);
  return {
    draws,
    glyphCount: measured?.glyphCount,
    glyphIds: [...(layout?.glyphIds ?? [])],
    glyphStableIds: [...(layout?.glyphStableIds ?? [])],
    lineCount: measured?.lineCount,
    x: [...(layout?.x ?? [])].map((v) => Math.round(v * 1_000) / 1_000),
    y: [...(layout?.y ?? [])].map((v) => Math.round(v * 1_000) / 1_000),
  };
}

/**
 * Assert an edited node is indistinguishable from one built with the same text.
 *
 * Stable ids are compared separately and only for length: identity is expected to differ, because
 * retaining a glyph across an edit is the point of the incremental path. Every other lane, packed
 * bytes included, must agree exactly.
 */
function assertMatchesFreshBuild(font, node, group, text, context) {
  const fresh = mount(font, text);
  const want = lanes(fresh.group, fresh.node);
  const got = lanes(group, node);

  assert.equal(got.glyphCount, want.glyphCount, `${context}: glyph count`);
  assert.equal(got.lineCount, want.lineCount, `${context}: line count`);
  assert.deepEqual(got.glyphIds, want.glyphIds, `${context}: glyph ids`);
  assert.deepEqual(got.x, want.x, `${context}: glyph x origins`);
  assert.deepEqual(got.y, want.y, `${context}: glyph y origins`);
  assert.equal(got.glyphStableIds.length, want.glyphStableIds.length, `${context}: stable id lane length`);

  assert.equal(got.draws.length, want.draws.length, `${context}: draw count`);
  for (const [index, draw] of got.draws.entries()) {
    const expected = want.draws[index];
    assert.equal(draw.instances, expected.instances, `${context}: draw ${index} instanceCount`);
    assert.deepEqual(
      Object.keys(draw.attributes).sort(),
      Object.keys(expected.attributes).sort(),
      `${context}: draw ${index} attribute set`,
    );
    for (const name of Object.keys(draw.attributes)) {
      // The packed lane. This is what the GPU samples, and the only lane that caught the defect.
      assert.deepEqual(draw.attributes[name], expected.attributes[name], `${context}: draw ${index} packed ${name}`);
    }
  }
  fresh.node.dispose();
}

/** Every edit class the incremental path distinguishes, each as (from, to). */
const EDIT_CLASSES = [
  ['deletion between a shared prefix and suffix', 'ACTIVATE', 'ACTIVE'],
  ['deletion of an interior span', 'ABXYZC', 'ABC'],
  ['suffix-only deletion', 'RUNNING', 'RUN'],
  ['prefix-only deletion', 'PREFIXED', 'FIXED'],
  ['insertion between a shared prefix and suffix', 'ACTIVE', 'ACTIVATE'],
  ['insertion at the suffix', 'RUN', 'RUNNING'],
  ['insertion at the prefix', 'FIXED', 'PREFIXED'],
  ['same-length substitution', 'ACTIVE', 'ARCHER'],
  ['shrink to empty', 'ACTIVE', ''],
  ['grow from empty', '', 'ACTIVE'],
  ['single character to single character', 'A', 'E'],
  ['collapse to one character', 'ACTIVATE', 'A'],
];

for (const technique of Object.keys(TECHNIQUES)) {
  for (const [label, from, to] of EDIT_CLASSES) {
    test(`${technique}: ${label}`, { timeout }, async () => {
      const font = await loadFont(technique);
      const { group, node, scene } = mount(font, from);
      node.set({ contentBox, font, paint, spans: [], style, text: to });
      scene.updateMatrixWorld(true);
      assertMatchesFreshBuild(font, node, group, to, `${technique} ${from}->${to}`);
    });
  }

  test(`${technique}: repeated edits without remounting`, { timeout }, async () => {
    const font = await loadFont(technique);
    const { group, node, scene } = mount(font, 'ACTIVATE');
    for (const [step, text] of ['ACTIVE', 'ACTIVATE', 'ACTIVE', 'ACTIVATE', 'ACTIVE'].entries()) {
      node.set({ contentBox, font, paint, spans: [], style, text });
      scene.updateMatrixWorld(true);
      assertMatchesFreshBuild(font, node, group, text, `${technique} toggle step ${step} -> ${text}`);
    }
  });

  test(`${technique}: seeded chaotic edit sequences`, { timeout }, async () => {
    const font = await loadFont(technique);
    // A small alphabet with real kern pairs and repeated letters, so edits land on shared
    // prefixes and suffixes far more often than random text would.
    const alphabet = 'ACEIRTVX';
    for (const seed of [1, 7, 13, 29]) {
      const random = seededRandom(seed);
      const { group, node, scene } = mount(font, 'ACTIVATE');
      let text = 'ACTIVATE';
      for (let step = 0; step < 12; step += 1) {
        text = chaoticEdit(text, alphabet, random);
        node.set({ contentBox, font, paint, spans: [], style, text });
        scene.updateMatrixWorld(true);
        assertMatchesFreshBuild(font, node, group, text, `${technique} seed ${seed} step ${step} -> ${JSON.stringify(text)}`);
      }
    }
  });
}

/** Splice a random range and insert a random run, so deletions, insertions, and replacements mix. */
function chaoticEdit(text, alphabet, random) {
  const start = Math.floor(random() * (text.length + 1));
  const end = start + Math.floor(random() * Math.max(1, text.length - start + 1));
  const insertLength = Math.floor(random() * 4);
  let insert = '';
  for (let index = 0; index < insertLength; index += 1) {
    insert += alphabet[Math.floor(random() * alphabet.length)];
  }
  const next = text.slice(0, start) + insert + text.slice(Math.min(end, text.length));
  // An edit that changes nothing exercises no path; nudge it into one that does.
  return next === text ? text.slice(0, Math.max(0, text.length - 1)) : next;
}

/** Deterministic 32-bit PRNG. Seeded sequences make a failure exactly reproducible. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
