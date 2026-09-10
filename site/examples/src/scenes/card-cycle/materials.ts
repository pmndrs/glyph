import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, float, mix, normalLocal, normalize, positionLocal, sin, vec3 } from 'three/tsl';
import { DoubleSide, MeshPhysicalNodeMaterial, NormalBlending } from 'three/webgpu';

/** Paper grain and a shallow pressed fibre pattern are generated in card-local space, not loaded as textures. */
export function createPaperMaterial(): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({ color: '#f3e8d4', metalness: 0, roughness: 0.56 });
  const grain = sin(positionLocal.x.mul(173).add(positionLocal.y.mul(97)))
    .mul(0.5)
    .add(0.5);
  const fibres = sin(positionLocal.x.mul(41).sub(positionLocal.y.mul(151))).mul(0.018);

  material.colorNode = mix(color('#e6d4b9'), color('#fff9e9'), grain);
  material.roughnessNode = mix(float(0.48), float(0.7), grain);
  material.normalNode = normalize(normalLocal.add(vec3(fibres, grain.sub(0.5).mul(0.024), 0)));
  material.clearcoat = 0.13;
  material.clearcoatRoughness = 0.44;
  return material;
}

/** Glyph coverage supplies the shape; this factory turns the ink into a thin foil pressed into the paper. */
export const foilInk = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return context.createDefaultMaterial();

  const material = new MeshPhysicalNodeMaterial({
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  });
  const foil = sin(positionLocal.x.mul(38).add(positionLocal.y.mul(29)))
    .mul(0.1)
    .add(0.9);
  material.positionNode = context.position;
  material.colorNode = context.shader.color.mul(foil);
  material.opacityNode = context.shader.opacity;
  material.metalnessNode = float(0.72);
  material.roughnessNode = float(0.24);
  material.clearcoat = 0.22;
  material.clearcoatRoughness = 0.18;
  material.envMapIntensity = 0.8;
  return material;
});
