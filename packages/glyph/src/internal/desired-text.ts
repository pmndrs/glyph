import type { RasterFormatMetadata } from '../config/raster-format.js';
import type { TextInput } from '../formatted-text.js';
import { mergePropertyList } from '../property-list.js';
import type { PropertyList } from '../text-properties.js';
import type { StandaloneTextProperties, TextGroup, TextUpdate } from '../three/text.js';

/** Read through reactive property records during render and retain a detached snapshot for later comparison. */
export function snapshotPropertyList<Value extends object>(
  value: PropertyList<Value>,
  label: string,
  previous?: NoInfer<Value>,
): Value {
  if (previous !== undefined && propertyListMatchesSnapshot(value, previous, label)) return previous;
  return snapshotProperty(mergePropertyList(value, label));
}

/** Text-property data contains only records, arrays, and primitives; font and material identities never enter here. */
export function snapshotProperty<Value>(value: Value, previous?: Value): Value {
  if (previous !== undefined && sameSnapshot(previous, value)) return previous;
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshotProperty)) as Value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshotProperty(entry)])),
  ) as Value;
}

/** Component props describe complete state; omitted props must reset Three's otherwise partial update. */
export function desiredTextUpdate<Technique extends RasterFormatMetadata>(
  desired: Partial<StandaloneTextProperties<Technique>> & { readonly text: TextInput<Technique> },
): TextUpdate<Technique> {
  const { pixelSnapping: _pixelSnapping, ...update } = desired;
  return {
    ...update,
    style: desired.style ?? {},
    layout: desired.layout ?? {},
    constraints: desired.constraints ?? {},
    flow: desired.flow,
    material: desired.material,
    rasterPixelRatio: desired.rasterPixelRatio ?? 1,
  };
}

/** Framework adapters republish only when the desired paragraph snapshot changed; fonts compare by identity, everything else structurally. */
export function sameDesiredText<Technique extends RasterFormatMetadata>(
  left: (Partial<StandaloneTextProperties<Technique>> & { readonly text: TextInput<Technique> }) | undefined,
  right: Partial<StandaloneTextProperties<Technique>> & { readonly text: TextInput<Technique> },
): boolean {
  if (
    left === undefined ||
    left.font !== right.font ||
    !sameSnapshot(left.text, right.text) ||
    left.rasterPixelRatio !== right.rasterPixelRatio ||
    left.material !== right.material ||
    !sameSnapshot(left.style, right.style) ||
    !sameSnapshot(left.layout, right.layout) ||
    !sameSnapshot(left.constraints, right.constraints) ||
    !sameSnapshot(left.flow, right.flow)
  )
    return false;
  return true;
}

/** Structural equality over frozen property snapshots; NaN equals NaN so a stale layout never republishes. */
export function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!sameSnapshot(left[index], right[index])) return false;
    }
    return true;
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  let leftCount = 0;
  let rightCount = 0;
  for (const key in leftRecord) {
    if (!Object.hasOwn(leftRecord, key)) continue;
    leftCount++;
    if (!Object.hasOwn(rightRecord, key) || !sameSnapshot(leftRecord[key], rightRecord[key])) return false;
  }
  for (const key in rightRecord) {
    if (Object.hasOwn(rightRecord, key)) rightCount++;
  }
  return leftCount === rightCount;
}

const propertyNotFound = Symbol('property not found');

/** Compare one left-to-right property list with a normalized snapshot without constructing another merged record. */
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
  return Object.hasOwn(value, key) ? (value as Readonly<Record<string, unknown>>)[key] : propertyNotFound;
}

/** Committed group props are complete desired state; `renderOrder` and `material` reset to Three's defaults when omitted. */
export interface DesiredTextGroupOptions {
  readonly material?: TextGroup['material'] | undefined;
  readonly renderOrder?: number | undefined;
}

/** Apply committed group props to the retained Three group; returns whether anything changed and a frame is due. */
export function applyTextGroupOptions(group: TextGroup, options: DesiredTextGroupOptions): boolean {
  let changed = false;
  if (group.material !== options.material) {
    group.material = options.material;
    changed = true;
  }
  const renderOrder = options.renderOrder ?? 0;
  if (group.renderOrder !== renderOrder) {
    group.renderOrder = renderOrder;
    changed = true;
  }
  return changed;
}
