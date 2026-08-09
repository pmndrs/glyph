/** Adapted from three-flatland Slug at 2935a89f (MIT). */
import { d, std } from 'typegpu';

/**
 * Expand one glyph-quad vertex by a half-pixel antialiasing footprint.
 *
 * `xy` is the dilated plane position and `zw` the dilated glyph-em coordinate;
 * one vector keeps the whole vertex adjustment behind a single call.
 */
export function slugDilate(
  position: d.v2f,
  outwardNormal: d.v2f,
  textureCoordinate: d.v2f,
  inverseScale: number,
  mvpRow0: d.v4f,
  mvpRow1: d.v4f,
  mvpRow3: d.v4f,
  viewport: d.v2f,
): d.v4f {
  'use gpu';

  const normal = std.normalize(outwardNormal);
  const homogeneousW = std.dot(mvpRow3.xy, position) + mvpRow3.w;
  const wGradient = std.dot(mvpRow3.xy, normal);
  const projectedX =
    (homogeneousW * std.dot(mvpRow0.xy, normal) - wGradient * (std.dot(mvpRow0.xy, position) + mvpRow0.w)) * viewport.x;
  const projectedY =
    (homogeneousW * std.dot(mvpRow1.xy, normal) - wGradient * (std.dot(mvpRow1.xy, position) + mvpRow1.w)) * viewport.y;
  const squaredW = homogeneousW * homogeneousW;
  const projectedLengthSquared = projectedX * projectedX + projectedY * projectedY;
  const denominator = projectedLengthSquared - squaredW * wGradient * wGradient;
  const distance = (squaredW * (homogeneousW * wGradient + std.sqrt(projectedLengthSquared))) / denominator;
  const offset = std.mul(distance, normal);

  return d.vec4f(std.add(position, offset), std.add(textureCoordinate, std.mul(inverseScale, offset)));
}
