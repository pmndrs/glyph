import { HOLE_CENTER, HORIZON, HORIZON_ON_PLANE } from './content';
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
import { retained } from '../utils';

/**
 * Every uniform the hole publishes, kept across a hot module replacement: the mounted view writes them each frame
 * and the post pass reads them once when its graph is built, so both must hold the same set.
 */
export const holeUniforms = retained('black-hole', () => ({
  /** Shared with the glyph shaders: where the hole is on the floor, and how far it reaches. */
  uHoleCenter: uniform(new Vector2(HOLE_CENTER[0], HOLE_CENTER[1])),
  uHoleHorizon: uniform(HORIZON),
  /** 0 = no warp. 1 = the full spiral. */
  uHoleBend: uniform(0),
  /** Accumulated spin of the accretion disk and the warp's drag, in radians. */
  uHoleSpin: uniform(0),
  /** 0..1: how much of the frame is black. */
  uHoleBlackout: uniform(0),
  /** The camera's height over the floor: a glyph deeper down needs a wider reach to look the same size on screen. */
  uHoleCamera: uniform(16),
  /** The whole rendered sheet winds into the hole, exposing black behind its edges. */
  uHoleCollapse: uniform(0),
  /** Where the hole is on screen, as an offset from the centre in the frame's 0..1 coordinates. */
  uHoleScreen: uniform(new Vector2()),
  /** The hole's horizon on screen, as a share of the frame's height, or zero while it is not drawn. */
  uHoleLens: uniform(0),
  uHoleShake: uniform(new Vector2()),
  /** The hole's own drawing, driven from the beat once a frame. */
  uPresence: uniform(0),
  uHeat: uniform(0),
}));

export const { uHoleLens, uHoleBend, uHoleBlackout, uHoleCollapse, uHoleScreen, uHoleShake } = holeUniforms;
const { uHeat, uHoleCamera, uHoleCenter, uHoleHorizon, uHoleSpin, uPresence } = holeUniforms;

type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** Coverage bent around the black hole, and how much of the glyph survives that close to it. */
interface HoleWarp {
  readonly coverage: Node<'float'>;
  readonly survive: Node<'float'>;
  /** Distance from the hole in horizons at this depth, for tinting by proximity. */
  readonly near: Node<'float'>;
}

/**
 * Inverse-warp analytic glyph coverage around the hole. Anchor deformation at the glyph center and use screen
 * derivatives to map between world and glyph coordinates. `through` shifts the point the outline is read from a
 * little further, in world units across the floor, for glass seen through other glass.
 */
export function holeWarp(context: SlugContext, through?: Node<'vec2'>): HoleWarp {
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

  // On screen the hole is in the same place and the same size at every depth: its floor position is carried along
  // the camera's ray to this depth, and the horizon widens with the distance from the camera.
  const depth = uHoleCamera.sub(world.z).div(uHoleCamera);
  const holeCenter = uHoleCenter.mul(depth);
  const horizon = uHoleHorizon.mul(depth);
  const centerOffset = center.sub(holeCenter);
  const centerReach = centerOffset.length().max(0.0001);
  const near = centerReach.div(horizon);
  const fragmentOffset = here.sub(holeCenter);
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
  const bent = holeCenter.add(vec2(cos(angle), sin(angle)).mul(radius));
  const source = through === undefined ? bent : bent.add(through);

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

/**
 * Light bends toward the hole, so the frame around it is read from nearer in and stretches outward: a ray passing
 * at some distance is deflected by the square of the horizon over that distance. The bend begins outside the
 * hole's own drawing, whose glow reaches well past the horizon, and rises from nothing there, so the disk and its
 * ring of light stay exactly as drawn and no pixel of them is smeared outward; it closes off a few horizons
 * further on, so the far frame holds still rather than swimming. A hole that is not drawn bends nothing.
 */
function lensed(point: Node<'vec2'>, aspect: Node<'vec2'>): Node<'vec2'> {
  const horizon = uHoleLens.max(1e-5);
  const at = point.mul(aspect);
  const radius = at.length().max(1e-5);
  // The hole's core is drawn out to its horizon, and its ring of light a little past that. The bend rises from
  // nothing there and over the next horizon, which keeps what it reads always outside that ring however hard it
  // pulls, and closes off a few horizons further on so the far frame holds still rather than swimming.
  const drawn = horizon.mul(1.25);
  const full = horizon.mul(2.5);
  const bend = horizon
    .mul(horizon)
    .div(radius)
    .mul(1.8)
    .mul(smoothstep(drawn, full, radius))
    .mul(smoothstep(horizon.mul(5), full, radius));

  return at.mul(radius.sub(bend).div(radius)).div(aspect);
}

/** Bend the rendered sheet around the hole, wind it into the centre, and expose black behind its edges. */
export function collapseSheet(lit: TextureNode, point: Node<'vec2'>) {
  // `point` is the fragment's offset from the hole on screen; the sheet bends and winds about the hole, wherever
  // it is.
  const aspect = vec2(screenSize.x.div(screenSize.y), 1);
  const radius = point.mul(aspect).length();
  const collapse = uHoleCollapse;
  const scale = float(1).sub(collapse).max(0.002);
  // Inverse mapping keeps every pixel attached to the paper as its edges curl away from the viewport.
  const turn = collapse.mul(5).mul(float(1).sub(radius).max(0));
  const wound = vec2(
    point.x.mul(cos(turn)).sub(point.y.mul(sin(turn))),
    point.x.mul(sin(turn)).add(point.y.mul(cos(turn))),
  ).div(scale);
  const source = lensed(wound, aspect).add(0.5).add(uHoleScreen);
  const edge = source.sub(0.5).abs().max(source.sub(0.5).abs().yx).x;
  const paper = float(1)
    .sub(smoothstep(0.48, 0.5, edge))
    .mul(float(1).sub(smoothstep(0.995, 1, collapse)))
    .mul(float(1).sub(uHoleBlackout));
  const warped = lit.sample(source.clamp()).rgb;

  // The bend applies whenever the hole is drawn; the curling paper only once it is collapsing.
  return warped.mul(mix(float(1), paper, smoothstep(0, 0.025, collapse)));
}
