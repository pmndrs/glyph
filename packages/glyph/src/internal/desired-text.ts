import type { RasterFormatMetadata } from '../config/raster-format.js';
import type { TextInput } from '../formatted-text.js';
import type { StandaloneTextProperties, TextGroup, TextUpdate } from '../three/text.js';

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

/** Committed group props are complete desired state; `renderOrder` and `material` reset to Three's defaults when omitted. */
export interface DesiredTextGroupOptions {
  readonly batching?: TextGroup['batching'] | undefined;
  readonly material?: TextGroup['material'] | undefined;
  readonly renderOrder?: number | undefined;
}

/** Apply committed group props to the retained Three group; returns whether anything changed and a frame is due. */
export function applyTextGroupOptions(group: TextGroup, options: DesiredTextGroupOptions): boolean {
  let changed = false;
  const batching = options.batching ?? 'auto';
  if (group.batching !== batching) {
    group.batching = batching;
    changed = true;
  }
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
