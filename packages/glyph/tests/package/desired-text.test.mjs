/** Framework adapters republish a paragraph only when its desired snapshot changed; identity, structure, and font selection all participate. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { sameDesiredText, sameSnapshot } from '../../dist/internal/desired-text.js';

const font = { raster: 'bitmap' };
const base = Object.freeze({
  font,
  text: { text: 'hello', spans: [{ start: 0, end: 2, style: { color: 'red' } }] },
  style: { fontSize: 16 },
  layout: { wrap: 'word' },
  constraints: { width: { mode: 'exact', size: 300 } },
});

test('an undefined previous snapshot never matches', () => {
  assert.equal(sameDesiredText(undefined, base), false);
});

test('structurally equal snapshots with the same font match', () => {
  assert.equal(sameDesiredText(base, { ...base, style: { fontSize: 16 } }), true);
});

test('a different font identity does not match even when structurally alike', () => {
  assert.equal(sameDesiredText(base, { ...base, font: { raster: 'bitmap' } }), false);
});

test('changed spans, style, layout, constraints, or raster pixel ratio do not match', () => {
  assert.equal(sameDesiredText(base, { ...base, text: { text: 'hello', spans: [] } }), false);
  assert.equal(sameDesiredText(base, { ...base, style: { fontSize: 17 } }), false);
  assert.equal(sameDesiredText(base, { ...base, layout: { wrap: 'none' } }), false);
  assert.equal(sameDesiredText(base, { ...base, constraints: {} }), false);
  assert.equal(sameDesiredText(base, { ...base, rasterPixelRatio: 2 }), false);
});

test('sameSnapshot compares arrays by position and objects by key set', () => {
  assert.equal(sameSnapshot([1, [2, 3]], [1, [2, 3]]), true);
  assert.equal(sameSnapshot([1, 2], [1, 2, 3]), false);
  assert.equal(sameSnapshot({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameSnapshot(Number.NaN, Number.NaN), true);
});
