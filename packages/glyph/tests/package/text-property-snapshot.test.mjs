import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOwnedTextPropertySnapshot,
  ownTextPropertySnapshot,
  reuseOrCreateTextPropertySnapshot,
} from '../../dist/config/text-property.js';

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

test('package-created frozen snapshots cross normalization seams without another clone', () => {
  const snapshot = Object.freeze({ fontSize: 16, decoration: { underline: true } });
  assert.equal(isOwnedTextPropertySnapshot(snapshot), false);
  assert.equal(ownTextPropertySnapshot(snapshot), snapshot);
  assert.equal(Object.isFrozen(snapshot.decoration), true);
  assert.equal(isOwnedTextPropertySnapshot(snapshot), true);
  assert.equal(reuseOrCreateTextPropertySnapshot(undefined, snapshot, 'Test property'), snapshot);
});

test('an equal prior snapshot wins over a different package-owned identity', () => {
  const previous = reuseOrCreateTextPropertySnapshot(undefined, { fontSize: 16 }, 'Test property');
  const equalOwned = ownTextPropertySnapshot({ fontSize: 16 });
  assert.notEqual(equalOwned, previous);
  assert.equal(reuseOrCreateTextPropertySnapshot(previous, equalOwned, 'Test property'), previous);
});
