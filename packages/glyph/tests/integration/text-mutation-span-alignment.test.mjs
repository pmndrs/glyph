import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';

import '../support/browser-globals.mjs';
import { glyph, span, txt } from '@pmndrs/glyph';
import { Text as R3fText } from '@pmndrs/glyph/react';
import { bitmap } from '@pmndrs/glyph/three/bitmap';

import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';
import { findGraphemeBoundaries } from '../../dist/internal/graphemes.js';

globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bitmap16 = { raster: bitmap, options: { strikes: [16] } };
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

test('nested React Text crossing a joining boundary mounts and publishes', { timeout }, async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
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
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
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
