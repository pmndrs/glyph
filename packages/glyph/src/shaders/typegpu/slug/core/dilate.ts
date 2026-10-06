/** Adapted from three-flatland Slug at 2935a89f (MIT). */
import { d, std } from 'typegpu';

/**
 * Expand one glyph-quad corner by half a pixel along each quad axis, as Lengyel's
 * `SlugDilate` does for a `(±1, ±1)` corner normal.
 *
 * `outwardNormal` points out of the quad at this corner; only the sign of each
 * component is used, so the corner offset from the quad centre and `(±1, ±1)` are
 * equivalent. Coverage reaches zero half a pixel past a straight edge, so a smaller
 * margin on either axis clips antialiased edge pixels.
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

  const corner = std.sign(outwardNormal);
  const normal = std.normalize(corner);
  const homogeneousW = std.dot(mvpRow3.xy, position) + mvpRow3.w;
  const wGradient = std.dot(mvpRow3.xy, normal);
  const projectedX =
    (homogeneousW * std.dot(mvpRow0.xy, normal) - wGradient * (std.dot(mvpRow0.xy, position) + mvpRow0.w)) * viewport.x;
  const projectedY =
    (homogeneousW * std.dot(mvpRow1.xy, normal) - wGradient * (std.dot(mvpRow1.xy, position) + mvpRow1.w)) * viewport.y;
  const squaredW = homogeneousW * homogeneousW;
  const projectedLengthSquared = projectedX * projectedX + projectedY * projectedY;
  const denominator = projectedLengthSquared - squaredW * wGradient * wGradient;
  // `distance` is the object-space step along the unit `normal` that covers half a pixel on screen; scaling the
  // unnormalized `corner` by it gives half a pixel across each edge rather than along the diagonal.
  const distance = (squaredW * (homogeneousW * wGradient + std.sqrt(projectedLengthSquared))) / denominator;
  const offset = std.mul(distance, corner);

  return d.vec4f(std.add(position, offset), std.add(textureCoordinate, std.mul(inverseScale, offset)));
}

/** Matrix-input form for hosts that expose the complete per-instance model-view-projection. */
export function slugDilateMatrix(
  position: d.v2f,
  outwardNormal: d.v2f,
  textureCoordinate: d.v2f,
  inverseScale: number,
  modelViewProjection: d.m4x4f,
  viewport: d.v2f,
): d.v4f {
  'use gpu';
  const row0 = d.vec4f(
    modelViewProjection.columns[0].x,
    modelViewProjection.columns[1].x,
    modelViewProjection.columns[2].x,
    modelViewProjection.columns[3].x,
  );
  const row1 = d.vec4f(
    modelViewProjection.columns[0].y,
    modelViewProjection.columns[1].y,
    modelViewProjection.columns[2].y,
    modelViewProjection.columns[3].y,
  );
  const row3 = d.vec4f(
    modelViewProjection.columns[0].w,
    modelViewProjection.columns[1].w,
    modelViewProjection.columns[2].w,
    modelViewProjection.columns[3].w,
  );
  return slugDilate(position, outwardNormal, textureCoordinate, inverseScale, row0, row1, row3, viewport);
}
