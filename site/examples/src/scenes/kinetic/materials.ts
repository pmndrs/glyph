import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, mix, positionWorld, texture, uniform, uv, vec2 } from 'three/tsl';
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
 * The knot's skin: unlit, the way the Codrops piece is. The render target is
 * a tile holding one word; it repeats `repeat.x` times along the knot and
 * `repeat.y` times around the tube and scrolls by a uniform — the Codrops
 * `fract(uv * repeat - time)` — and a fake shadow darkens what sits deeper in
 * the scene. The tile is a live Slug scene, so the word can change under the
 * pattern without the pattern noticing.
 */
export function surfaceMaterial(
  surface: Texture,
  repeat: { readonly x: number; readonly y: number },
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  // u runs against the reading direction on this geometry, so x is mirrored back; scrolling then runs with the text.
  const scrolled = uv().mul(vec2(-repeat.x, repeat.y)).add(vec2(surfaceScroll, 0)).fract();
  const ink = texture(surface, scrolled).r;
  const shadow = positionWorld.z.add(5.5).div(6.5).clamp(0.08, 1);
  material.colorNode = mix(color('#0a0d13'), color('#f2f4f8'), ink).mul(shadow);
  return material;
}

/** A soft radial ground behind everything, so the knot sits in a space rather than on a flat black. */
export function groundMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const d = uv().sub(vec2(0.5, 0.42)).length();
  material.colorNode = mix(color('#131826'), color('#07080b'), d.mul(1.9).clamp(0, 1));
  return material;
}
