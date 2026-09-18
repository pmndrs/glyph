import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import { cross, dFdx, dFdy, dot, normalize, positionView } from 'three/tsl';
import { DoubleSide, type MeshStandardMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

/** The screen's finish under the pixels: glossy glass over a dark panel, so the studio glances off the text as it
 * does off the display. Constants rather than the screen's own metallic-roughness map: sampling that map inside a
 * glyph material draws nothing on the WebGPU path (pmndrs/glyph, to be filed). */
export interface ScreenFinish {
  readonly roughness: number;
  readonly metalness: number;
}

/** How much brighter than its paint colour a lit pixel glows. */
const GLOW = 1.5;
/** The unlit part of a pixel: a little of its colour, so it still reads where the glare washes the glow out. */
const BASE = 0.3;

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
    material.colorNode = shader.color.mul(BASE);
    material.emissiveNode = shader.color.mul(GLOW);
    // The quad's true facing from screen derivatives, towards the camera, whatever transform it is under.
    const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
    material.normalNode = face.mul(dot(face, normalize(positionView.negate())).sign());
    return material;
  });
}
