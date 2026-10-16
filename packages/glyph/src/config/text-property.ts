import { assertTextStyle, type TextStyle } from '../text-properties.js';

type TextPropertySnapshotMetadata = {
  authority: 'snapshot' | 'validated-style';
  keys?: readonly (string | symbol)[];
};

// Ownership and style authority share one provenance registry. A frozen layout/reactive snapshot has no style proof.
const ownedTextPropertySnapshots = new WeakMap<object, TextPropertySnapshotMetadata>();

/** @internal Mark one deeply frozen package-created text-property snapshot for zero-copy adoption. */
export function ownTextPropertySnapshot<Value extends object>(value: Value): Value {
  deepFreeze(value);
  const metadata = ownedTextPropertySnapshots.get(value);
  if (metadata === undefined) {
    ownedTextPropertySnapshots.set(value, { authority: 'snapshot', keys: Reflect.ownKeys(value) });
  } else if (metadata.keys === undefined) {
    metadata.keys = Reflect.ownKeys(value);
  }
  return value;
}

/** @internal Whether a text-property record is already a deeply frozen package-created snapshot. */
export function isOwnedTextPropertySnapshot(value: unknown): value is object {
  return typeof value === 'object' && value !== null && ownedTextPropertySnapshots.has(value);
}

/** @internal Validate caller-authored style once and own its deeply frozen snapshot; scope is validated separately. */
export function reuseOrCreateTextStyleSnapshot(
  previous: TextStyle | undefined,
  value: TextStyle,
  label: string,
): TextStyle {
  if (ownedTextPropertySnapshots.get(value)?.authority !== 'validated-style') assertTextStyle(value, label);
  const snapshot = reuseOrCreateTextPropertySnapshot(previous, value, label);
  const metadata = ownedTextPropertySnapshots.get(snapshot);
  if (metadata === undefined) {
    ownedTextPropertySnapshots.set(snapshot, { authority: 'validated-style' });
  } else {
    metadata.authority = 'validated-style';
  }
  return snapshot;
}

/** @internal Snapshot one text-property record or retain an equal owned snapshot. */
export function reuseOrCreateTextPropertySnapshot<Value extends object>(
  previous: Value | undefined,
  value: Value,
  label: string,
): Value {
  if (previous === value) return value;
  if (previous !== undefined && equalTextPropertySnapshots(previous, value)) return previous;
  if (isOwnedTextPropertySnapshot(value)) return value;
  let snapshot: Value;
  try {
    snapshot = structuredClone(value);
  } catch (cause) {
    throw new TypeError(`${label} must contain cloneable data`, { cause });
  }
  return ownTextPropertySnapshot(snapshot);
}

/** @internal Structural equality for canonical package-owned text state. */
export function equalTextPropertySnapshots(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (typeof previous !== 'object' || previous === null || typeof next !== 'object' || next === null) return false;
  return equalTextPropertyObjects(previous, next);
}

function equalTextPropertyObjects(
  previous: object,
  next: object,
  correspondence?: { previousToNext: WeakMap<object, object>; nextToPrevious: WeakMap<object, object> },
): boolean {
  let graph = correspondence;
  if (graph !== undefined) {
    const matchedNext = graph.previousToNext.get(previous);
    if (matchedNext !== undefined) return matchedNext === next;
    const matchedPrevious = graph.nextToPrevious.get(next);
    if (matchedPrevious !== undefined) return matchedPrevious === previous;
    graph.previousToNext.set(previous, next);
    graph.nextToPrevious.set(next, previous);
  }
  const previousKeys = ownedTextPropertySnapshots.get(previous)?.keys ?? Reflect.ownKeys(previous);
  const nextKeys = ownedTextPropertySnapshots.get(next)?.keys ?? Reflect.ownKeys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (!Object.hasOwn(next, key)) return false;
    const previousValue = Reflect.get(previous, key);
    const nextValue = Reflect.get(next, key);
    if (Object.is(previousValue, nextValue)) continue;
    if (
      typeof previousValue !== 'object' ||
      previousValue === null ||
      typeof nextValue !== 'object' ||
      nextValue === null
    ) {
      return false;
    }
    if (graph === undefined) {
      graph = { previousToNext: new WeakMap(), nextToPrevious: new WeakMap() };
      graph.previousToNext.set(previous, next);
      graph.nextToPrevious.set(next, previous);
    }
    if (!equalTextPropertyObjects(previousValue, nextValue, graph)) return false;
  }
  return true;
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}
