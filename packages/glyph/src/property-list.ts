import type { PropertyList } from './text-properties.js';

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
