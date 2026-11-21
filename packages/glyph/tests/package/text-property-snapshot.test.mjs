import assert from 'node:assert/strict';
import test from 'node:test';

import {
  equalTextPropertySnapshots,
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
  assert.equal(
    equalTextPropertySnapshots(ownTextPropertySnapshot(original), ownTextPropertySnapshot(equal)),
    true,
    'owned cyclic roots compare through their cached root keys',
  );

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

test('text property snapshots preserve nested alias topology', () => {
  const shared = { value: 1 };
  const previous = { outer: { left: shared, right: shared } };
  const equal = { outer: { left: { value: 1 }, right: { value: 1 } } };
  const different = { outer: { left: { value: 1 } } };
  different.outer.right = different.outer.left;

  assert.equal(equalTextPropertySnapshots(previous, equal), false);
  assert.equal(equalTextPropertySnapshots(previous, different), true);
  assert.equal(
    equalTextPropertySnapshots(ownTextPropertySnapshot(previous), ownTextPropertySnapshot(equal)),
    false,
    'owned roots preserve distinct nested aliases',
  );
  assert.equal(
    equalTextPropertySnapshots(ownTextPropertySnapshot(previous), ownTextPropertySnapshot(different)),
    true,
    'owned roots preserve matching nested aliases',
  );
});

test('text property snapshot equality includes primitive, symbol, and nonenumerable keys', () => {
  const symbol = Symbol('metadata');
  const makeRecord = (symbolValue, zero = 0) => {
    const record = { value: Number.NaN, zero };
    Object.defineProperty(record, 'hidden', { value: 'kept', enumerable: false });
    record[symbol] = symbolValue;
    return record;
  };

  const cases = [
    [makeRecord(3), makeRecord(3), true],
    [ownTextPropertySnapshot(makeRecord(3)), ownTextPropertySnapshot(makeRecord(3)), true],
    [makeRecord(3), makeRecord(4), false],
    [ownTextPropertySnapshot(makeRecord(3)), ownTextPropertySnapshot(makeRecord(4)), false],
    [makeRecord(3), makeRecord(3, -0), false],
    [ownTextPropertySnapshot(makeRecord(3)), ownTextPropertySnapshot(makeRecord(3, -0)), false],
  ];
  for (const [previous, next, expected] of cases) {
    assert.equal(equalTextPropertySnapshots(previous, next), expected);
  }
});

test('unowned mutable records reread own keys across comparisons', () => {
  const previous = { value: 1 };
  const next = { value: 1 };

  assert.equal(equalTextPropertySnapshots(previous, next), true);
  next.extra = 2;
  assert.equal(equalTextPropertySnapshots(previous, next), false);
  delete next.extra;
  assert.equal(equalTextPropertySnapshots(previous, next), true);
});

test('owned accessor snapshots cache keys but read getter values on every comparison', () => {
  let value = 1;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get: () => value,
  });
  const snapshot = ownTextPropertySnapshot(accessor);
  const equal = ownTextPropertySnapshot({ value: 1 });

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(equalTextPropertySnapshots(snapshot, equal), true);
  value = 2;
  assert.equal(equalTextPropertySnapshots(snapshot, equal), false);
});

test('package-created frozen snapshots cross normalization seams without another clone', () => {
  const snapshot = Object.freeze({ fontSize: 16, decoration: { underline: true } });
  assert.equal(isOwnedTextPropertySnapshot(snapshot), false);
  assert.equal(ownTextPropertySnapshot(snapshot), snapshot);
  assert.equal(Object.isFrozen(snapshot.decoration), true);
  assert.equal(isOwnedTextPropertySnapshot(snapshot), true);
  assert.equal(reuseOrCreateTextPropertySnapshot(undefined, snapshot, 'Test property'), snapshot);
});

test('caller-frozen records still receive an isolated owned snapshot', () => {
  const decoration = { underline: true };
  const caller = Object.freeze({ fontSize: 16, decoration });
  const snapshot = reuseOrCreateTextPropertySnapshot(undefined, caller, 'Test property');

  assert.notEqual(snapshot, caller, 'freezing does not prove package ownership');
  decoration.underline = false;
  assert.equal(snapshot.decoration.underline, true);
  assert.equal(Object.isFrozen(snapshot.decoration), true);
  assert.equal(isOwnedTextPropertySnapshot(snapshot), true);
});

test('an equal prior snapshot wins over a different package-owned identity', () => {
  const previous = reuseOrCreateTextPropertySnapshot(undefined, { fontSize: 16 }, 'Test property');
  const equalOwned = ownTextPropertySnapshot({ fontSize: 16 });
  assert.notEqual(equalOwned, previous);
  assert.equal(reuseOrCreateTextPropertySnapshot(previous, equalOwned, 'Test property'), previous);
});

test('plain records snapshot to exactly what structuredClone produces', () => {
  const holes = [1, 2, 3];
  delete holes[1];
  const tagged = Object.assign([1, 2], { extra: true });
  const cases = [
    {
      fontSize: 12,
      color: '#fff',
      features: [{ tag: 'liga', value: 0, start: 0, end: 4 }],
      nested: { deep: [[1], []] },
    },
    { negativeZero: -0, notANumber: Number.NaN, big: 12n, missing: undefined, nothing: null },
    Object.assign(Object.create(null), { bare: 1 }),
    Object.defineProperty({ visible: 1 }, 'hidden', { value: 2, enumerable: false }),
    { [Symbol('ignored')]: 1, kept: 2 },
    JSON.parse('{"__proto__": {"polluted": true}, "own": 1}'),
    { holes, tagged, date: new Date(0), map: new Map([[1, 2]]) },
    {
      get computed() {
        return 7;
      },
    },
  ];
  for (const value of cases) {
    const snapshot = reuseOrCreateTextPropertySnapshot(undefined, value, 'Test property');
    assert.notEqual(snapshot, value);
    assert.deepStrictEqual(snapshot, structuredClone(value));
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
    assert.deepEqual(Reflect.ownKeys(snapshot), Reflect.ownKeys(structuredClone(value)));
  }
  assert.equal({}.polluted, undefined);

  for (const uncloneable of [{ call() {} }, { tag: Symbol('s') }, { nested: [() => 1] }]) {
    assert.throws(
      () => reuseOrCreateTextPropertySnapshot(undefined, uncloneable, 'Test property'),
      (error) => error instanceof TypeError && /must contain cloneable data/u.test(error.message),
    );
  }
  assert.throws(
    () =>
      reuseOrCreateTextPropertySnapshot(
        undefined,
        {
          get broken() {
            throw new Error('getter failed');
          },
        },
        'Test property',
      ),
    (error) => error instanceof TypeError && error.cause?.message === 'getter failed',
  );
});

test('caller mutation after a plain snapshot does not reach the owned record', () => {
  const value = { list: [{ size: 1 }] };
  const snapshot = reuseOrCreateTextPropertySnapshot(undefined, value, 'Test property');
  value.list[0].size = 2;
  value.list.push({ size: 3 });
  assert.deepEqual(snapshot, { list: [{ size: 1 }] });
});
