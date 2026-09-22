import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import {
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  hash,
  mix,
  normalize,
  positionWorld,
  positionView,
  smoothstep,
  step as threshold,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial, type MeshStandardMaterial } from 'three/webgpu';
import { DUST_BASE_Z, DUST_RISE, FACE_FINISH } from './content';

/**
 * Glyphs as pixels lit on the robot's face screen: lit like the display they sit on, with the environment
 * glancing off them, and glowing from underneath.
 */
export function screenInk(screen: MeshStandardMaterial): ThreeTextMaterial {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

    const { shader, position } = context;
    const material = new MeshStandardNodeMaterial({
      side: DoubleSide,
      envMapIntensity: screen.envMapIntensity,
      roughness: FACE_FINISH.roughness,
      metalness: FACE_FINISH.metalness,
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

/** Driven each frame: the eyes shown or not, the tear's strength, and a seed that reshuffles the bands. */
export const uEyes = uniform(1);
export const uTear = uniform(0);
export const uSeed = uniform(0);

/** Glitch the eyes out in horizontal bands while a printed line appears, then restore them as it clears. */
export function glitchingScreen(screen: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    map: screen.map,
    roughnessMap: screen.roughnessMap,
    metalnessMap: screen.metalnessMap,
    roughness: screen.roughness,
    metalness: screen.metalness,
    emissive: screen.emissive,
    emissiveIntensity: screen.emissiveIntensity,
    envMapIntensity: screen.envMapIntensity,
    side: screen.side,
  });

  if (screen.map === null) return material;

  const at = uv();
  const band = hash(at.y.mul(36).floor().add(uSeed));
  const torn = vec2(at.x.add(band.sub(0.5).mul(uTear).mul(0.06)), at.y);
  const picture = texture(screen.map, torn).rgb;
  // The eyes are the only thing on the panel brighter than the panel: painting them its colour puts them out.
  const lit = threshold(0.06, picture.r.max(picture.g).max(picture.b));
  const dark = mix(picture, vec3(0.03), lit);
  const flipped = threshold(band, uTear);
  const eyes = mix(uEyes, float(1).sub(uEyes), flipped);
  material.colorNode = mix(dark, picture, eyes);

  return material;
}

/** Height encodes lifetime, so all particles share one material and fade without re-shaping their text. */
export const dustInk = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  material.name = 'cameo-robot-dust';
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage.mul(
    smoothstep(DUST_BASE_Z + DUST_RISE * 0.15, DUST_BASE_Z + DUST_RISE, positionWorld.z)
      .oneMinus()
      .mul(0.6),
  );

  return material;
});
