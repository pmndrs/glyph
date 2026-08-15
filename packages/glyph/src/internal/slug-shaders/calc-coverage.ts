/** Adapted from three-flatland Slug at 2935a89f (MIT). */
import type { Node } from 'three/webgpu';
import { abs, add, div, fract, max, min, mul, saturate, select, sqrt, sub } from 'three/tsl';

/** Combine horizontal and vertical winding coverage using Lengyel's weighted blend. */
export function calcCoverage(
  xCoverage: Node<'float'>,
  xWeight: Node<'float'>,
  yCoverage: Node<'float'>,
  yWeight: Node<'float'>,
  evenOdd: Node<'bool'>,
  weightBoost: Node<'bool'>,
  stemDarken?: Node<'float'>,
  pixelsPerEm?: Node<'float'>,
): Node<'float'> {
  const weightedNumerator = abs(add(mul(xCoverage, xWeight), mul(yCoverage, yWeight)));
  const weighted = div(weightedNumerator, max(add(xWeight, yWeight), 1 / 65_536));
  const fallback = min(abs(xCoverage), abs(yCoverage));
  const rawCoverage = max(weighted, fallback).toVar('slugRawCoverage');
  const nonzeroCoverage = saturate(rawCoverage);
  const evenOddCoverage = sub(1, abs(sub(1, mul(fract(mul(rawCoverage, 0.5)), 2))));
  const filledCoverage = select(evenOdd, evenOddCoverage, nonzeroCoverage).toVar('slugCoverage');
  filledCoverage.assign(select(weightBoost, sqrt(filledCoverage), filledCoverage));

  if (stemDarken !== undefined && pixelsPerEm !== undefined) {
    const darken = mul(stemDarken, max(0, sub(1, div(pixelsPerEm, 24))));
    filledCoverage.assign(min(add(filledCoverage, mul(darken, filledCoverage, sub(1, filledCoverage))), 1));
  }

  return filledCoverage;
}
