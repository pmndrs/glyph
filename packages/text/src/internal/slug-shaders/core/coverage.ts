/** Adapted from three-flatland Slug at 2935a89f (MIT). */
import { d, std } from 'typegpu';

/**
 * Combine horizontal and vertical winding coverage using Lengyel's weighted blend.
 *
 * `stemDarken` of zero disables darkening exactly, so the caller has no optional
 * shader parameter to model; the final clamp is a no-op on the already-bounded
 * fill value.
 */
export function calcCoverage(
  xCoverage: number,
  xWeight: number,
  yCoverage: number,
  yWeight: number,
  evenOdd: boolean,
  weightBoost: boolean,
  stemDarken: number,
  pixelsPerEm: number,
): number {
  'use gpu';

  const weighted = std.abs(xCoverage * xWeight + yCoverage * yWeight) / std.max(xWeight + yWeight, 1 / 65_536);
  const fallback = std.min(std.abs(xCoverage), std.abs(yCoverage));
  const rawCoverage = std.max(weighted, fallback);
  const evenOddCoverage = 1 - std.abs(1 - std.fract(rawCoverage * 0.5) * 2);
  const filledCoverage = std.select(std.saturate(rawCoverage), evenOddCoverage, evenOdd);
  const boostedCoverage = std.select(filledCoverage, std.sqrt(filledCoverage), weightBoost);
  const darken = stemDarken * std.max(d.f32(0), 1 - pixelsPerEm / 24);

  return std.min(boostedCoverage + darken * boostedCoverage * (1 - boostedCoverage), 1);
}
