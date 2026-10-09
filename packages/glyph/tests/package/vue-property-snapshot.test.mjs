import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotReactiveProperty, snapshotReactivePropertyList } from '../../dist/vue/internal/property-snapshot.js';

test('equal Vue property lists and records reuse their detached snapshots', () => {
  const style = snapshotReactivePropertyList(
    [{ fontSize: 12 }, false, { color: '#fff', decoration: { underline: true } }],
    'style',
  );
  const reusedStyle = snapshotReactivePropertyList(
    [{ fontSize: 12 }, null, [{ color: '#fff' }, { decoration: { underline: true } }]],
    'style',
    style,
  );
  const flow = snapshotReactiveProperty({
    regions: [{ key: 'main', shape: { kind: 'rectangle', bounds: [0, 0, 100, 50] } }],
  });
  const reusedFlow = snapshotReactiveProperty(
    { regions: [{ key: 'main', shape: { kind: 'rectangle', bounds: [0, 0, 100, 50] } }] },
    flow,
  );
  assert.equal(reusedStyle, style);
  assert.equal(reusedFlow, flow);
});

test('changed, removed, and malformed Vue property-list values cannot reuse a snapshot', () => {
  const previous = snapshotReactivePropertyList(
    [{ fontSize: 12 }, { color: '#fff', decoration: { underline: true } }],
    'style',
  );
  const changed = snapshotReactivePropertyList(
    [{ fontSize: 14 }, { color: '#fff', decoration: { underline: false } }],
    'style',
    previous,
  );
  const removed = snapshotReactivePropertyList({ fontSize: 12 }, 'style', previous);
  assert.notEqual(changed, previous);
  assert.notEqual(removed, previous);
  assert.deepEqual(changed, { fontSize: 14, color: '#fff', decoration: { underline: false } });
  assert.deepEqual(removed, { fontSize: 12 });
  assert.deepEqual(previous, { fontSize: 12, color: '#fff', decoration: { underline: true } });
  assert.throws(() => snapshotReactivePropertyList([previous, 1], 'style', previous), /style must be an object/);
});

test('non-enumerable properties do not shadow enumerable PropertyList values', () => {
  const previous = snapshotReactivePropertyList({ fontSize: 99 }, 'style');
  const shadow = Object.defineProperty({}, 'fontSize', { value: 99, enumerable: false });
  const next = snapshotReactivePropertyList([{ fontSize: 12 }, shadow], 'style', previous);
  assert.notEqual(next, previous);
  assert.deepEqual(next, { fontSize: 12 });
});
