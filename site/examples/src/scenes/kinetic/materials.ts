import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, mix, normalView, positionWorld, texture, uniform, uv, vec2 } from 'three/tsl';
import { MeshBasicNodeMaterial, type Texture } from 'three/webgpu';

/**
 * Ink on a path: depth-tested, so the knot hides what passes behind it, and
 * dimmed with distance from the camera plane. `depthWrite` stays off — a
 * glyph quad is transparent outside its ink.
 */
export const pathInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  material.depthTest = true;
  const near = positionWorld.z.add(4).div(6).clamp(0.2, 1);
  material.colorNode = context.shader.color.mul(near);
  material.opacityNode = context.shader.opacity;
  return material;
});

/** How far the tile has scrolled along the knot, in tile widths. */
export const surfaceScroll = uniform(0);

/**
 * The knot's skin, the Codrops way: the render target is a strip holding the
 * passage as it is typed; it repeats `repeat.x` times along the knot and
 * `repeat.y` times around the tube and scrolls by a uniform — the Codrops
 * `uv * repeat - time`, wrapped by the sampler rather than a `fract`. The strip's colour is taken as is, so the
 * accented word stays accented on the surface; a facing term and a depth
 * term shade the tube so the knot reads as a solid. The strip is a live Slug
 * scene, so the words can change under the pattern without the pattern
 * noticing.
 */
export function surfaceMaterial(
  surface: Texture,
  repeat: { readonly x: number; readonly y: number },
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  // u runs against the reading direction on this geometry, so x is mirrored back; scrolling then runs with the text.
  const scrolled = uv().mul(vec2(-repeat.x, repeat.y)).add(vec2(surfaceScroll, 0)); // the sampler wraps
  const ink = texture(surface, scrolled).rgb;
  const facing = normalView.z.abs().mul(0.7).add(0.3);
  const depth = positionWorld.z.add(5.5).div(6.5).clamp(0.12, 1);
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
