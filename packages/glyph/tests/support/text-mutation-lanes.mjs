/**
 * Differential harness for incremental mutation, read through to the GPU.
 *
 * The oracle is construction from scratch. A node edited into some content may not differ, in any
 * lane, from a node built with that content: same glyphs, same layout, same packed bytes. That
 * invariant needs no knowledge of what each buffer means, so it holds as techniques and packing
 * policies change, and it is the only oracle that sees a record slot left holding its pre-edit
 * occupant -- every engine-side lane reads correct while the GPU samples the wrong glyph.
 *
 * Both sides of every comparison are produced by the same packing code from the same authored
 * inputs, so every lane is compared bit-for-bit. Rounding here would hide exactly the corruption
 * this harness exists to detect: a stale slot whose retained bytes happen to be close to the
 * correct ones.
 *
 * This module owns the oracle and the scene plumbing. Each test file owns its own corpus, fixture
 * set, and authoring helpers, so the invariant cannot drift between the files that assert it.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { glyph, span, txt } from '@pmndrs/glyph';
import { FontLoader, ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

// The identity lane is named by the policy contract that packs it, not by a literal here.
import { STABLE_GLYPH_BUFFER_ID, TRANSFORM_BUFFER_ID } from '../../dist/three/render-policy.js';

export const IDENTITY_LANE = `_pmndrsGlyph_${STABLE_GLYPH_BUFFER_ID}`;
const TRANSFORM_INDEX_LANE = `_pmndrsGlyph_${TRANSFORM_BUFFER_ID}`;
const TRANSFORM_TABLE = '_pmndrsGlyphTransforms';

export const fixtures = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);

/** Node's default 30s per-test budget cannot cover baking a font plus a full edit sequence. */
export const timeout = 5 * 60 * 1_000;
let nextMountedHandle = 1;

await glyph.init();

/**
 * One immutable font per fixture, for the lifetime of a test file.
 *
 * Every mount is a scene built on top of them, so loading per test would retain dozens of runtimes
 * and re-bake identical rasters for no additional coverage.
 */
export function createFontCache(specs) {
  const loaded = new Map();
  const loader = new FontLoader();
  return {
    async load(name) {
      const cached = loaded.get(name);
      if (cached !== undefined) return cached;
      const spec = specs[name];
      if (spec === undefined) throw new Error(`no fixture named ${name}`);
      const bytes = await readFile(new URL(spec.file, fixtures));
      const font = await loader.loadAsync({
        input: {
          baked: { bytes: spec.file.endsWith('.gz') ? gunzipSync(bytes) : bytes, ownership: 'copy' },
        },
        raster: spec.raster,
      });
      loaded.set(name, font);
      return font;
    },
    dispose() {
      for (const font of loaded.values()) font.dispose();
      loaded.clear();
      loader.dispose();
    },
  };
}

/** Build a group holding one Text node per authored paragraph. */
export function mount(font, paragraphs) {
  const handle = glyph.handle(`three:test:mutation-lanes:${String(nextMountedHandle)}`, ThreeConfig);
  nextMountedHandle += 1;
  const scene = new THREE.Scene();
  const group = handle.createTextGroup();
  scene.add(group);
  const nodes = paragraphs.map(({ position, properties }) => {
    const node = handle.createText({ font, ...structuralProperties(properties) });
    if (position !== undefined) node.position.set(...position);
    group.add(node);
    return node;
  });
  scene.updateMatrixWorld(true);
  return { group, handle, nodes, scene };
}

export function unmount(mounted) {
  for (const node of mounted.nodes) node.dispose();
  mounted.group.dispose();
  mounted.handle.dispose();
}

/** Re-author every node in a mounted scene and re-synchronize. */
export function edit(mounted, font, paragraphs) {
  for (const [index, { properties }] of paragraphs.entries()) {
    mounted.nodes[index].set({ font, ...structuralProperties(properties) });
  }
  mounted.scene.updateMatrixWorld(true);
}

