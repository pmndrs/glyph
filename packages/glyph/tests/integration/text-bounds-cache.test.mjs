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

function countPreparations(t) {
  let preparations = 0;
  const prepare = PlanTransport.prototype.prepareParagraph;
  PlanTransport.prototype.prepareParagraph = function (...args) {
    preparations++;
    return prepare.apply(this, args);
  };
  t.after(() => {
    PlanTransport.prototype.prepareParagraph = prepare;
  });
  return () => preparations;
}

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: ${actual} != ${expected}`);
function sameBox(actual, expected, message) {
  for (const edge of ['min', 'max'])
    for (const axis of ['x', 'y', 'z']) near(actual[edge][axis], expected[edge][axis], `${message} ${edge}.${axis}`);
}

test('prepared measurement leaves visible ink bounds queryable and cached, with the anchor applied once', async (t) => {
  const handle = await createThreeTestHandle(t);
  const control = await createThreeTestHandle(t);
  const unanchored = control.createText({ font, text: 'Abc', style: { fontSize: 20 } });
  const expected = unanchored.computeBoundingBox().clone();
  const preparations = countPreparations(t);
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
  assert.ok(summary.inkBounds && summary.inkBounds.width > 0, 'prepared measurement carries real visible ink');
  assert.equal(preparations(), 1, 'creation prepares the paragraph once');
  expected.translate(new THREE.Vector3(summary.anchorOffset.x, -summary.anchorOffset.y, 0));
  const actual = text.computeBoundingBox().clone();
  assert.equal(actual.isEmpty(), false, 'visible ink must not become a cached empty box');
  sameBox(actual, expected, 'native owner-local ink');
  assert.equal(preparations(), 1, 'bounding-box demand reuses the prepared paragraph');
  for (let repeat = 0; repeat < 3; repeat++) {
    text.measure();
    sameBox(text.computeBoundingBox(), expected, 'cached native ink');
  }
  assert.equal(preparations(), 1, 'same-revision layout and bounds reads do not reprepare');
  const raw = text.glyphs().inkBounds;
  near(actual.min.x, raw.x + summary.anchorOffset.x, 'raw ink to native minimum X');
  near(actual.max.y, -(raw.y + summary.anchorOffset.y), 'raw ink to native maximum Y');
});

test('empty and spaces-only bounds remain valid cached answers after prepared measurement', async (t) => {
  const handle = await createThreeTestHandle(t);
  const preparations = countPreparations(t);
  for (const content of ['', '   ']) {
    const before = preparations();
    const text = handle.createText({ font, text: content });
    t.after(() => text.dispose());
    text.measure();
    const box = text.computeBoundingBox();
    if (content.length === 0) {
      assert.equal(box.isEmpty(), true, 'zero glyphs have no ink box');
      assert.equal(preparations() - before, 1, 'creation and first demand prepare the empty paragraph once');
    } else {
      assert.equal(box.getSize(new THREE.Vector3()).y, 0, 'spaces have no ink area');
      assert.ok(box.min.toArray().every(Number.isFinite), 'positioned whitespace bounds are finite');
      assert.equal(preparations() - before, 1, 'creation and first demand prepare the whitespace paragraph once');
    }
    const knownPreparations = preparations();
    text.measure();
    assert.equal(text.computeBoundingBox(), box, 'the retained Box3 object is stable');
    assert.equal(preparations(), knownPreparations, 'known empty/zero-area ink remains cached');
  }
});

test('desired text edits refresh ink bounds without freezing the old or empty result', async (t) => {
  const handle = await createThreeTestHandle(t);
  const text = handle.createText({ font, text: 'A', constraints: { anchor: { x: 'right', y: 'bottom' } } });
  t.after(() => text.dispose());
  const initial = text.computeBoundingBox().clone();
  const preparations = countPreparations(t);
  text.text = 'A much wider label';
  const summary = text.measure();
  assert.ok(summary.inkBounds && summary.inkBounds.width > 0, 'edited preparation carries current ink');
  const next = text.computeBoundingBox().clone();
  assert.ok(next.getSize(new THREE.Vector3()).x > initial.getSize(new THREE.Vector3()).x);
  assert.equal(preparations(), 1, 'the edit prepares once and subsequent reads reuse it');
  const raw = text.glyphs().inkBounds;
  near(next.min.x, raw.x + summary.anchorOffset.x, 'edited anchored minimum X');
  near(next.max.y, -(raw.y + summary.anchorOffset.y), 'edited anchored maximum Y');
});
