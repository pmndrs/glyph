import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import * as THREE from 'three/webgpu';
import { span, txt, bitmap } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { createThreeTestHandle } from '../support/three-handle.mjs';

const bitmap16 = bitmap({ strikes: [16] });
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

test(
  'structural spans authenticate a loaded Font instead of copying it into authored style data',
  { timeout },
  async () => {
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
  },
);

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

test('structural span styles own nested caller data when the tag is authored', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await fonts.load('inter');
  const feature = { tag: 'liga', value: 0, start: 0, end: 3 };
  const style = { features: [feature], color: '#ff2f00' };
  const tag = span(style);
  feature.end = 30;
  style.features.push({ tag: 'bad' });
  style.color = '#00ff00';
  const document = txt`${tag`abc`}`;
  assert.deepEqual(document.spans[0].style, {
    features: [{ tag: 'liga', value: 0, start: 0, end: 3 }],
    color: '#ff2f00',
  });
  assert.ok(Object.isFrozen(document.spans[0].style.features[0]));
  const node = three.createText({ font, text: document });
  try {
    const before = node.measure();
    assert.throws(() => node.set({ text: txt`${tag`ab`}` }), /must stay inside \[0, 2\)/u);
    assert.equal(node.text, 'abc');
    assert.deepEqual(node.measure(), before, 'rejected range edits leave prepared measurement unchanged');
  } finally {
    node.dispose();
  }
});

test('recomposing a styled fragment validates absolute feature ranges in its new scope', { timeout }, () => {
  const fragment = span({ features: [{ tag: 'liga', start: 0, end: 2 }] })`ab`;
  assert.doesNotThrow(() => txt`${fragment}`);
  assert.throws(() => txt`prefix ${fragment}`, /must stay inside \[7, 9\)/u);
  assert.throws(() => txt`${span({ features: [{ tag: 'liga', start: 6 }] })`abc`}`, /must stay inside \[0, 3\)/u);
  assert.throws(() => txt`prefix ${span({ features: [{ tag: 'liga', end: 1 }] })`ab`}`, /must stay inside \[7, 9\)/u);
});

test(
  'owned structural spans retain Unicode cluster and feature scope invariants across assignments',
  { timeout },
  async (t) => {
    const three = await createThreeTestHandle(t);
    const font = await fonts.load('inter');
    const node = three.createText({ font, text: 'initial' });
    try {
      for (const text of ['a\u0301', '👩‍👩‍👧‍👦', 'क्‍ष', 'office']) {
        const source = { features: [{ tag: 'liga', start: 0, end: text.length }] };
        const document = txt`${span(source)`${text}`}`;
        source.features[0].end = 999;
        node.set({ text: document });
        const cold = three.createText({ font, text: document });
        try {
          assert.deepEqual(node.measure(), cold.measure(), `retained assignment matches cold ${text}`);
        } finally {
          cold.dispose();
        }
      }
    } finally {
      node.dispose();
    }
  },
);

test('shortening text rejects an out-of-scope feature without changing the text', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await fonts.load('inter');
  const node = three.createText({
    font,
    text: 'abcdef',
    style: { features: [{ tag: 'liga', start: 0, end: 6 }] },
  });
  try {
    const before = node.measure();
    assert.throws(() => node.set({ style: { features: [{ tag: 'liga', start: 8 }] } }), /must stay inside \[0, 6\)/u);
    assert.deepEqual(node.measure(), before, 'a rejected root feature range leaves preparation unchanged');
    assert.throws(() => node.set({ text: 'abc' }), /must stay inside \[0, 3\)/u);
    assert.equal(node.text, 'abcdef', 'range validation precedes mutation');
    node.set({ text: 'abc', style: { features: [] } });
    assert.equal(node.text, 'abc');
    node.set({ text: 'ab', style: {} });
    assert.equal(node.text, 'ab');
  } finally {
    node.dispose();
  }
});

test('a fixed root budget keeps the last complete revision and self-heals', { timeout }, async (t) => {
  const three = await createThreeTestHandle(t, defineThreeConfig({ capacity: { size: 8, policy: 'fixed' } }));
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

    const recovered = txt`${span({ color: '#2f7fff' })`a`}b`;
    node.set({ text: recovered });
    scene.updateMatrixWorld(true);
    assert.equal(node.measure().glyphCount, 2, 'formatted content back inside the budget commits');
    assert.equal(node.text, 'ab');
    assert.equal(node.commitState().status, 'committed');
  } finally {
    node.dispose();
  }
});

function rootDraws(scene) {
  return scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
}
