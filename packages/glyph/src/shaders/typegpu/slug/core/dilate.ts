/** Adapted from three-flatland Slug at 2935a89f (MIT). */
import { d, std } from 'typegpu';

/**
 * Expand one glyph-quad corner so the quad covers the whole antialiasing fringe past both adjacent edges on screen.
 *
 * The fragment shader takes each em axis's pixel scale from `fwidth`, the sum of the coordinate's absolute screen
 * derivatives, so coverage reaches zero `0.5 · (|t.x| + |t.y|) / |t|` pixels past an edge whose screen direction is
 * `t`: half a pixel when the edge is axis-aligned on screen, up to 0.707 px at 45°. Each axis therefore gets its own
 * step. One step shared by both, as Lengyel's `SlugDilate` takes along the `(±1, ±1)` corner, falls short on a
 * stretched or tilted plane, and a half-pixel target falls short on a rotated one.
 *
 * `outwardNormal` points out of the quad at this corner; only the sign of each component is used, so the corner
 * offset from the quad centre and `(±1, ±1)` are equivalent.
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
  const homogeneousW = std.dot(mvpRow3.xy, position) + mvpRow3.w;
  const clipX = std.dot(mvpRow0.xy, position) + mvpRow0.w;
  const clipY = std.dot(mvpRow1.xy, position) + mvpRow1.w;
  // Screen tangents of the quad's x and y edges at this corner, in pixels scaled by 2w².
  const xTangent = d.vec2f(
    (homogeneousW * mvpRow0.x - clipX * mvpRow3.x) * viewport.x,
    (homogeneousW * mvpRow1.x - clipY * mvpRow3.x) * viewport.y,
  );
  const yTangent = d.vec2f(
    (homogeneousW * mvpRow0.y - clipX * mvpRow3.y) * viewport.x,
    (homogeneousW * mvpRow1.y - clipY * mvpRow3.y) * viewport.y,
  );
  const xTangentL1 = std.abs(xTangent.x) + std.abs(xTangent.y);
  const yTangentL1 = std.abs(yTangent.x) + std.abs(yTangent.y);
  const area = std.abs(xTangent.x * yTangent.y - xTangent.y * yTangent.x);
  const squaredW = homogeneousW * homogeneousW;
  // Stepping `(mx, my)` along the quad axes puts the corner at m·area / (2w·|tangent|·w') pixels outside the edge each
  // axis crosses, where `tangent` is the other edge's and w' is w at the dilated corner. Setting that to the fringe,
  // 0.5·L1/L2 of the same tangent, cancels its length, so both steps need only L1 norms and share one denominator.
  // Towards the horizon the exact steps grow without bound, so the denominator is held at half the area (at most twice
  // the affine steps); the floor keeps a plane seen exactly edge-on finite.
  const denominator = std.max(
    std.max(area - homogeneousW * (corner.x * mvpRow3.x * yTangentL1 + corner.y * mvpRow3.y * xTangentL1), area * 0.5),
    1e-30,
  );
  const xStep = (yTangentL1 * squaredW) / denominator;
  const yStep = (xTangentL1 * squaredW) / denominator;
  const offset = d.vec2f(corner.x * xStep, corner.y * yStep);

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
