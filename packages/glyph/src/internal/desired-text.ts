import type { RasterFormatMetadata } from '../config/raster-format.js';
import type { TextInput } from '../formatted-text.js';
import type { StandaloneTextProperties } from '../three/text.js';

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
    !sameSnapshot(left.constraints, right.constraints)
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
    return left.every((value, index) => sameSnapshot(value, right[index]));
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => key in rightRecord && sameSnapshot(leftRecord[key], rightRecord[key]));
}
