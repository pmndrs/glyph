import type { LayoutPoint, ParagraphMeasurement } from './layout.js';
import type { Constraints, TextAnchor } from './text-properties.js';

/** @internal Resolves a validated anchor against unshifted paragraph metrics. Kept renderer-neutral so every host applies the same placement translation without changing shaping or measurement coordinates. */
export function resolveTextAnchor(measurement: ParagraphMeasurement, anchor: TextAnchor | undefined): LayoutPoint {
  const x = anchor?.x === 'center' ? measurement.width / 2 : anchor?.x === 'right' ? measurement.width : 0;
  let y = 0;
  switch (anchor?.y) {
    case 'middle':
      y = measurement.height / 2;
      break;
    case 'bottom':
      y = measurement.height;
      break;
    case 'first-baseline':
      y = measurement.firstBaseline;
      break;
    case 'last-baseline':
      y = measurement.lastBaseline;
      break;
    case 'alphabetic-baseline':
      y = measurement.alphabeticBaseline;
      break;
    case 'ideographic-baseline':
      y = measurement.ideographicBaseline;
      break;
    case 'cap-height-top':
      y = measurement.capHeightTop;
      break;
    case 'x-height-top':
      y = measurement.xHeightTop;
      break;
  }
  return Object.freeze({ x: x === 0 ? 0 : -x, y: y === 0 ? 0 : -y });
}

/** @internal Attaches host-placement metadata while retaining all paragraph-local query columns. */
export function withTextAnchor<Value extends ParagraphMeasurement>(
  measurement: Value,
  anchor: TextAnchor | undefined,
): Value {
  if (anchor === undefined && measurement.anchorOffset.x === 0 && measurement.anchorOffset.y === 0) return measurement;
  return Object.freeze({ ...measurement, anchorOffset: resolveTextAnchor(measurement, anchor) });
}

/** @internal Placement references do not participate in paragraph sizing or shaping. */
export function sameConstraintSizes(left: Constraints | undefined, right: Constraints | undefined): boolean {
  const sameAxis = (a: Constraints['width'], b: Constraints['width']) =>
    (a?.mode ?? 'unconstrained') === (b?.mode ?? 'unconstrained') &&
    (a?.mode === 'at-most' || a?.mode === 'exact' ? a.size : 0) ===
      (b?.mode === 'at-most' || b?.mode === 'exact' ? b.size : 0);
  return sameAxis(left?.width, right?.width) && sameAxis(left?.height, right?.height);
}
