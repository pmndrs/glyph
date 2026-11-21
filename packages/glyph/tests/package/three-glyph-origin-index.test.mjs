import assert from 'node:assert/strict';
import test from 'node:test';

import { GlyphOriginIndex } from '../../dist/three/internal/glyph-origin-index.js';

function segment(stableIds, { start = 0, count = stableIds.length - start, drawIndex = 0, width = 4 } = {}) {
  const origins = new Float32Array(stableIds.length * width);
  for (let index = 0; index < stableIds.length; index += 1) {
    origins[index * width] = stableIds[index] * 10;
    origins[index * width + 1] = stableIds[index] * 10 + 1;
  }
  return {
    origins: { array: origins, vectorWidth: width },
    stableIds: { array: Uint32Array.from(stableIds), vectorWidth: 1 },
    storageKey: `buffer:${String(drawIndex)}`,
    geometry: undefined,
    start,
    count,
    drawIndex,
  };
}

function located(index, stableId) {
  if (!index.locate(stableId)) return undefined;
  return { draw: index.segment.drawIndex, record: index.record, rest: [index.rest(0), index.rest(1)] };
}

test('lookups find each id in its segment range, whether scanned, sequential, or hashed', () => {
  const first = segment([90, 11, 12, 13, 91], { start: 1, count: 3, drawIndex: 0 });
  const second = segment([21, 22, 23, 24, 25, 26], { drawIndex: 1, width: 2 });
  const expected = new Map([
    [11, { draw: 0, record: 1, rest: [110, 111] }],
    [12, { draw: 0, record: 2, rest: [120, 121] }],
    [13, { draw: 0, record: 3, rest: [130, 131] }],
    [24, { draw: 1, record: 3, rest: [240, 241] }],
    [26, { draw: 1, record: 5, rest: [260, 261] }],
  ]);
  const index = new GlyphOriginIndex();
  index.reset([first, second]);
  // Enough repeated lookups to exhaust the scan budget and continue through the hashed index.
  for (let pass = 0; pass < 12; pass += 1) {
    for (const [stableId, place] of expected) assert.deepEqual(located(index, stableId), place);
    for (const outside of [90, 91, 7, 0]) assert.equal(index.locate(outside), false, 'ids outside every range miss');
    for (const stableId of [26, 24, 13, 12, 11]) assert.deepEqual(located(index, stableId), expected.get(stableId));
  }
});

test('the rest origin is the lane value at the first lookup after a publication', () => {
  const lane = segment([5, 6, 7]);
  const index = new GlyphOriginIndex();
  index.reset([lane]);
  lane.origins.array[4] = 1000;
  assert.deepEqual(located(index, 6)?.rest, [1000, 61], 'values written before the first lookup are the rest state');
  lane.origins.array[4] = 2000;
  lane.origins.array[8] = 3000;
  assert.deepEqual(located(index, 6)?.rest, [1000, 61], 'later displacement does not move the rest state');
  assert.deepEqual(located(index, 7)?.rest, [70, 71]);

  index.reset([lane]);
  assert.deepEqual(located(index, 7)?.rest, [3000, 71], 'a new publication captures a new rest state');
});

test('the last record of a repeated id wins on every lookup path', () => {
  const first = segment([1, 2, 3], { drawIndex: 0 });
  const second = segment([4, 2, 5, 2], { drawIndex: 1 });
  const index = new GlyphOriginIndex();
  index.reset([first, second]);
  for (let pass = 0; pass < 12; pass += 1) {
    assert.deepEqual(located(index, 2), { draw: 1, record: 3, rest: [20, 21] });
    assert.equal(index.locate(99), false);
  }
});

test('segments without float origins or u32 ids are never located', () => {
  const unusable = segment([1, 2, 3]);
  unusable.stableIds.array = new Uint16Array([1, 2, 3]);
  const usable = segment([4], { drawIndex: 1 });
  const index = new GlyphOriginIndex();
  index.reset([unusable, usable]);
  assert.equal(index.locate(2), false);
  assert.deepEqual(located(index, 4), { draw: 1, record: 0, rest: [40, 41] });
  index.reset([]);
  assert.equal(index.locate(4), false);
});
