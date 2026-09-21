import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import {
  atan,
  cross,
  dFdx,
  dFdy,
  dot,
  normalize,
  positionView,
  exp,
  float,
  fract,
  hash,
  mix,
  step as threshold,
  texture,
  uniform,
  uv,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import { DoubleSide, type MeshStandardMaterial, MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { BASE_Z, RISE } from './content';
import { THEME_RED } from '../letters/content';

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

/** Driven each frame: the eyes shown or not, the tear's strength, and a seed that reshuffles the bands. */
export const uEyes = uniform(1);
export const uTear = uniform(0);
export const uSeed = uniform(0);

/** Glitch the eyes out in horizontal bands while the face text appears, then restore them as it clears. */
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

export const shadowMaterial = new MeshBasicNodeMaterial({ color: '#000000', depthWrite: false, transparent: true });
shadowMaterial.opacityNode = exp(uv().sub(0.5).length().mul(3.2).pow(2).negate()).mul(0.32);

/** 0..1: the destination marker's presence, and seconds since the robot was sent there. */
export const uMarkerPresence = uniform(0);
export const uMarkerAge = uniform(0);

/**
 * Where the robot is headed: a ring that lands from wide to tight, its gaps turning slowly, around a dot. Drawn
 * in the title's red on the paper, it fades as soon as the robot arrives.
 */
export const markerMaterial = new MeshBasicNodeMaterial({ color: THEME_RED, depthWrite: false, transparent: true });
const point = uv().sub(0.5).mul(2);
const radius = point.length();
const landed = float(1).sub(uMarkerAge.mul(-8).exp());
const ring = smoothstep(0.09, 0.05, radius.sub(mix(0.95, 0.46, landed)).abs());
const gaps = threshold(
  0.22,
  fract(
    atan(point.y, point.x)
      .div(Math.PI * 2)
      .mul(4)
      .sub(uMarkerAge.mul(0.3)),
  ),
);
const centre = smoothstep(0.12, 0.07, radius);
markerMaterial.opacityNode = ring.mul(gaps).add(centre).mul(uMarkerPresence);

// Height encodes lifetime, so all particles share one material and fade without re-shaping their text.
export const dust = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  material.name = 'robot-glyph-dust';
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage.mul(
    smoothstep(BASE_Z + RISE * 0.15, BASE_Z + RISE, positionWorld.z)
      .oneMinus()
      .mul(0.65),
  );

  return material;
});
