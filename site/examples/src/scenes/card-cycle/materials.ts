import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, float, mix, normalLocal, normalize, positionLocal, sin, vec3 } from 'three/tsl';
import { DoubleSide, MeshPhysicalNodeMaterial, NormalBlending } from 'three/webgpu';

/** Procedural black card stock: cross-hatched grain under a glossy, light-reactive clear coat. */
export function createCardSurfaceMaterial(): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({ color: '#080808', metalness: 0.18, roughness: 0.38 });
  const grainA = sin(positionLocal.x.mul(211).add(positionLocal.y.mul(89)))
    .mul(0.5)
    .add(0.5);
  const grainB = sin(positionLocal.x.mul(73).sub(positionLocal.y.mul(197)))
    .mul(0.5)
    .add(0.5);
  const grain = grainA.mul(0.62).add(grainB.mul(0.38));
  const fibres = grainA.sub(0.5).mul(0.018);

  material.colorNode = mix(color('#020203'), color('#17140f'), grain.mul(0.72));
  material.roughnessNode = mix(float(0.25), float(0.52), grain);
  material.normalNode = normalize(normalLocal.add(vec3(fibres, grainB.sub(0.5).mul(0.018), 0)));
  material.clearcoat = 0.72;
  material.clearcoatRoughness = 0.16;
  material.envMapIntensity = 1.25;
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
  const foil = sin(positionLocal.x.mul(38).add(positionLocal.y.mul(29))).mul(0.14).add(0.86);
  material.positionNode = context.position;
  material.colorNode = context.shader.color.mul(foil);
  material.opacityNode = context.shader.opacity;
  material.metalnessNode = float(0.92);
  material.roughnessNode = float(0.17);
  material.clearcoat = 0.48;
  material.clearcoatRoughness = 0.1;
  material.envMapIntensity = 1.35;
  return material;
});
