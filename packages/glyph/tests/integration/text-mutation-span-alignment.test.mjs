import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';

import { glyph, span, txt, bitmap } from '@pmndrs/glyph';
import { Text as R3fText } from '@pmndrs/glyph/react';
import { assertMatchesFreshBuild, createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';

globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bitmap16 = bitmap({ strikes: [16] });
const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap16 } });
await glyph.init();
after(() => fonts.dispose());

const ACUTE = '́';
const constraints = { width: { mode: 'exact', size: 220 } };
const layout = { wrap: 'word' };
const style = [{ fontSize: 6, lineHeight: 1 }, { color: '#ffffff' }];

test('Rust resolves authored template ranges after fragments join into graphemes', { timeout }, async () => {
  const literal = txt`a${span({ color: '#ff2f00' })`${ACUTE}b`}`;
  assert.equal(literal.text, `a${ACUTE}b`);
  assert.deepEqual(
    literal.spans.map(({ start, end }) => [start, end]),
    [[1, 3]],
  );

  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: literal } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assert.equal(mounted.nodes[0].text, literal.text);
    assert.equal(mounted.nodes[0].error, undefined);
    assert.equal(mounted.nodes[0].measure().glyphCount, 2);
  } finally {
    unmount(mounted);
  }
});

test('nested structural spans preserve authored ranges until Rust resolves them', { timeout }, async () => {
  const inner = span({ color: '#00ff2f' })`${ACUTE}b`;
  const literal = txt`${span({ color: '#ff2f00' })`a${inner}`}c`;
  assert.equal(literal.text, `a${ACUTE}bc`);
  assert.deepEqual(
    literal.spans.map(({ start, end }) => [start, end]),
    [
      [0, 3],
      [1, 3],
    ],
  );
  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: literal } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assert.equal(mounted.nodes[0].error, undefined);
    assert.equal(mounted.nodes[0].measure().glyphCount, 3);
  } finally {
    unmount(mounted);
  }
});

test('equivalent authored ranges resolve to the same measurement in Rust', { timeout }, async () => {
  const text = `a${ACUTE}b`;
  const formatted = () => ({
    text,
    spans: [{ start: 1, end: 3, style: { color: '#ff2f00', decoration: { underline: true } } }],
  });
  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: formatted() } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    const node = mounted.nodes[0];
    const accepted = node.measure();
    assert.equal(accepted.glyphCount, 2);
    node.set({ text: formatted() });
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(node.measure(), accepted, 'equivalent authored ranges must resolve to the same layout');
    node.set({
      text: {
        text,
        spans: [{ start: 2, end: 3, style: { color: '#ff2f00', decoration: { underline: true } } }],
      },
    });
    mounted.scene.updateMatrixWorld(true);
    assert.deepEqual(node.measure(), accepted, 'a range already on the cluster grid has the same layout');
  } finally {
    unmount(mounted);
  }
});

test('raw span updates do not run JavaScript grapheme segmentation', { timeout }, async () => {
  const text = `a${ACUTE}fi`;
  const formatted = (color) => ({
    text,
    spans: [
      { start: 0, end: 2, style: { color } },
      { start: 2, end: 4, style: { color: '#ffffff' } },
    ],
  });
  const font = await fonts.load('inter');
  const mounted = mount(font, [{ properties: { constraints, layout, style, text: formatted('#ff2f00') } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    const node = mounted.nodes[0];
    const accepted = node.measure();
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'isWellFormed');
    assert.ok(descriptor);
    let wellFormedChecks = 0;
    // Test instrumentation: an unchanged text value must not be segmented in the JS adapter.
    // oxlint-disable-next-line no-extend-native
    Object.defineProperty(String.prototype, 'isWellFormed', {
      ...descriptor,
      value: function () {
        wellFormedChecks += 1;
        return descriptor.value.call(this);
      },
    });
    try {
      const originalStructuredClone = globalThis.structuredClone;
      let structuredCloneCalls = 0;
      globalThis.structuredClone = (...arguments_) => {
        structuredCloneCalls += 1;
        return originalStructuredClone(...arguments_);
      };
      try {
        assert.doesNotThrow(() => node.set({ text: formatted('#2f7fff') }));
      } finally {
        globalThis.structuredClone = originalStructuredClone;
      }
      assert.equal(
        structuredCloneCalls,
        1,
        'Three snapshots the changed caller style once before Rust prepares the authored ranges',
      );
      assert.equal(wellFormedChecks, 0, 'a paint-only update must not scan or segment unchanged text in JS');
      assert.deepEqual(node.measure(), accepted, 'a paint-only update preserves shaping and placement');
      assert.throws(
        () =>
          node.set({
            text: {
              text,
              spans: [
                { start: 0, end: 2, style: { features: [{ tag: 'liga', start: 0, end: 3 }] } },
                { start: 2, end: 4, style: { color: '#ffffff' } },
              ],
            },
          }),
        /must stay inside \[0, 2\)/u,
        'changed caller features revalidate scope while retaining the unchanged Unicode grid',
      );
      node.set({
        text: {
          text,
          spans: [
            { start: 1, end: 2, style: { color: '#2f7fff' } },
            { start: 2, end: 4, style: { color: '#ffffff' } },
          ],
        },
      });
    } finally {
      // oxlint-disable-next-line no-extend-native
      Object.defineProperty(String.prototype, 'isWellFormed', descriptor);
    }
    node.set({ text: { ...formatted('#2f7fff'), text: `b${ACUTE}fi` } });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.error, undefined);
    assert.equal(node.text, `b${ACUTE}fi`, 'Rust re-resolves retained authored ranges after a text edit');
  } finally {
    unmount(mounted);
  }
});

