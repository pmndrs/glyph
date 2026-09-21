import type { PropertyList } from './text-properties.js';

/** @internal Validate a PropertyList's container shape without allocating its merged record. */
export function assertPropertyList<Value extends object>(value: PropertyList<Value>, name: string): void {
  if (value === undefined || value === null || value === false) return;
  if (Array.isArray(value)) {
    for (const nested of value) assertPropertyList(nested, name);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${name} must be an object or property array`);
}

/** @internal Resolve React Native-style property arrays from left to right. */
export function mergePropertyList<Value extends object>(value: PropertyList<Value>, name: string): Value {
  const merged: Record<PropertyKey, unknown> = {};
  const visit = (entry: PropertyList<Value>): void => {
    if (entry === undefined || entry === null || entry === false) return;
    if (Array.isArray(entry)) {
      for (const nested of entry) visit(nested);
      return;
    }
    if (typeof entry !== 'object') throw new TypeError(`${name} must be an object or property array`);
    Object.assign(merged, entry);
  };
  visit(value);
  return merged as Value;
}
