/** Adapted from three-flatland Slug at 2935a89f (MIT). */
import type { Node } from 'three/webgpu';
import { abs, add, div, dot, max, mul, sign, sub, vec2, vec4 } from 'three/tsl';

export interface SlugDilationNodes {
  readonly position: Node<'vec2'>;
  readonly textureCoordinate: Node<'vec2'>;
}

/**
 * Expand one glyph-quad corner so the quad covers the whole antialiasing fringe past both adjacent edges on screen.
 * Coverage takes each em axis's pixel scale from `fwidth`, so it reaches zero `0.5 · (|t.x| + |t.y|) / |t|` pixels past
 * an edge whose screen direction is `t`, and each axis gets its own step: one step shared by both, as Lengyel's
 * `SlugDilate` takes along the `(±1, ±1)` corner, falls short on a stretched or tilted plane, and a half-pixel target
 * falls short on a rotated one. Only the sign of each `outwardNormal` component is used, so the corner offset from the
 * quad centre and `(±1, ±1)` are equivalent.
 */
export function slugDilate(
  position: Node<'vec2'>,
  outwardNormal: Node<'vec2'>,
  textureCoordinate: Node<'vec2'>,
  inverseScale: Node<'float'>,
  mvpRow0: Node<'vec4'>,
  mvpRow1: Node<'vec4'>,
  mvpRow3: Node<'vec4'>,
  viewport: Node<'vec2'>,
): SlugDilationNodes {
  const homogeneousW = add(dot(mvpRow3.xy, position), mvpRow3.w).toVar('slugDilateW');
  const clipX = add(dot(mvpRow0.xy, position), mvpRow0.w).toVar('slugDilateClipX');
  const clipY = add(dot(mvpRow1.xy, position), mvpRow1.w).toVar('slugDilateClipY');
  return dilateFromProjection(
    position,
    outwardNormal,
    textureCoordinate,
    inverseScale,
    homogeneousW,
    mvpRow3.xy,
    vec2(
      sub(mul(homogeneousW, mvpRow0.x), mul(clipX, mvpRow3.x)),
      sub(mul(homogeneousW, mvpRow1.x), mul(clipY, mvpRow3.x)),
    ),
    vec2(
      sub(mul(homogeneousW, mvpRow0.y), mul(clipX, mvpRow3.y)),
      sub(mul(homogeneousW, mvpRow1.y), mul(clipY, mvpRow3.y)),
    ),
    viewport,
  );
}

/** Expand a glyph quad using the exact per-instance model-view-projection matrix selected by a batched draw. */
export function slugDilateMatrix(
  position: Node<'vec2'>,
  outwardNormal: Node<'vec2'>,
  textureCoordinate: Node<'vec2'>,
  inverseScale: Node<'float'>,
  modelViewProjection: Node<'mat4'>,
  viewport: Node<'vec2'>,
): SlugDilationNodes {
  const clipPosition = modelViewProjection.mul(vec4(position, 0, 1)).toVar('slugDilateClipPosition');
  const clipXAxis = modelViewProjection.mul(vec4(1, 0, 0, 0)).toVar('slugDilateClipXAxis');
  const clipYAxis = modelViewProjection.mul(vec4(0, 1, 0, 0)).toVar('slugDilateClipYAxis');
  return dilateFromProjection(
    position,
    outwardNormal,
    textureCoordinate,
    inverseScale,
    clipPosition.w,
    vec2(clipXAxis.w, clipYAxis.w),
    sub(mul(clipPosition.w, clipXAxis.xy), mul(clipXAxis.w, clipPosition.xy)),
    sub(mul(clipPosition.w, clipYAxis.xy), mul(clipYAxis.w, clipPosition.xy)),
    viewport,
  );
}

// `xTangentValue` and `yTangentValue` are the clip-space derivatives of the quad's x and y edges at this corner, times
// w²; scaled by the viewport they are screen tangents in pixels times 2w². Stepping `(mx, my)` along the quad axes puts
// the corner at m·area / (2w·|tangent|·w') pixels outside the edge each axis crosses, where `tangent` is the other
// edge's and w' is w at the dilated corner. Setting that to the fringe, 0.5·L1/L2 of the same tangent, cancels its
// length, so both steps need only L1 norms and share one denominator. Towards the horizon the exact steps grow without
// bound, so the denominator is held at half the area (at most twice the affine steps); the floor keeps a plane seen
// exactly edge-on finite.
function dilateFromProjection(
  position: Node<'vec2'>,
  outwardNormal: Node<'vec2'>,
  textureCoordinate: Node<'vec2'>,
  inverseScale: Node<'float'>,
  homogeneousW: Node<'float'>,
  wGradient: Node<'vec2'>,
  xTangentValue: Node<'vec2'>,
  yTangentValue: Node<'vec2'>,
  viewport: Node<'vec2'>,
): SlugDilationNodes {
  const corner = sign(outwardNormal).toVar('slugDilateCorner');
  const xTangent = mul(xTangentValue, viewport).toVar('slugDilateXTangent');
  const yTangent = mul(yTangentValue, viewport).toVar('slugDilateYTangent');
  const xTangentL1 = add(abs(xTangent.x), abs(xTangent.y)).toVar('slugDilateXTangentL1');
  const yTangentL1 = add(abs(yTangent.x), abs(yTangent.y)).toVar('slugDilateYTangentL1');
  const area = abs(sub(mul(xTangent.x, yTangent.y), mul(xTangent.y, yTangent.x))).toVar('slugDilateArea');
  const squaredW = mul(homogeneousW, homogeneousW).toVar('slugDilateSquaredW');
  const denominator = max(
    max(
      sub(area, mul(homogeneousW, add(mul(corner.x, wGradient.x, yTangentL1), mul(corner.y, wGradient.y, xTangentL1)))),
      mul(area, 0.5),
    ),
    1e-30,
  ).toVar('slugDilateDenominator');
  const xStep = div(mul(yTangentL1, squaredW), denominator);
  const yStep = div(mul(xTangentL1, squaredW), denominator);
  const dx = mul(corner.x, xStep);
  const dy = mul(corner.y, yStep);

  return {
    position: vec2(add(position.x, dx), add(position.y, dy)),
    textureCoordinate: vec2(
      add(textureCoordinate.x, mul(dx, inverseScale)),
      add(textureCoordinate.y, mul(dy, inverseScale)),
    ),
  };
}
