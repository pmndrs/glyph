import type { RasterFormatMetadata } from '../config/raster-format.js';
import type { ParagraphSpan, TextInput } from '../formatted-text.js';
import type { FontSelection } from '../loaded-font.js';
import { mergePropertyList } from '../property-list.js';
import type { Constraints, ParagraphLayout, PropertyList, TextFlow, TextStyle } from '../text-properties.js';
import type { ThreeTextMaterial } from '../three/material.js';
import type { StandaloneTextProperties, TextGroup, TextUpdate } from '../three/text.js';

/** Package-owned normalized state used to compare framework input with the state accepted by Three. */
export interface AcceptedDesiredText<Format extends RasterFormatMetadata> {
  readonly font: FontSelection<Format>;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Format>[];
  readonly style: TextStyle;
  readonly layout: ParagraphLayout;
  readonly constraints: Constraints;
  readonly flow?: TextFlow;
  readonly rasterPixelRatio?: number;
  readonly material?: ThreeTextMaterial;
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
    !samePropertyList(left.style, right.style, 'Text style') ||
    !samePropertyList(left.layout, right.layout, 'Text layout') ||
    !samePropertyList(left.constraints, right.constraints, 'Text constraints') ||
    !sameSnapshot(left.flow, right.flow)
  )
    return false;
  return true;
}

/** Compare framework input with Three's immutable accepted state without retaining caller-owned input. */
export function acceptedDesiredTextMatches<Technique extends RasterFormatMetadata>(
  accepted: AcceptedDesiredText<Technique>,
  desired: Partial<StandaloneTextProperties<Technique>> & { readonly text: TextInput<Technique> },
): boolean {
  const content = desired.text;
  const desiredText = typeof content === 'string' ? content : content.text;
  const desiredSpans = typeof content === 'string' ? emptySpans : content.spans;
  return (
    accepted.font === desired.font &&
    accepted.text === desiredText &&
    sameSnapshot(accepted.spans, desiredSpans) &&
    (accepted.rasterPixelRatio ?? 1) === (desired.rasterPixelRatio ?? 1) &&
    accepted.material === desired.material &&
    samePropertyList(accepted.style, desired.style, 'Text style') &&
    samePropertyList(accepted.layout, desired.layout, 'Text layout') &&
    samePropertyList(accepted.constraints, desired.constraints, 'Text constraints') &&
    sameSnapshot(accepted.flow, desired.flow)
  );
}

const emptySpans: readonly never[] = Object.freeze([]);

function samePropertyList<Value extends object>(
  left: PropertyList<Value>,
  right: PropertyList<Value>,
  label: string,
): boolean {
  if (sameSnapshot(left, right)) return true;
  return sameSnapshot(mergePropertyList(left, label), mergePropertyList(right, label));
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