test('seeded retained formatted batches match a cold full publication after sparse edits', { timeout }, async () => {
  const font = await fonts.load('inter');
  const base = { constraints, layout, style };
  let units = Array.from({ length: 36 }, (_value, index) => String.fromCharCode(97 + (index % 26)));
  let widths = [6, 6, 6, 6, 6, 6];
  let phase = 0;
  const palette = ['#ff2f00', '#2f7fff', '#00bf63', '#f2c94c'];
  const formatted = () => {
    const text = units.join('');
    const spans = [{ start: 0, end: text.length, style: { opacity: 0.95 } }];
    let unitStart = 0;
    for (const [index, width] of widths.entries()) {
      const start = units.slice(0, unitStart).join('').length;
      unitStart += width;
      const end = units.slice(0, unitStart).join('').length;
      spans.push({
        start,
        end,
        style: {
          color: palette[(index + phase) % palette.length],
          opacity: 0.65 + ((index + phase) % 3) * 0.15,
        },
      });
    }
    return { text, spans };
  };

  let current = formatted();
  const mounted = mount(font, [{ properties: { ...base, text: current } }]);
  try {
    mounted.scene.updateMatrixWorld(true);
    assertMatchesFreshBuild(font, mounted, [{ properties: { ...base, text: current } }], 'initial retained batch');

    const steps = [
      () => {
        units[2] = 'z';
        units[31] = 'q';
        phase += 1;
      },
      () => {
        units[5] = `a${ACUTE}`;
        units[28] = '😀';
        phase += 1;
      },
      () => {
        widths = [3, 3, 9, 3, 6, 12];
        phase += 1;
      },
      () => {
        units[5] = 'é';
        units[28] = 'x';
        widths = [12, 6, 6, 6, 6];
        phase += 1;
      },
    ];
    for (const [index, mutate] of steps.entries()) {
      mutate();
      current = formatted();
      mounted.nodes[0].set({ text: current });
      mounted.scene.updateMatrixWorld(true);
      assert.equal(mounted.nodes[0].error, undefined, `step ${index} publishes`);
      assertMatchesFreshBuild(
        font,
        mounted,
        [{ properties: { ...base, text: current } }],
        `retained formatted step ${index}`,
      );
    }
  } finally {
    unmount(mounted);
  }
});

test('nested React Text crossing a joining boundary mounts and publishes', { timeout }, async () => {
  const { create } = await import('../support/r3f-test-renderer.mjs');
  const font = await fonts.load('inter');
  const nodes = [];
  const errors = [];
  const renderer = await create(
    createElement(
      R3fText,
      {
        font,
        style,
        constraints,
        layout,
        onError: (error) => void errors.push(error),
        ref: (node) => void (node !== undefined && nodes.push(node)),
      },
      createElement(R3fText, { style: { color: '#ff2f00' } }, 'a'),
      `${ACUTE}bc`,
    ),
  );
  try {
    const node = nodes.at(-1);
    assert.ok(node !== undefined);
    assert.equal(node.text, `a${ACUTE}bc`);
    assert.equal(node.error, undefined);
    assert.deepEqual(errors, []);
  } finally {
    await renderer.unmount();
  }
});

test('nested React Text rejects box-only props before constructing a paragraph', { timeout }, async () => {
  const { create } = await import('../support/r3f-test-renderer.mjs');
  const font = await fonts.load('inter');
  await assert.rejects(
    async () =>
      create(
        createElement(
          R3fText,
          { font, style, constraints, layout },
          createElement(R3fText, { position: [1, 2, 3] }, 'invalid inline box'),
        ),
      ),
    /nested R3F Text cannot use the box property position/,
  );
});
