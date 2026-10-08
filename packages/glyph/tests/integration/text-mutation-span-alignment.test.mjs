import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';

import { glyph, span, txt, bitmap } from '@pmndrs/glyph';
import { Text as R3fText } from '@pmndrs/glyph/react';
import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
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
