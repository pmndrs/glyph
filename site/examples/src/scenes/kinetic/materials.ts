import { color, mix, normalView, positionWorld, texture, uniform, uv, vec2 } from 'three/tsl';

import { LANE_TURN } from './config';
import { MeshBasicNodeMaterial, type Texture } from 'three/webgpu';

/** How far the tile has scrolled along the knot, in tile widths. */
export const surfaceScroll = uniform(0);

/**
 * The knot's skin, the Codrops way: the render target is a strip holding the
 * passage as it is typed in its middle lane and small type in the outer
 * ones; it repeats `repeat.x` times along the knot, wraps the tube once, and
 * scrolls by a uniform — the Codrops
 * `uv * repeat - time`, wrapped by the sampler rather than a `fract`. The strip's colour is taken as is, so the
 * accented word stays accented on the surface; a facing term and a depth
 * term shade the unlit tube so the knot reads as a solid. The strip is a live Slug
 * scene, so the words can change under the pattern without the pattern
 * noticing.
 */
export function surfaceMaterial(
  surface: Texture,
  repeat: { readonly x: number; readonly y: number },
): MeshBasicNodeMaterial {
  // Unlit, the way the Codrops piece is: the ink is the light, and a facing term and a depth term are the shade.
  const material = new MeshBasicNodeMaterial();
  // u runs against the reading direction on this geometry, so x is mirrored back and the type
  // reads forwards on the outside of the tube. The sampler wraps; the second term turns the strip
  // around the tube, which is what decides whether the big lane faces out or is hidden inside.
  const scrolled = uv().mul(vec2(-repeat.x, repeat.y)).add(vec2(surfaceScroll, LANE_TURN));
  const ink = texture(surface, scrolled).rgb;
  const facing = normalView.z.abs().mul(0.75).add(0.25);
  const depth = positionWorld.z.add(5.5).div(6.5).clamp(0.14, 1);
  material.colorNode = ink.add(color('#0b0e14')).mul(facing).mul(depth);
  return material;
}

/** A soft radial ground behind everything, so the knot sits in a space rather than on a flat black. */
export function groundMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const d = uv().sub(vec2(0.5, 0.42)).length();
  material.colorNode = mix(color('#131826'), color('#07080b'), d.mul(1.9).clamp(0, 1));
  return material;
}
