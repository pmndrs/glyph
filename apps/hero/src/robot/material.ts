import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import { cross, dFdx, dFdy, dot, normalize, positionView } from 'three/tsl';
import { DoubleSide, type MeshStandardMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

/** Glossy display finish shared by the face and its text. */
export interface ScreenFinish {
  readonly roughness: number;
  readonly metalness: number;
}

/**
 * Glyphs as pixels lit on the robot's face screen: lit like the display they sit on, with the environment
 * glancing off them, and glowing from underneath.
 */
export function screenInk(screen: MeshStandardMaterial, finish: ScreenFinish): ThreeTextMaterial {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
    const { shader, position } = context;
    const material = new MeshStandardNodeMaterial({
      side: DoubleSide,
      envMapIntensity: screen.envMapIntensity,
      roughness: finish.roughness,
      metalness: finish.metalness,
    });
    material.positionNode = position;
    material.opacityNode = shader.coverage;
    material.alphaToCoverage = true;
    material.colorNode = shader.color.mul(0.3);
    material.emissiveNode = shader.color.mul(1.5);
    // The quad's true facing from screen derivatives, towards the camera, whatever transform it is under.
    const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
    material.normalNode = face.mul(dot(face, normalize(positionView.negate())).sign());
    return material;
  });
}
