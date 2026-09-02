import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import '../support/browser-globals.mjs';
import * as THREE from 'three/webgpu';
import { span, txt } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';

import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { createThreeTestHandle } from '../support/three-handle.mjs';

const bitmap16 = { raster: bitmap, options: { strikes: [16] } };
const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 } });
after(() => fonts.dispose());

const constraints = { width: { mode: 'exact', size: 220 } };
const layout = { wrap: 'word' };
const paint = { color: '#ffffff' };
const latin = { fontSize: 6, lineHeight: 1 };
const authored = (text) => ({ properties: { constraints, layout, style: [latin, paint], text } });

test('raw offset spans are rejected where the caller writes them', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await fonts.load('inter');
  const raw = [{ start: 0, end: 3, style: { color: '#ff2f00' } }];
  assert.throws(
    () => three.createText({ font, text: 'abcdef', spans: raw }),
    /cannot declare raw spans; compose formatted text with txt and span/,
  );

  const node = three.createText({ font, text: 'abcdef' });
  try {
    assert.throws(() => node.set({ spans: raw }), /cannot declare raw spans; compose formatted text with txt and span/);
    assert.equal(node.text, 'abcdef', 'a rejected structural update leaves desired text unchanged');
  } finally {
    node.dispose();
  }
});

test('structural spans derive valid nested and disjoint ranges without an offset API', { timeout }, async () => {
  const font = await fonts.load('inter');
  const red = span({ color: '#ff2f00' });
  const large = span({ fontSize: 12 });
  const document = txt`${red`a${large`b`}c`} ${large`def`}`;
  const mounted = mount(font, [authored(document)]);
  try {
    assert.equal(mounted.nodes[0].text, 'abc def');
    assert.doesNotThrow(() => mounted.scene.updateMatrixWorld(true));
    assert.equal(mounted.nodes[0].error, undefined);
  } finally {
    unmount(mounted);
  }
});

test('structural spans authenticate a loaded Font instead of copying it into authored style data', { timeout }, async () => {
  const font = await fonts.load('inter');
  const document = txt`body ${span(font, { features: [{ tag: 'liga' }] })`face`} tail`;
  const mounted = mount(font, [authored(document)]);
  try {
    assert.doesNotThrow(() => mounted.scene.updateMatrixWorld(true));
    assert.equal(mounted.nodes[0].error, undefined);
    assert.equal(mounted.nodes[0].text, 'body face tail');
  } finally {
    unmount(mounted);
  }
});

test('invalid authored properties reject atomically while unknown properties are ignored', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await fonts.load('inter');
  assert.throws(
    () => three.createText({ font, text: 'invalid', style: { fontSize: Number.NaN } }),
    /fontSize must be finite/,
  );
  assert.throws(
    () => three.createText({ font, text: 'invalid', constraints: { width: { mode: 'exact', size: -1 } } }),
    /width size must be nonnegative/,
  );

  const mounted = mount(font, [authored('stable')]);
  const node = mounted.nodes[0];
  try {
    assert.throws(() => node.set({ style: { fontSize: 0 } }), /fontSize must be positive/);
    assert.equal(node.style.fontSize, latin.fontSize, 'a rejected property update leaves desired state unchanged');
    node.set({ style: { ...latin, futureProperty: 1 } });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined, 'unknown style properties are ignored by the runtime boundary');
  } finally {
    unmount(mounted);
  }
});

test('an unpaired surrogate throws where the caller wrote it', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await fonts.load('inter');
  assert.throws(
    () => three.createText({ font, constraints, layout, style: [latin, paint], text: 'ab\ud800cd' }),
    (error) => error instanceof RangeError && /text offset 2 is an unpaired high surrogate/.test(error.message),
  );
});

test('a malformed feature range throws while constructing its structural span', { timeout }, () => {
  assert.throws(
    () => span({ features: [{ tag: 'liga', value: 1, start: 3, end: 1 }] }),
    (error) => error instanceof RangeError && /span style feature 0 end must not precede start/.test(error.message),
  );
});

test('a fixed root budget keeps the last complete revision and self-heals', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t);
  three.setCapacity({ size: 8, policy: 'fixed' });
  const font = await fonts.load('inter');
  const scene = new THREE.Scene();
  const node = three.createText({
    font,
    constraints,
    layout,
    style: [latin, paint],
    text: 'abc',
  });
  scene.add(node);
  try {
    scene.updateMatrixWorld(true);
    const settled = node.measure();
    assert.equal(settled.glyphCount, 3);
    const settledDraw = rootDraws(scene)[0];
    assert.ok(settledDraw, 'content inside the root budget publishes a draw');
    assert.equal(settledDraw.geometry.instanceCount, 3);

    node.set({ text: 'abcdefghijklmnopqrstuvwxyz' });
    assert.doesNotThrow(() => scene.updateMatrixWorld(true));
    assert.equal(node.measure().glyphCount, 26, 'measurement describes desired local state');
    assert.equal(settledDraw.geometry.instanceCount, 3, 'the last complete draw stays visible');
    assert.deepEqual(node.commitState(), { status: 'pending' });
    assert.equal(node.error, undefined, 'honouring a fixed budget is not an error');

    node.set({ text: 'ab' });
    scene.updateMatrixWorld(true);
    assert.equal(node.measure().glyphCount, 2, 'content back inside the budget commits');
    assert.equal(node.commitState().status, 'committed');
  } finally {
    node.dispose();
  }
});

function rootDraws(scene) {
  return scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
}
