import { defineTextMaterial } from '@pmndrs/glyph/three';
import { positionWorld, sin, uniform, vec3 } from 'three/tsl';

/**
 * Text is geometry, so a material may colour or move its vertices. Both of
 * these read `context.position` or the world position and return something
 * else; the uniform is the animation: no re-shape, no re-plan, one write per
 * frame. Warps belong on MSDF or Bitmap text — Slug computes its own dilated
 * position and ignores a replacement — but a colour that reads depth works
 * on any format.
 */

/**
 * Ink on a surface: depth-tested, so the tube hides the far side, and dimmed
 * with distance from the camera plane the way the Codrops piece fakes a
 * shadow. `depthWrite` stays off — a glyph quad is transparent outside its ink.
 */
export const knotInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  material.depthTest = true;
  const near = positionWorld.z.add(2.2).div(4).clamp(0.25, 1);
  material.colorNode = context.shader.color.mul(near);
  material.opacityNode = context.shader.opacity;
  return material;
});

/** Flag: a travelling wave in z across the paragraph, stronger away from its left edge. */
export const waveTime = uniform(0);

export const wave = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  const p = context.position;
  const lift = sin(p.x.mul(1.1).add(waveTime.mul(1.8)))
    .mul(0.3)
    .add(sin(p.y.mul(2.4).add(waveTime)).mul(0.1));
  const reach = p.x.add(5.2).div(6).clamp(0, 1); // the left edge is pinned, like a flag on its pole
  material.positionNode = vec3(p.x, p.y, lift.mul(reach));
  return material;
});
