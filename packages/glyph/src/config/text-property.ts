// Three normalizes these records before the configured-controller seam. Marking
// package-owned snapshots lets that seam retain them without a second deep clone.
const ownedTextPropertySnapshots = new WeakSet<object>();

/** @internal Snapshot one text-property record or retain an equal owned snapshot. */
export function reuseOrCreateTextPropertySnapshot<Value extends object>(
  previous: Value | undefined,
  value: Value,
  label: string,
): Value {
  if (previous === value || ownedTextPropertySnapshots.has(value)) return value;
  if (previous !== undefined && equalTextProperty(previous, value)) return previous;
  let snapshot: Value;
  try {
    snapshot = structuredClone(value);
  } catch (cause) {
    throw new TypeError(`${label} must contain cloneable data`, { cause });
  }
  deepFreeze(snapshot);
  ownedTextPropertySnapshots.add(snapshot);
  return snapshot;
}

function equalTextProperty(previous: unknown, next: unknown): boolean {
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
