import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';

import { glyph, span, txt, bitmap } from '@pmndrs/glyph';
import { Text as R3fText } from '@pmndrs/glyph/react';
import { assertMatchesFreshBuild, createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import {
  areOwnedRangesClusterAligned,
  findGraphemeBoundaries,
  inheritClusterAlignedRanges,
  ownClusterAlignedRanges,
} from '../../dist/internal/graphemes.js';

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

function ranges(literal) {
  return literal.spans.map(({ start, end }) => [start, end]);
}

function assertAligned(literal) {
  const boundaries = new Set(findGraphemeBoundaries(literal.text));
  for (const { start, end } of literal.spans) {
    assert.ok(boundaries.has(start), `span starts inside a cluster at ${start}`);
    assert.ok(boundaries.has(end), `span ends inside a cluster at ${end}`);
  }
}

test('txt resolves a styled fragment opening with a combining mark onto the base cluster', { timeout }, async () => {
  const literal = txt`a${span({ color: '#ff2f00' })`${ACUTE}b`}`;
  assert.equal(literal.text, `a${ACUTE}b`);
  assert.deepEqual([...findGraphemeBoundaries(literal.text)], [0, 2, 3]);
  assert.deepEqual(ranges(literal), [[2, 3]]);
  assertAligned(literal);
  assert.equal(literal.spans.every(Object.isFrozen), true, 'rewritten package-owned span records must stay immutable');
  assert.equal(areOwnedRangesClusterAligned(literal.text, literal.spans), true);
  assert.equal(areOwnedRangesClusterAligned(`${literal.text}c`, literal.spans), false);
  const rebound = inheritClusterAlignedRanges(
    literal.text,
    literal.spans,
    literal.spans.map((entry) => Object.freeze({ ...entry })),
  );
  assert.equal(areOwnedRangesClusterAligned(literal.text, rebound), true);

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

test('span provenance inheritance realigns unproven and changed-text sources', () => {
  const text = `a${ACUTE}b`;
  const raw = Object.freeze([Object.freeze({ start: 1, end: 3 })]);
  const fromUnproven = inheritClusterAlignedRanges(
    text,
    raw,
    raw.map((entry) => Object.freeze({ ...entry })),
  );
  assert.deepEqual(ranges({ spans: fromUnproven }), [[2, 3]]);
  assert.equal(areOwnedRangesClusterAligned(text, fromUnproven), true);
  assert.equal(fromUnproven.every(Object.isFrozen), true);

  const source = ownClusterAlignedRanges('ab', Object.freeze([Object.freeze({ start: 1, end: 2 })]));
  const fromChangedText = inheritClusterAlignedRanges(
    text,
    source,
    source.map((entry) => Object.freeze({ ...entry })),
  );
  assert.deepEqual(ranges({ spans: fromChangedText }), [[2, 2]]);
  assert.equal(areOwnedRangesClusterAligned(text, fromChangedText), true);

  const alignedSource = ownClusterAlignedRanges(text, Object.freeze([Object.freeze({ start: 2, end: 3 })]));
  const fromChangedBoundaries = inheritClusterAlignedRanges(
    text,
    alignedSource,
    Object.freeze([Object.freeze({ start: 1, end: 3 })]),
  );
  assert.deepEqual(ranges({ spans: fromChangedBoundaries }), [[2, 3]]);
  assert.equal(areOwnedRangesClusterAligned(text, fromChangedBoundaries), true);

  const [brand] = Object.getOwnPropertySymbols(alignedSource);
  assert.ok(brand);
  const forged = [{ start: 2, end: 3 }];
  Object.defineProperty(forged, brand, { value: true });
  assert.equal(
    areOwnedRangesClusterAligned(text, Object.freeze(forged)),
    false,
    'the private brand needs WeakMap proof',
  );
});

test('malformed UTF-16 is never marked as cluster aligned', () => {
  const text = '\ud800';
  const spans = ownClusterAlignedRanges(text, Object.freeze([Object.freeze({ start: 0, end: 1 })]));
  assert.equal(Object.isFrozen(spans), true);
  assert.equal(areOwnedRangesClusterAligned(text, spans), false);
});

test('nested structural spans preserve hierarchy after a joining boundary moves', () => {
  const inner = span({ color: '#00ff2f' })`${ACUTE}b`;
  const literal = txt`${span({ color: '#ff2f00' })`a${inner}`}c`;
  assert.equal(literal.text, `a${ACUTE}bc`);
  assert.deepEqual(ranges(literal), [
    [0, 3],
    [2, 3],
  ]);
  assertAligned(literal);
});

test('repeated raw Unicode spans realign before retaining the accepted measurement', { timeout }, async () => {
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
    assert.equal(node.measure(), accepted, 'equivalent unaligned input must retain its aligned accepted state');
    node.set({
      text: {
        text,
        spans: [{ start: 2, end: 3, style: { color: '#ff2f00', decoration: { underline: true } } }],
      },
    });
    mounted.scene.updateMatrixWorld(true);
    assert.equal(node.measure(), accepted, 'raw input must align before desired-state equality is decided');
  } finally {
    unmount(mounted);
  }
});

test(
  'validated raw spans reuse prior alignment only while text and boundaries stay unchanged',
  { timeout },
  async () => {
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
      // Test instrumentation: any full alignment path must revalidate UTF-16 through this built-in.
      // oxlint-disable-next-line no-extend-native
      Object.defineProperty(String.prototype, 'isWellFormed', {
        ...descriptor,
        value() {
          throw new Error('full Unicode alignment invoked');
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
          'Three snapshots the changed caller style once and the planner adopts its proven immutable spans',
        );
        assert.throws(
          () =>
            node.set({
              text: {
                text,
                spans: [
                  { start: 1, end: 2, style: { color: '#2f7fff' } },
                  { start: 2, end: 4, style: { color: '#ffffff' } },
                ],
              },
            }),
          /full Unicode alignment invoked/u,
        );
        assert.throws(
          () => node.set({ text: { ...formatted('#2f7fff'), text: `b${ACUTE}fi` } }),
          /full Unicode alignment invoked/u,
        );
      } finally {
        // oxlint-disable-next-line no-extend-native
        Object.defineProperty(String.prototype, 'isWellFormed', descriptor);
      }
      mounted.scene.updateMatrixWorld(true);
      assert.equal(node.error, undefined);
      assert.deepEqual(node.measure(), accepted, 'a paint-only span change must preserve shaping and placement');
    } finally {
      unmount(mounted);
    }
  },
);

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
