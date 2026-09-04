import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, mix, normalView, positionWorld } from 'three/tsl';
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';

/**
 * Type on the ribbon: depth-tested, so the ribbon hides the words it passes
 * over, and dimmed with distance so the far side reads as far. The quad
 * still never writes depth.
 */
export const ribbonInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  material.depthTest = true;
  const near = positionWorld.z.add(3.2).div(5.4).clamp(0.25, 1);
  material.colorNode = context.shader.color.mul(near);
  material.opacityNode = context.shader.opacity;
  return material;
});

/** A satin band, shaded by its own facing rather than a light rig: bright where it faces the camera, dark edge-on. */
export function ribbonMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  const facing = normalView.z.abs().clamp(0, 1);
  material.colorNode = mix(color('#0d1119'), color('#3a4664'), facing.pow(1.4));
  return material;
}
