import {
  cameraPosition,
  dot,
  float,
  normalize,
  positionView,
  positionWorld,
  refract,
  screenUV,
  step,
  texture,
  uniform,
  vec3,
} from 'three/tsl';
import { HalfFloatType, type Material, type Node, RenderTarget } from 'three/webgpu';
import { retained } from '../utils';

/**
 * Glass seen through glass. The renderer's transmission refracts only the opaque scene, so a letter bends the icon
 * field beneath it but not another letter or a rain pane. This capture renders every stained-glass draw from the
 * scene camera, keeping the frontmost pane's shading normal, depth, coverage, refractive index and slab, and a
 * glass material behind it reads the pane over its fragment and shifts the point its own outline is integrated at
 * along the refracted ray through that pane, the same ray the transmission sends into the field, so overlapping
 * glass bends each other's outlines as it bends the paper. The capture clones read their coverage without the lens,
 * since a capture must not read the texture it is drawing.
 */

/** How much nearer the camera a pane must be than a fragment to count as over it, in world units. */
const OVER = 0.05;

/** The capture and the nodes that sample it, kept across a module replacement like the uniforms are. */
const lens = retained('glass-lens', () => {
  const target = new RenderTarget(2, 2, { type: HalfFloatType, count: 2 });
  const [pane, glass] = target.textures;

  if (pane === undefined || glass === undefined) throw new Error('Missing glass lens attachments');

  pane.name = 'pane';
  glass.name = 'glass';

  return { target, pane: texture(pane), glass: texture(glass), uLens: uniform(1) };
});

/** 0..1: how far glass bends the glass behind it. The lens check turns it off for its control. */
export const uLens = lens.uLens;

/** The capture's target, which the lens system draws into. */
export const lensTarget = lens.target;

const plainCoverage = new WeakMap<Material, Node<'float'>>();

/** Give a glass material's coverage without the lens to the captures, which must not read what they draw. */
export function registerGlass(material: Material, coverage: Node<'float'>): void {
  plainCoverage.set(material, coverage);
}

export function plainCoverageOf(material: Material): Node<'float'> | undefined {
  return plainCoverage.get(material);
}

/**
 * How far, in world units across the floor, this fragment's outline is read from where it is, through the pane the
 * capture holds over it: nothing where no pane is nearer the camera than the fragment, or where the pane's
 * coverage has thinned to its edge, and otherwise the refracted ray into the pane, carried its slab deep, exactly
 * as the transmission carries it into the field.
 */
export function lensShift(): Node<'vec2'> {
  const pane = lens.pane.sample(screenUV);
  const glass = lens.glass.sample(screenUV);
  // Every channel is coverage-weighted, so the capture's filtering at a pane's edge blends only real glass.
  const weight = pane.a.max(0.0001);
  const depth = pane.z.div(weight);
  const over = step(positionView.z.add(OVER), depth);
  const through = pane.a.mul(over).mul(lens.uLens);
  const tilt = pane.xy.div(weight);
  // The pane's normal faces the camera, so its depth component is whatever its tilt leaves.
  const normal = vec3(tilt, float(1).sub(dot(tilt, tilt)).max(0).sqrt());
  const ior = glass.x.div(weight).max(1);
  const slab = glass.y.div(weight);
  const ray = refract(normalize(positionWorld.sub(cameraPosition)), normal, float(1).div(ior));

  return ray.xy.mul(slab).mul(through);
}
