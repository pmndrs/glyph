import { ownTextPropertySnapshot } from '../../config/text-property.js';
import { sameSnapshot } from '../../internal/desired-text.js';
import { mergePropertyList } from '../../property-list.js';
import type { PropertyList } from '../../text-properties.js';

/** Detach one Vue-reactive property list and retain an equal prior package-owned snapshot. */
export function snapshotReactivePropertyList<Value extends object>(
  value: PropertyList<Value>,
  label: string,
  previous?: NoInfer<Value>,
): Value {
  if (previous !== undefined && propertyListMatchesSnapshot(value, previous, label)) return previous;
  return ownTextPropertySnapshot(snapshotReactiveProperty(mergePropertyList(value, label)));
}

/** Detach one Vue-reactive record so later in-place proxy mutations cannot rewrite accepted state. */
export function snapshotReactiveProperty<Value>(value: Value, previous?: Value): Value {
  if (previous !== undefined && sameSnapshot(previous, value)) return previous;
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => snapshotReactiveProperty(entry))) as Value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshotReactiveProperty(entry)])),
  ) as Value;
}

const propertyNotFound = Symbol('property not found');

function propertyListMatchesSnapshot<Value extends object>(
  value: PropertyList<Value>,
  snapshot: Value,
  label: string,
): boolean {
  if (!propertyListKeysBelongToSnapshot(value, snapshot, label)) return false;
  for (const key in snapshot) {
    if (!Object.hasOwn(snapshot, key)) continue;
    const current = finalPropertyListValue(value, key, label);
    if (current === propertyNotFound || !sameSnapshot(snapshot[key as keyof Value], current)) return false;
  }
  return true;
}

function propertyListKeysBelongToSnapshot<Value extends object>(
  value: PropertyList<Value>,
  snapshot: Value,
  label: string,
): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (Array.isArray(value)) {
    for (const nested of value) {
      if (!propertyListKeysBelongToSnapshot(nested, snapshot, label)) return false;
    }
    return true;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be an object or property array`);
  for (const key in value) {
    if (Object.hasOwn(value, key) && !Object.hasOwn(snapshot, key)) return false;
  }
  return true;
}

function finalPropertyListValue<Value extends object>(
  value: PropertyList<Value>,
  key: string,
  label: string,
): unknown | typeof propertyNotFound {
  if (value === undefined || value === null || value === false) return propertyNotFound;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index--) {
      const current = finalPropertyListValue(value[index], key, label);
      if (current !== propertyNotFound) return current;
    }
    return propertyNotFound;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be an object or property array`);
  return Object.prototype.propertyIsEnumerable.call(value, key)
    ? (value as Readonly<Record<string, unknown>>)[key]
    : propertyNotFound;
}
