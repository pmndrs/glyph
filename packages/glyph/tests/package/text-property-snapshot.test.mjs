import assert from 'node:assert/strict';
import test from 'node:test';

import { reuseOrCreateTextPropertySnapshot } from '../../dist/config/text-property.js';

test('text property snapshots compare cyclic graphs without changing their topology', () => {
  const original = {};
  original.next = original;
  const retained = reuseOrCreateTextPropertySnapshot(undefined, original, 'Test property');

  const equal = {};
  equal.next = equal;
  assert.equal(reuseOrCreateTextPropertySnapshot(retained, equal, 'Test property'), retained);

  const first = {};
  const second = {};
  first.next = second;
  second.next = first;
  const replaced = reuseOrCreateTextPropertySnapshot(retained, first, 'Test property');
  assert.notEqual(replaced, retained);
  assert.equal(replaced.next.next, replaced);
  assert.equal(Object.isFrozen(replaced), true);
  assert.equal(Object.isFrozen(replaced.next), true);
});
