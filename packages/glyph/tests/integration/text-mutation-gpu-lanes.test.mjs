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
 * Both sides of every comparison are produced by the same packing code from the same authored
 * inputs, so every lane is compared bit-for-bit. Rounding here would hide exactly the corruption
 * the file exists to detect: a stale slot whose retained bytes happen to be close to the correct
 * ones.
 *
 * Sequences are seeded and fixed. A failure names the case and step that reproduce it, with no
 * wall-clock input and no `Math.random`.
 *
 * NOT COVERED: the stable-indirect allocation policy. `ThreeTextEngineCoordinator` registers the
 * Three policy with `threeRenderPolicyBytes`'s default `'ordered'` allocation mode and
 * `ThreeTextEngineCoordinatorOptions` exposes only `transformMode`, so no first-party path
 * reachable from `Text`/`TextGroup` selects `'stable'`. Covering it needs either a coordinator
 * option or a host-level test that drives `TextEngineHost` directly, as
 * `three-engine-runtime.test.mjs` does.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { createTextRuntime, FontRegistry } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import * as THREE from 'three/webgpu';

// The identity lane is named by the policy contract that packs it, not by a literal here.
import { STABLE_GLYPH_BUFFER_ID } from '../../dist/three/render-policy.js';

const IDENTITY_LANE = `_pmndrsGlyph_${STABLE_GLYPH_BUFFER_ID}`;

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
/** Wide enough that mixed span sizes stay inside the line instead of clipping into it. */
const wideContentBox = { ...contentBox, width: { mode: 'exact', size: 320 } };
const style = { fontSize: 6, lineHeight: 1 };
const paint = { color: '#ffffff' };

const TECHNIQUES = {
  bitmap: { file: 'inter-bitmap-16.font.glb', gzip: false, raster: { technique: bitmap, options: { strikes: [16] } } },
  msdf: { file: 'inter-mtsdf.font.glb.gz', gzip: true, raster: { technique: msdf } },
  slug: { file: 'inter-slug.font.glb.gz', gzip: true, raster: { technique: slug } },
};

// One Wasm runtime and one baked font per technique for the whole file. Every mount in here is a
// scene built on top of them, so loading per test would retain dozens of runtimes for no coverage.
let runtime;
const loadedFonts = new Map();

async function loadFont(name) {
  const cached = loadedFonts.get(name);
  if (cached !== undefined) return cached;
  runtime ??= await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  const spec = TECHNIQUES[name];
  const bytes = await readFile(new URL(spec.file, fixtures));
  const font = await runtime.loadFont({
    input: { baked: dataUrl(spec.gzip ? gunzipSync(bytes) : bytes) },
    raster: spec.raster,
  });
  loadedFonts.set(name, font);
  return font;
}

after(() => {
  runtime?.dispose();
  runtime = undefined;
  loadedFonts.clear();
});

/**
 * Author one paragraph's content.
 *
 * Spans are derived from the text rather than fixed, so an edited node and a node freshly built
 * with the same text always carry identical authored style -- the comparison stays a test of the
 * incremental path, not of two different documents.
 */
function paragraph(text, { box = contentBox, position, rasterPixelRatio, styled = false } = {}) {
  return {
    position,
    properties: {
      contentBox: box,
      paint,
      spans: styled ? spansFor(text) : [],
      style,
      text,
      ...(rasterPixelRatio === undefined ? {} : { rasterPixelRatio }),
    },
  };
}

/** Two leading runs in different colours and sizes; the remainder keeps the paragraph defaults. */
function spansFor(text) {
  if (text.length < 3) return [];
  const third = Math.floor(text.length / 3);
  return [
    { start: 0, end: third, paint: { color: '#ff2f00' }, style: { fontSize: 9, lineHeight: 1 } },
    { start: third, end: third * 2, paint: { color: '#0040ff' }, style: { fontSize: 4, lineHeight: 1 } },
  ];
}

/** Build a group holding one Text node per authored paragraph. */
function mount(font, paragraphs) {
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const nodes = paragraphs.map(({ position, properties }) => {
    const node = new Text({ font, ...properties });
    if (position !== undefined) node.position.set(...position);
    group.add(node);
    return node;
  });
  scene.updateMatrixWorld(true);
  return { group, nodes, scene };
}

