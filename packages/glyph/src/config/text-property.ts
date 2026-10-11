import { assertTextStyle, type TextStyle } from '../text-properties.js';

// Ownership and style authority share one provenance registry. A frozen layout/reactive snapshot has no style proof.
const ownedTextPropertySnapshots = new WeakMap<object, 'snapshot' | 'validated-style'>();

/** @internal Mark one deeply frozen package-created text-property snapshot for zero-copy adoption. */
export function ownTextPropertySnapshot<Value extends object>(value: Value): Value {
  deepFreeze(value);
  if (!ownedTextPropertySnapshots.has(value)) ownedTextPropertySnapshots.set(value, 'snapshot');
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
  if (ownedTextPropertySnapshots.get(value) !== 'validated-style') assertTextStyle(value, label);
  const snapshot = reuseOrCreateTextPropertySnapshot(previous, value, label);
  ownedTextPropertySnapshots.set(snapshot, 'validated-style');
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
  return equalTextPropertyObjects(previous, next, new WeakMap(), new WeakMap());
}

function equalTextPropertyObjects(
  previous: object,
  next: object,
  previousToNext: WeakMap<object, object>,
  nextToPrevious: WeakMap<object, object>,
): boolean {
  const matchedNext = previousToNext.get(previous);
  if (matchedNext !== undefined) return matchedNext === next;
  const matchedPrevious = nextToPrevious.get(next);
  if (matchedPrevious !== undefined) return matchedPrevious === previous;
  previousToNext.set(previous, next);
  nextToPrevious.set(next, previous);
  const previousKeys = Reflect.ownKeys(previous);
  const nextKeys = Reflect.ownKeys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => {
    if (!Object.hasOwn(next, key)) return false;
    const previousValue = Reflect.get(previous, key);
    const nextValue = Reflect.get(next, key);
    if (Object.is(previousValue, nextValue)) return true;
    if (
      typeof previousValue !== 'object' ||
      previousValue === null ||
      typeof nextValue !== 'object' ||
      nextValue === null
    ) {
      return false;
    }
    return equalTextPropertyObjects(previousValue, nextValue, previousToNext, nextToPrevious);
  });
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}
