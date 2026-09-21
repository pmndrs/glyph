/** Vue property snapshots compare structurally before they reach Three's canonical update path. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { sameSnapshot } from '../../dist/internal/desired-text.js';

test('sameSnapshot compares arrays by position and objects by key set', () => {
  assert.equal(sameSnapshot([1, [2, 3]], [1, [2, 3]]), true);
  assert.equal(sameSnapshot([1, 2], [1, 2, 3]), false);
  assert.equal(sameSnapshot({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameSnapshot(Number.NaN, Number.NaN), true);
});
