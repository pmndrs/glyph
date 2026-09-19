import type { HoleState } from './traits';
import { HOLE_CENTER, HORIZON, PAPER_FROM, PAPER_UNTIL } from './content';
import {
  uniform,
  atan,
  cos,
  dFdx,
  dFdy,
  float,
  modelWorldMatrix,
  sin,
  smoothstep,
  uv,
  varying,
  vec2,
  vec4,
  color,
  mix,
  screenSize,
} from 'three/tsl';
import { Vector2, type Node, type TextureNode, AdditiveBlending, MeshBasicNodeMaterial } from 'three/webgpu';
import type { ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import { clamp } from 'math';
import { easing } from 'math/time';

/** Shared with the glyph shaders: where the hole is, how far it reaches, how hard it bends, and how it spins. */
export const uHoleCenter = uniform(new Vector2(HOLE_CENTER[0], HOLE_CENTER[1]));
export const uHoleHorizon = uniform(HORIZON);
/** 0 = no warp. 1 = the full spiral. */
export const uHoleBend = uniform(0);
/** Accumulated spin of the accretion disk and the warp's drag, in radians. */
export const uHoleSpin = uniform(0);
/** 0..1: how much of the frame is black. */
export const uHoleBlackout = uniform(0);
/** The camera's height over the floor: a glyph deeper down needs a wider reach to look the same size on screen. */
export const uHoleCamera = uniform(16);
/** The whole rendered sheet winds into the centre, exposing black behind its edges. */
export const uHoleCollapse = uniform(0);
export const uHoleShake = uniform(new Vector2());

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

/** The horizon's radius on the hole's own plane, as a fraction of the plane's half size. */
export const HORIZON_ON_PLANE = 0.42;

/** The hole's own drawing, driven from the beat once a frame. */
export const uPresence = uniform(0);
export const uHeat = uniform(0);

export function buildMaterials() {
  const point = uv().sub(0.5).mul(2);
  const radius = point.length();
  // The accretion disk: a squashed ring, swirling with the spin, hotter as the pull builds.
  const diskPoint = point.mul(vec2(1, 3.2));
  const diskRadius = diskPoint.length();
  const angle = atan(diskPoint.y, diskPoint.x);
  const swirl = angle.mul(3).sub(diskRadius.mul(18)).add(uHoleSpin).sin().mul(0.24).add(0.76);
  const disk = diskRadius.sub(0.62).pow(2).mul(-60).exp().mul(swirl);
  const photonRing = radius
    .sub(HORIZON_ON_PLANE + 0.02)
    .pow(2)
    .mul(-3400)
    .exp();
  const halo = radius
    .sub(HORIZON_ON_PLANE + 0.03)
    .max(0)
    .mul(-7)
    .exp()
    .mul(0.12);
  const glow = uHeat.mul(1.6).add(1);

  const core = new MeshBasicNodeMaterial({ color: '#000000', transparent: true, depthWrite: false });
  core.opacityNode = float(1)
    .sub(smoothstep(HORIZON_ON_PLANE - 0.02, HORIZON_ON_PLANE, radius))
    .mul(uPresence);
  core.toneMapped = false;

  const light = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  light.colorNode = mix(color('#ffa36a'), color('#b6adff'), point.y.mul(2).add(0.5).clamp())
    .mul(disk.mul(0.8).add(halo))
    .mul(glow)
    .add(color('#fff5dc').mul(photonRing).mul(glow).mul(1.3));
  light.opacityNode = smoothstep(HORIZON_ON_PLANE, HORIZON_ON_PLANE + 0.04, radius)
    .mul(float(1).sub(smoothstep(0.7, 1, radius)))
    .mul(uPresence);
  light.toneMapped = false;

  const black = new MeshBasicNodeMaterial({ color: '#000000', transparent: true, depthTest: false, depthWrite: false });
  black.opacityNode = uHoleBlackout;
  black.toneMapped = false;

  return { core, light, black };
}

/** GPU publication is a view concern. Simulation only changes the collapse trait. */
export function syncHoleUniforms(current: HoleState): void {
  uHoleCenter.value.set(current.x, current.y);
  uHoleHorizon.value = Math.max(current.horizon, 0.001);
  uHoleBend.value = current.pull;
  uHoleBlackout.value = current.blackout;
  uHoleCollapse.value = easing.cubicIn(clamp((current.time - PAPER_FROM) / (PAPER_UNTIL - PAPER_FROM), 0, 1));
  const t = Math.max(0, current.time);
  uHoleSpin.value = t * 1.2 + 3 * t ** 3;
  const shake = current.beat === 'open' ? 0.003 * current.pull * (1 - uHoleCollapse.value) : 0;
  uHoleShake.value.set(Math.sin(t * 71) * shake, Math.cos(t * 93) * shake);
}

/** Wind the rendered sheet into the centre and expose black behind its edges. */
export function collapseSheet(lit: TextureNode, point: Node<'vec2'>) {
  const aspect = vec2(screenSize.x.div(screenSize.y), 1);
  const radius = point.mul(aspect).length();
  const collapse = uHoleCollapse;
  const scale = float(1).sub(collapse).max(0.002);
  // Inverse mapping keeps every pixel attached to the paper as its edges curl away from the viewport.
  const turn = collapse.mul(5).mul(float(1).sub(radius).max(0));
  const source = vec2(
    point.x.mul(cos(turn)).sub(point.y.mul(sin(turn))),
    point.x.mul(sin(turn)).add(point.y.mul(cos(turn))),
  )
    .div(scale)
    .add(0.5);
  const edge = source.sub(0.5).abs().max(source.sub(0.5).abs().yx).x;
  const paper = float(1)
    .sub(smoothstep(0.48, 0.5, edge))
    .mul(float(1).sub(smoothstep(0.995, 1, collapse)))
    .mul(float(1).sub(uHoleBlackout));
  const warped = lit.sample(source.clamp()).rgb;

  return mix(lit.rgb, warped.mul(paper), smoothstep(0, 0.025, collapse));
}
