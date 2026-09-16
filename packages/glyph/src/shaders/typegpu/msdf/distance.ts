import { d, std } from 'typegpu';
import type { MsdfCoverageInput } from '../msdf-shader.js';

/** Packed only for the Three node bridge: RGB-median distance, alpha distance, screen pixels per distance unit. */
export function msdfDistances(baseSample: d.v4f, atlasCoordinate: d.v2f, atlasSize: d.v2f, range: number): d.v3f {
  'use gpu';
  const rgb = baseSample.rgb;
  const fillDistance = std.max(std.min(rgb.r, rgb.g), std.min(std.max(rgb.r, rgb.g), rgb.b)) - 0.5;
  const trueDistance = baseSample.a - 0.5;
  // Euclidean derivative lengths keep the AA footprint unchanged under screen rotation.
  const dx = std.dpdx(atlasCoordinate);
  const dy = std.dpdy(atlasCoordinate);
  const screenTexels = std.inverseSqrt(std.max(dx.mul(dx).add(dy.mul(dy)), d.vec2f(1e-12)));
  const pixelRange = std.max(0.5 * std.dot(d.vec2f(range).div(atlasSize), screenTexels), 1);
  return d.vec3f(fillDistance, trueDistance, pixelRange);
}

/** Coverage and custom materials consume the same reconstructed distances. */
export function msdfCoverageFromDistances(input: MsdfCoverageInput, distances: d.v3f): d.v3f {
  'use gpu';
  const baseInside = insideRectangle(input.atlasCoordinate, input.uvBounds);
  const fillCoverage = distanceCoverage(distances.x, distances.z) * baseInside;
  const outlineCoverage = distanceCoverage(distances.y + input.outlineWidth, distances.z) * baseInside;
  const outlineOnly = std.max(outlineCoverage - fillCoverage, 0);
  const shadowCoverage =
    distanceCoverage(input.shadowSample.a - 0.5, distances.z) * insideRectangle(input.shadowCoordinate, input.uvBounds);
  return d.vec3f(fillCoverage, outlineOnly, shadowCoverage);
}

function distanceCoverage(distance: number, pixelsPerDistanceUnit: number): number {
  'use gpu';
  return std.clamp(distance * pixelsPerDistanceUnit + 0.5, 0, 1);
}

function insideRectangle(point: d.v2f, bounds: d.v4f): number {
  'use gpu';
  const inside = std.step(bounds.xy, point).mul(std.step(point, bounds.zw));
  return inside.x * inside.y;
}