/** Translate test-corpus range records into structural public input before touching Text. */
function structuralProperties(properties) {
  const { spans, ...rest } = properties;
  if (!Array.isArray(spans) || spans.length === 0) return rest;
  const source = properties.text;
  if (typeof source !== 'string') throw new TypeError('mutation-lane span fixtures require string text');
  const values = [];
  let cursor = 0;
  for (const range of spans) {
    if (range.start > cursor) values.push(source.slice(cursor, range.start));
    values.push(span(range.style)`${source.slice(range.start, range.end)}`);
    cursor = range.end;
  }
  if (cursor < source.length) values.push(source.slice(cursor));
  const strings = Array.from({ length: values.length + 1 }, () => '');
  strings.raw = strings;
  return { ...rest, text: txt(strings, ...values) };
}

/**
 * Read every lane a scene exposes, engine-side and GPU-side.
 *
 * Every draw in a group shares one retained buffer per policy lane and addresses its own run
 * through `pmndrsGlyphRunStart`, so a lane must be read from `start` rather than from the head of
 * the array. Only the run's own `instanceCount` records are read: capacity beyond it is allowed to
 * hold anything, and asserting it would fail on legal slack rather than on a defect.
 */
export function lanes(mounted) {
  const draws = [];
  mounted.scene.traverse((object) => {
    if (object.userData.pmndrsGlyphRunStart === undefined) return;
    const geometry = object.geometry;
    if (geometry === undefined) return;
    const instances = geometry.instanceCount;
    const start = object.userData.pmndrsGlyphRunStart;
    const attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes ?? {})) {
      // Per-vertex attributes describe the unit quad, not the run, so they carry no edit state.
      if (!(attribute instanceof THREE.InstancedBufferAttribute)) continue;
      if (name === TRANSFORM_TABLE) continue;
      const width = attribute.itemSize ?? 1;
      attributes[name] = [...attribute.array].slice(start * width, (start + instances) * width);
    }
    const transformAttribute = geometry.getAttribute(TRANSFORM_TABLE);
    draws.push({
      attributes,
      instances,
      start,
      transformTable: transformAttribute === undefined ? undefined : [...transformAttribute.array],
    });
  });
  draws.sort((left, right) => left.start - right.start);
  const rootInverse = new THREE.Matrix4().copy(mounted.group.matrixWorld).invert();
  const relative = new THREE.Matrix4();
  const paragraphs = mounted.nodes.map((node) => {
    const layout = node.glyphs();
    const measured = node.measure();
    relative.multiplyMatrices(rootInverse, node.matrixWorld);
    return {
      glyphCount: measured?.glyphCount,
      glyphIds: [...(layout?.glyphIds ?? [])],
      glyphStableIds: [...(layout?.glyphStableIds ?? [])],
      lineCount: measured?.lineCount,
      matrix: [...new Float32Array(relative.elements)],
      x: [...(layout?.x ?? [])],
      y: [...(layout?.y ?? [])],
    };
  });
  const identityOwners = new Map();
  for (const [paragraph, entry] of paragraphs.entries()) {
    for (const identity of entry.glyphStableIds) identityOwners.set(identity, paragraph);
  }
  return {
    draws,
    // Record slots are allocated across the whole group in paragraph order, so the identity a
    // draw's slot must carry is read out of this concatenation by `pmndrsGlyphRunStart`.
    identities: paragraphs.flatMap((entry) => entry.glyphStableIds),
    identityOwners,
    paragraphs,
  };
}

/**
 * Assert an edited scene is indistinguishable from one built with the same content.
 *
 * Stable ids are compared separately and only for length: identity is expected to differ, because
 * retaining a glyph across an edit is the point of the incremental path. That exemption covers the
 * packed identity lane too -- it carries the same allocation-order ids -- so that lane is instead
 * held to a local invariant, resolved through `identityPositions` below. Every other lane, packed
 * bytes included, must agree exactly with the fresh build.
 */