function unmount(mounted) {
  for (const node of mounted.nodes) node.dispose();
  mounted.group.dispose();
}

/** Re-author every node in a mounted scene and re-synchronize. */
function edit(mounted, font, paragraphs) {
  for (const [index, { properties }] of paragraphs.entries()) {
    mounted.nodes[index].set({ font, ...properties });
  }
  mounted.scene.updateMatrixWorld(true);
}

/**
 * Read every lane a scene exposes, engine-side and GPU-side.
 *
 * Every draw in a group shares one retained buffer per policy lane and addresses its own run
 * through `pmndrsGlyphRunStart`, so a lane must be read from `start` rather than from the head of
 * the array. Only the run's own `instanceCount` records are read: capacity beyond it is allowed to
 * hold anything, and asserting it would fail on legal slack rather than on a defect.
 */
function lanes(mounted) {
  const draws = [];
  mounted.group.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined) return;
    const geometry = object.geometry;
    if (geometry === undefined) return;
    const instances = geometry.instanceCount;
    const start = object.userData.pmndrsGlyphRunStart;
    const attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes ?? {})) {
      // Per-vertex attributes describe the unit quad, not the run, so they carry no edit state.
      if (!(attribute instanceof THREE.InstancedBufferAttribute)) continue;
      const width = attribute.itemSize ?? 1;
      attributes[name] = [...attribute.array].slice(start * width, (start + instances) * width);
    }
    draws.push({ attributes, instances, start });
  });
  draws.sort((left, right) => left.start - right.start);
  const paragraphs = mounted.nodes.map((node) => {
    const layout = node.inspectLayout();
    const measured = node.measureLayout();
    return {
      glyphCount: measured?.glyphCount,
      glyphIds: [...(layout?.glyphIds ?? [])],
      glyphStableIds: [...(layout?.glyphStableIds ?? [])],
      lineCount: measured?.lineCount,
      x: [...(layout?.x ?? [])],
      y: [...(layout?.y ?? [])],
    };
  });
  return {
    draws,
    // Record slots are allocated across the whole group in paragraph order, so the identity a
    // draw's slot must carry is read out of this concatenation by `pmndrsGlyphRunStart`.
    identities: paragraphs.flatMap((entry) => entry.glyphStableIds),
    paragraphs,
  };
}

/**
 * Assert an edited scene is indistinguishable from one built with the same content.
 *
 * Stable ids are compared separately and only for length: identity is expected to differ, because
 * retaining a glyph across an edit is the point of the incremental path. That exemption covers the
 * packed identity lane too -- it carries the same allocation-order ids -- so that lane is instead
 * held to the stronger local invariant that it equals the engine's committed identities for the
 * run it draws. A slot left holding its pre-edit occupant breaks that equality. Every other lane,
 * packed bytes included, must agree exactly with the fresh build.
 */
function assertMatchesFreshBuild(font, mounted, paragraphs, context) {
  const fresh = mount(font, paragraphs);
  try {
    const want = lanes(fresh);
    const got = lanes(mounted);

    assert.equal(got.paragraphs.length, want.paragraphs.length, `${context}: paragraph count`);
    for (const [index, entry] of got.paragraphs.entries()) {
      const expected = want.paragraphs[index];
      const where = `${context}: paragraph ${index}`;
      assert.equal(entry.glyphCount, expected.glyphCount, `${where} glyph count`);
      assert.equal(entry.lineCount, expected.lineCount, `${where} line count`);
      assert.deepEqual(entry.glyphIds, expected.glyphIds, `${where} glyph ids`);
      assert.deepEqual(entry.x, expected.x, `${where} glyph x origins`);
      assert.deepEqual(entry.y, expected.y, `${where} glyph y origins`);
      assert.equal(entry.glyphStableIds.length, expected.glyphStableIds.length, `${where} stable id lane length`);
    }

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
        if (name === IDENTITY_LANE) {
          // Held to the engine's own committed identities rather than to the fresh build's.
          assert.deepEqual(
            draw.attributes[name],
            got.identities.slice(draw.start, draw.start + draw.instances),
            `${context}: draw ${index} packed ${name} against committed identities`,
          );
          continue;
        }
        // The packed lane. This is what the GPU samples, and the only lane that caught the defect.
        assert.deepEqual(draw.attributes[name], expected.attributes[name], `${context}: draw ${index} packed ${name}`);
      }
    }
  } finally {
    unmount(fresh);
  }
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

