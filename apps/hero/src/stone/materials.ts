import { atan, color, float, mix, screenSize, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { AdditiveBlending, MeshBasicNodeMaterial, Vector2, Vector3, type Node, type TextureNode } from 'three/webgpu';
import { retained } from '../utils';
import { HORIZON_ON_PLANE } from './content';

/**
 * Every uniform the stone publishes, kept across a hot module replacement: the mounted view writes them each frame
 * and the post pass reads them once when its graph is built, so both must hold the same set.
 */
export const stoneUniforms = retained('stone', () => ({
  /** World x and y of the stone, and its horizon scaled by its presence. */
  uStone: uniform(new Vector3(0, 0, 0)),
  uStonePresence: uniform(0),
  /** Accumulated turn of the disk, in radians. */
  uStoneSpin: uniform(0),
  uStoneHeat: uniform(0),
  /** Where the stone is on screen, as an offset from the centre in the frame's 0..1 coordinates. */
  uStoneScreen: uniform(new Vector2()),
  /** Its horizon on screen as a share of the frame's height, or zero while it is not drawn. */
  uStoneLens: uniform(0),
}));

const { uStone, uStonePresence, uStoneSpin, uStoneHeat, uStoneScreen, uStoneLens } = stoneUniforms;

/** A point's distance from the stone, in horizons. Far away when there is no stone. */
export function stoneNear(world: Node<'vec2'>): Node<'float'> {
  return world.sub(uStone.xy).length().div(uStone.z.max(1e-3));
}

/** The disk's glow as light on whatever is near it: warm, and warmer as it feeds. */
export function stoneLight(world: Node<'vec2'>): Node<'vec3'> {
  const near = stoneNear(world);
  const glow = near.sub(1).max(0).mul(-0.75).exp().mul(uStonePresence).mul(uStoneHeat.mul(1.4).add(0.55));

  return vec3(1, 0.5, 0.2).mul(glow);
}

/** How far a point's light has been pulled toward red: full at the horizon, none a few horizons out. */
export function stoneRedshift(world: Node<'vec2'>): Node<'float'> {
  return float(1)
    .sub(smoothstep(1.1, 3.4, stoneNear(world)))
    .mul(uStonePresence);
}

/** The hole and its light: a black core out to the horizon, a photon ring, and a squashed, swirling disk. */
export function createStoneMaterials() {
  const point = uv().sub(0.5).mul(2);
  const radius = point.length();
  const diskPoint = point.mul(vec2(1, 2.9));
  const diskRadius = diskPoint.length();
  const angle = atan(diskPoint.y, diskPoint.x);
  const swirl = angle.mul(3).sub(diskRadius.mul(18)).add(uStoneSpin).sin().mul(0.26).add(0.74);
  const disk = diskRadius.sub(0.66).pow(2).mul(-55).exp().mul(swirl);
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
    .mul(0.14);
  const glow = uStoneHeat.mul(1.8).add(1);
  const core = new MeshBasicNodeMaterial({ color: '#000000', transparent: true, depthWrite: false, depthTest: false });
  core.opacityNode = float(1)
    .sub(smoothstep(HORIZON_ON_PLANE - 0.02, HORIZON_ON_PLANE, radius))
    .mul(uStonePresence);
  core.toneMapped = false;
  const light = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  light.colorNode = mix(color('#ff9a52'), color('#a9b4ff'), point.y.mul(2).add(0.5).clamp())
    .mul(disk.mul(1.5).add(halo))
    .mul(glow)
    .add(color('#fff1d6').mul(photonRing).mul(glow).mul(2.2));
  light.opacityNode = smoothstep(HORIZON_ON_PLANE, HORIZON_ON_PLANE + 0.04, radius)
    .mul(float(1).sub(smoothstep(0.7, 1, radius)))
    .mul(uStonePresence);
  light.toneMapped = false;

  return { core, light };
}

/**
 * Where on the frame a fragment's light came from, once the stone has bent it. Light passing the stone is turned
 * toward it by the square of the horizon over its distance, so the frame around the stone is read from nearer in
 * and stretches outward. The bend rises from nothing just outside the stone's own drawing, so the disk and its
 * ring stay as drawn, and closes off a few horizons further on, so the far frame holds still. `strength` scales
 * the bend, which is how the three colours come apart.
 */
function bent(point: Node<'vec2'>, aspect: Node<'vec2'>, strength: number): Node<'vec2'> {
  const horizon = uStoneLens.max(1e-5);
  const at = point.mul(aspect);
  const radius = at.length().max(1e-5);
  const drawn = horizon.mul(1.2);
  const full = horizon.mul(2.4);
  const bend = horizon
    .mul(horizon)
    .div(radius)
    .mul(1.9 * strength)
    .mul(smoothstep(drawn, full, radius))
    .mul(smoothstep(horizon.mul(6.5), full, radius));

  return at.mul(radius.sub(bend).div(radius)).div(aspect);
}

/**
 * The finished frame as seen past the stone: bent about it, with red bent least and blue most, so edges near the
 * horizon fringe, and pulled toward red the closer the light passed.
 */
export function lensFrame(lit: TextureNode, frame: Node<'vec2'>): Node<'vec3'> {
  const aspect = vec2(screenSize.x.div(screenSize.y), 1);
  const point = frame.sub(0.5).sub(uStoneScreen);
  const from = (strength: number) => bent(point, aspect, strength).add(0.5).add(uStoneScreen).clamp();
  const light = vec3(lit.sample(from(0.9)).r, lit.sample(from(1)).g, lit.sample(from(1.12)).b);
  const near = point.mul(aspect).length().div(uStoneLens.max(1e-5));
  const shift = float(1)
    .sub(smoothstep(1.2, 3, near))
    .mul(smoothstep(0, 0.02, uStoneLens));

  return mix(light, light.mul(vec3(1.35, 0.72, 0.5)), shift.mul(0.7));
}
