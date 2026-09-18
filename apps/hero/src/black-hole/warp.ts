import type { ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import { atan, cos, dFdx, dFdy, float, modelWorldMatrix, sin, smoothstep, uv, varying, vec2, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

import { uHoleBend, uHoleCamera, uHoleCenter, uHoleHorizon } from './uniforms';

type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** Coverage bent around the black hole, and how much of the glyph survives that close to it. */
export interface HoleWarp {
  readonly coverage: Node<'float'>;
  readonly survive: Node<'float'>;
  /** Distance from the hole in horizons at this depth, for tinting by proximity. */
  readonly near: Node<'float'>;
}

/**
 * Inverse-warp analytic glyph coverage around the hole. Anchor deformation at the glyph center and use screen
 * derivatives to map between world and glyph coordinates.
 */
export function holeWarp(context: SlugContext): HoleWarp {
  // Use per-glyph placement from the text material context when deriving world position.
  const world = varying(modelWorldMatrix.mul(vec4(context.position, 1)).xyz, 'pmndrsHoleWorld');
  const here = world.xy;
  const worldX = dFdx(here);
  const worldY = dFdy(here);

  // The quad's centre in world space: the unit quad's (0.5, 0.5), reached through the quad-to-world Jacobian.
  const quad = uv();
  const quadX = dFdx(quad);
  const quadY = dFdy(quad);
  const quadDeterminant = quadX.x.mul(quadY.y).sub(quadY.x.mul(quadX.y));
  const quadSafe = quadDeterminant.abs().greaterThan(1e-9);
  const inverseQuad = float(1).div(quadDeterminant.add(quadSafe.select(float(0), float(1e-9))));
  const toCenter = vec2(0.5, 0.5).sub(quad);
  const centerStepX = quadY.y.mul(toCenter.x).sub(quadY.x.mul(toCenter.y)).mul(inverseQuad);
  const centerStepY = quadX.x.mul(toCenter.y).sub(quadX.y.mul(toCenter.x)).mul(inverseQuad);
  const center = quadSafe.select(here.add(worldX.mul(centerStepX)).add(worldY.mul(centerStepY)), here);

  // On screen the hole is the same size at every depth, so the horizon widens with the distance from the camera.
  const horizon = uHoleHorizon.mul(uHoleCamera.sub(world.z).div(uHoleCamera));
  const centerOffset = center.sub(uHoleCenter);
  const centerReach = centerOffset.length().max(0.0001);
  const near = centerReach.div(horizon);
  const fragmentOffset = here.sub(uHoleCenter);
  const fragmentReach = fragmentOffset.length().max(0.0001);

  // Drag and stretch fall off with the square of the distance, in horizons, so far glyphs are untouched.
  const dragAt = (reach: Node<'float'>) => {
    const at = reach.div(horizon);

    return uHoleBend.mul(2.6).div(at.mul(at).add(0.35));
  };

  const stretch = uHoleBend.mul(1.4).div(near.mul(near).add(0.35));
  // Invert angular drag and radial stretch to locate the source ink.
  const angle = atan(fragmentOffset.y, fragmentOffset.x).sub(dragAt(fragmentReach).sub(dragAt(centerReach)));
  const radius = centerReach.add(fragmentReach.sub(centerReach).div(stretch.add(1)));
  const source = uHoleCenter.add(vec2(cos(angle), sin(angle)).mul(radius));

  // em = em(here) + A · (source - here), with A the em-per-world Jacobian from screen derivatives.
  const em = context.shader.renderCoordinate;
  const emX = dFdx(em);
  const emY = dFdy(em);
  const determinant = worldX.x.mul(worldY.y).sub(worldY.x.mul(worldX.y));
  const safe = determinant.abs().greaterThan(1e-7);
  const inverseDeterminant = float(1).div(determinant.add(safe.select(float(0), float(1e-7))));
  const delta = source.sub(here);
  // Screen-space steps that produce `delta` in world space, then the em change those steps make.
  const stepX = worldY.y.mul(delta.x).sub(worldY.x.mul(delta.y)).mul(inverseDeterminant);
  const stepY = worldX.x.mul(delta.y).sub(worldX.y.mul(delta.x)).mul(inverseDeterminant);
  const shifted = em.add(emX.mul(stepX)).add(emY.mul(stepY));
  const warped = safe.select(shifted, em);

  return {
    near,
    coverage: context.shader.coverageAt(warped),
    survive: smoothstep(float(0.9), float(1.7), near).mul(uHoleBend).add(float(1).sub(uHoleBend)),
  };
}