/**
 * A three-node group with per-span colours and sizes and per-node raster pixel ratios.
 *
 * One paragraph in uniform white at one size leaves the foreground, `fontSize`, and
 * `transformIndex` lanes constant, so a slot corrupted in exactly those lanes reads back correct
 * by accident. Distinct positions, sizes, and colours make each of those lanes carry a value that
 * identifies its own slot.
 *
 * `rasterPixelRatio` is not itself a packed lane -- no first-party program in `render-policy.ts`
 * reads it -- but it is one of the two resource-selection inputs, so varying it per node drives
 * the gather's selection-change branch, the one that widens a narrow change mask to every input.
 * It cannot select a DIFFERENT resource here: these fixtures bake one strike and one page each,
 * and requesting more strikes needs retained source bytes the fixtures do not carry.
 */
function styledScene(texts) {
  return texts.map((text, index) =>
    paragraph(text, {
      box: wideContentBox,
      position: [index * 24, index * -12, index * 3],
      rasterPixelRatio: 1 + index,
      styled: true,
    }),
  );
}

for (const technique of Object.keys(TECHNIQUES)) {
  for (const [label, from, to] of EDIT_CLASSES) {
    test(`${technique}: ${label}`, { timeout }, async () => {
      const font = await loadFont(technique);
      const mounted = mount(font, [paragraph(from)]);
      try {
        edit(mounted, font, [paragraph(to)]);
        assertMatchesFreshBuild(font, mounted, [paragraph(to)], `${technique} ${from}->${to}`);
      } finally {
        unmount(mounted);
      }
    });

    test(`${technique}: ${label} across a styled multi-node group`, { timeout }, async () => {
      const font = await loadFont(technique);
      // The edit lands on the middle node, so the nodes around it must keep their own transform,
      // colour, and size lanes while the record run under them shifts.
      const before = styledScene(['STEADY', from, 'ANCHOR']);
      const edited = styledScene(['STEADY', to, 'ANCHOR']);
      const mounted = mount(font, before);
      try {
        edit(mounted, font, edited);
        assertMatchesFreshBuild(font, mounted, edited, `${technique} styled group ${from}->${to}`);
      } finally {
        unmount(mounted);
      }
    });
  }

  test(`${technique}: repeated edits without remounting`, { timeout }, async () => {
    const font = await loadFont(technique);
    const mounted = mount(font, [paragraph('ACTIVATE')]);
    try {
      for (const [step, text] of ['ACTIVE', 'ACTIVATE', 'ACTIVE', 'ACTIVATE', 'ACTIVE'].entries()) {
        edit(mounted, font, [paragraph(text)]);
        assertMatchesFreshBuild(font, mounted, [paragraph(text)], `${technique} toggle step ${step} -> ${text}`);
      }
    } finally {
      unmount(mounted);
    }
  });

  test(`${technique}: seeded chaotic edit sequences`, { timeout }, async () => {
    const font = await loadFont(technique);
    // A small alphabet with real kern pairs and repeated letters, so edits land on shared
    // prefixes and suffixes far more often than random text would.
    const alphabet = 'ACEIRTVX';
    for (const seed of [1, 7, 13, 29]) {
      const random = seededRandom(seed);
      // Every seed drives a styled three-node group, so a chaotic edit has to keep the untouched
      // nodes' colour, size, transform, and ratio lanes intact as well as its own.
      let texts = ['ACTIVATE', 'ACTIVATE', 'ACTIVATE'];
      const mounted = mount(font, styledScene(texts));
      try {
        for (let step = 0; step < 12; step += 1) {
          texts = texts.map((text) => chaoticEdit(text, alphabet, random));
          const authored = styledScene(texts);
          edit(mounted, font, authored);
          assertMatchesFreshBuild(
            font,
            mounted,
            authored,
            `${technique} seed ${seed} step ${step} -> ${JSON.stringify(texts)}`,
          );
        }
      } finally {
        unmount(mounted);
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
