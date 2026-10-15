import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import * as THREE from 'three/webgpu';
import { bitmap, glyph } from '@pmndrs/glyph';
import { PlanTransport } from '../../dist/internal/handle-state.js';
import { createThreeTestHandle } from '../support/three-handle.mjs';

await glyph.init();
const font = glyph.fontFace(
  new Blob([
    await readFile(new URL('../../../../benches/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url)),
  ]),
  { format: bitmap({ strikes: [16, 32] }) },
);
await font.load();
after(() => font.dispose());

function countQueries(t) {
  let queries = 0;
  const measure = PlanTransport.prototype.measureParagraph;
  PlanTransport.prototype.measureParagraph = function (...args) {
    queries++;
    return measure.apply(this, args);
  };
  t.after(() => {
    PlanTransport.prototype.measureParagraph = measure;
  });
  return () => queries;
}

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: ${actual} != ${expected}`);
function sameBox(actual, expected, message) {
  for (const edge of ['min', 'max'])
    for (const axis of ['x', 'y', 'z']) near(actual[edge][axis], expected[edge][axis], `${message} ${edge}.${axis}`);
}

test('layout-only measurement leaves visible ink bounds queryable and cached, with the anchor applied once', async (t) => {
  const handle = await createThreeTestHandle(t);
  const control = await createThreeTestHandle(t);
  const unanchored = control.createText({ font, text: 'Abc', style: { fontSize: 20 } });
  const expected = unanchored.computeBoundingBox().clone();
  const queries = countQueries(t);
  const text = handle.createText({
    font,
    text: 'Abc',
    style: { fontSize: 20 },
    constraints: { anchor: { x: 'center', y: 'first-baseline' } },
  });
  t.after(() => {
    text.dispose();
    unanchored.dispose();
  });
  const summary = text.measure();
  assert.equal(summary.inkBounds, undefined, 'the aggregate query intentionally skips glyph positioning');
  assert.equal(queries(), 1);
  expected.translate(new THREE.Vector3(summary.anchorOffset.x, -summary.anchorOffset.y, 0));
  const actual = text.computeBoundingBox().clone();
  assert.equal(actual.isEmpty(), false, 'unknown ink must not become a cached empty box');
  sameBox(actual, expected, 'native owner-local ink');
  assert.equal(queries(), 2, 'one positioned query supplies authoritative ink');
  for (let repeat = 0; repeat < 3; repeat++) {
    text.measure();
    sameBox(text.computeBoundingBox(), expected, 'cached native ink');
  }
  assert.equal(queries(), 2, 'same-revision layout and bounds reads reuse positioned ink');
  const raw = text.glyphs().inkBounds;
  near(actual.min.x, raw.x + summary.anchorOffset.x, 'raw ink to native minimum X');
  near(actual.max.y, -(raw.y + summary.anchorOffset.y), 'raw ink to native maximum Y');
});

test('empty and spaces-only bounds remain valid cached answers after a layout-only measurement', async (t) => {
  const handle = await createThreeTestHandle(t);
  const queries = countQueries(t);
  for (const content of ['', '   ']) {
    const text = handle.createText({ font, text: content });
    t.after(() => text.dispose());
    const before = queries();
    text.measure();
    const box = text.computeBoundingBox();
    if (content.length === 0) {
      assert.equal(box.isEmpty(), true, 'zero glyphs have no ink box');
      assert.equal(queries() - before, 1, 'zero glyphs need no positioning query');
    } else {
      assert.equal(box.getSize(new THREE.Vector3()).y, 0, 'spaces have no ink area');
      assert.ok(box.min.toArray().every(Number.isFinite), 'positioned whitespace bounds are finite');
      assert.equal(queries() - before, 2, 'whitespace positioning resolves the unknown extent once');
    }
    const knownInkQueries = queries();
    text.measure();
    assert.equal(text.computeBoundingBox(), box, 'the retained Box3 object is stable');
    assert.equal(queries(), knownInkQueries, 'known empty/zero-area ink remains cached');
  }
});

test('desired text edits invalidate ink bounds without letting an aggregate query freeze the old or empty result', async (t) => {
  const handle = await createThreeTestHandle(t);
  const text = handle.createText({ font, text: 'A', constraints: { anchor: { x: 'right', y: 'bottom' } } });
  t.after(() => text.dispose());
  const initial = text.computeBoundingBox().clone();
  const queries = countQueries(t);
  text.text = 'A much wider label';
  const summary = text.measure();
  assert.equal(summary.inkBounds, undefined);
  const next = text.computeBoundingBox().clone();
  assert.ok(next.getSize(new THREE.Vector3()).x > initial.getSize(new THREE.Vector3()).x);
  assert.equal(queries(), 2, 'edited desired layout and positioned ink each cross once');
  const raw = text.glyphs().inkBounds;
  near(next.min.x, raw.x + summary.anchorOffset.x, 'edited anchored minimum X');
  near(next.max.y, -(raw.y + summary.anchorOffset.y), 'edited anchored maximum Y');
});
