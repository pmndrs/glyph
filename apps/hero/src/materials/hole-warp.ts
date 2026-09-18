import type { ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import { atan, cos, dFdx, dFdy, float, modelWorldMatrix, sin, smoothstep, uv, varying, vec2, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

import { uHoleBend, uHoleCamera, uHoleCenter, uHoleHorizon } from '../uniforms';

type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** How far a fragment's source is dragged round the hole at the horizon, in radians at full bend. */
const DRAG = 2.6;
/** How much a letterform is stretched towards the hole at the horizon, at full bend. */
const STRETCH = 1.4;
/** Where the fade to nothing begins and ends, in horizons. */
const FADE_FROM = 1.7;
const FADE_TO = 0.9;

/** Coverage bent around the black hole, and how much of the glyph survives that close to it. */
export interface HoleWarp {
  readonly coverage: Node<'float'>;
  readonly survive: Node<'float'>;
  /** Distance from the hole in horizons at this depth, for tinting by proximity. */
  readonly near: Node<'float'>;
}

/**
 * Bends a Slug letterform around the black hole. The quad is left alone; instead each fragment asks where its ink
 * came from, and the outline is integrated there, so the letter curls into the spiral with exact curves and
 * antialiasing from that source's own screen footprint: the analytic coverage is what makes a non-affine warp a
 * lookup rather than a resample.
 *
 * The warp is anchored at the glyph's own centre: a fragment is dragged round the hole only by the difference
 * between the drag at its radius and at the centre's, and stretched towards the hole about the centre, so the
 * letter deforms in place and never samples outside its own quad. World space, the quad and the glyph's em space
 * are all related affinely across a quad, so the maps between them come from their screen derivatives, whatever
 * transform the glyph's object carries.
 */
export function holeWarp(context: SlugContext): HoleWarp {
  // The glyph's own world position, from the position the renderer hands the material: `positionWorld` is built
  // from the raw quad before the renderer's per-glyph placement is applied, so it cannot be used here.
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
    return uHoleBend.mul(DRAG).div(at.mul(at).add(0.35));
  };
  const stretch = uHoleBend.mul(STRETCH).div(near.mul(near).add(0.35));
  // Where this fragment's ink was: turned about the hole by how much more it is dragged than the centre is, and
  // nearer the centre along the radius, so the visible letter is drawn out towards the hole.
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
    survive: smoothstep(float(FADE_TO), float(FADE_FROM), near).mul(uHoleBend).add(float(1).sub(uHoleBend)),
  };
}