export function assertMatchesFreshBuild(font, mounted, paragraphs, context) {
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
            identityPositions(got, draw, `${context}: draw ${index} edited`),
            identityPositions(want, expected, `${context}: draw ${index} fresh`),
            `${context}: draw ${index} packed ${name} against committed identities`,
          );
          continue;
        }
        if (name === TRANSFORM_INDEX_LANE) {
          assertTransformBindings(got, draw, `${context}: draw ${index} edited`);
          assertTransformBindings(want, expected, `${context}: draw ${index} fresh`);
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

/** Resolve renderer-local transform ids through each scene's own matrix table. */
function assertTransformBindings(scene, draw, where) {
  const transformIds = draw.attributes[TRANSFORM_INDEX_LANE];
  const identities = draw.attributes[IDENTITY_LANE];
  const table = draw.transformTable;
  assert.ok(transformIds !== undefined, `${where}: missing packed ${TRANSFORM_INDEX_LANE}`);
  assert.ok(identities !== undefined, `${where}: missing packed ${IDENTITY_LANE}`);
  assert.ok(table !== undefined, `${where}: missing ${TRANSFORM_TABLE}`);
  assert.equal(transformIds.length, identities.length, `${where}: transform and identity lane length`);
  for (const [record, transformId] of transformIds.entries()) {
    const owner = scene.identityOwners.get(identities[record]);
    assert.notEqual(owner, undefined, `${where}: record ${record} has no committed text owner`);
    const offset = transformId * 16;
    assert.ok(offset <= table.length - 16, `${where}: transform ${transformId} is outside its retained table`);
    assert.deepEqual(
      table.slice(offset, offset + 16),
      scene.paragraphs[owner].matrix,
      `${where}: packed ${TRANSFORM_INDEX_LANE} record ${record} resolves to its text transform`,
    );
  }
}

/**
 * Where each of a draw's slots sits in the scene's own committed identity list.
 *
 * The identity lane cannot be compared to the fresh build's values -- retaining a glyph across an
 * edit is the point of the incremental path, so the numbers legitimately differ -- and it cannot be
 * compared to a positional slice of the committed list either: a glyph that renders nothing, a
 * space above all, is committed with an identity but occupies no record slot, so the k-th slot is
 * not the k-th committed glyph. Resolving each slot's identity back to its INDEX in the committed
 * list removes both problems. The resulting index list says which committed glyphs this draw
 * renders and in what order, which is directly comparable between the two builds.
 *
 * A slot holding its pre-edit occupant fails this either way: if that identity was freed it
 * resolves to nothing, and if it was handed to another glyph it resolves to the wrong index.
 */
function identityPositions(scene, draw, where) {
  const identities = draw.attributes[IDENTITY_LANE];
  assert.equal(
    new Set(scene.identities).size,
    scene.identities.length,
    `${where} packed ${IDENTITY_LANE}: committed identities must be unique across the group for a slot to resolve to one glyph`,
  );
  return identities.map((identity) => {
    const position = scene.identities.indexOf(identity);
    assert.notEqual(
      position,
      -1,
      `${where} packed ${IDENTITY_LANE}: a record slot holds identity ${identity}, which the engine did not commit`,
    );
    return position;
  });
}

/** Assert a paragraph actually shaped what it was handed, so a green run is not a green blank. */
export function assertShaped(mounted, context, { minimumGlyphs = 1 } = {}) {
  for (const [index, node] of mounted.nodes.entries()) {
    assert.equal(node.error, undefined, `${context}: paragraph ${index} reported ${String(node.error?.message)}`);
    const measured = node.measure();
    assert.notEqual(measured, undefined, `${context}: paragraph ${index} lost its committed layout metrics`);
    assert.equal(measured.missingGlyphCount, 0, `${context}: paragraph ${index} produced .notdef glyphs`);
    assert.ok(
      measured.glyphCount >= minimumGlyphs,
      `${context}: paragraph ${index} shaped ${measured.glyphCount} glyphs, expected at least ${minimumGlyphs}`,
    );
  }
}

/** Deterministic 32-bit PRNG (mulberry32). Seeded sequences make a failure exactly reproducible. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
