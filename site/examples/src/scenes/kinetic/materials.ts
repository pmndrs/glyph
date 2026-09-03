import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, mix, positionWorld, texture, uniform, uv, vec2 } from 'three/tsl';
import { MeshStandardNodeMaterial, type Texture } from 'three/webgpu';

/**
 * Ink on a path: depth-tested, so the knot hides what passes behind it, and
 * dimmed with distance from the camera plane the way the Codrops piece fakes
 * a shadow. `depthWrite` stays off — a glyph quad is transparent outside its
 * ink.
 */
export const pathInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  material.depthTest = true;
  const near = positionWorld.z.add(2.6).div(4.5).clamp(0.3, 1);
  material.colorNode = context.shader.color.mul(near);
  material.opacityNode = context.shader.opacity;
  return material;
});

/** How far the surface texture has scrolled along the knot, in texture widths. */
export const surfaceScroll = uniform(0);

/**
 * The tube: a lit standard material whose colour is the render target,
 * repeated `repeat.x` times along the knot and `repeat.y` times around it and
 * scrolled by a uniform — the Codrops `fract(uv * repeat - time)`. The
 * texture is a live Slug scene, so what wraps the knot is text being shaped
 * every frame, not a picture of it.
 */
export function surfaceMaterial(
  surface: Texture,
  repeat: { readonly x: number; readonly y: number },
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0.2, roughness: 0.55 });
  const scrolled = uv().mul(vec2(repeat.x, repeat.y)).add(vec2(surfaceScroll.negate(), 0)).fract();
  const ink = texture(surface, scrolled).r;
  material.colorNode = mix(color('#141a26'), color('#e7ecf6'), ink);
  material.emissiveNode = color('#ffd166').mul(ink).mul(0.28);
  return material;
}
