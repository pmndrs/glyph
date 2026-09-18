import { defineTextMaterial, type ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import {
  abs,
  color,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  normalize,
  positionView,
  pow,
  sin,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import {
  Color,
  DoubleSide,
  MeshPhysicalNodeMaterial,
  type MeshPhysicalNodeMaterialParameters,
  Vector3,
  type Node,
} from 'three/webgpu';

import { holeWarp } from '../sequence/warp';
type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** Physical transmission and smooth lens normals refract the background through each letter. */
function createGlass(properties: MeshPhysicalNodeMaterialParameters = {}, motion?: PaneMotion) {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
    const material = new MeshPhysicalNodeMaterial({
      side: DoubleSide,
      // A very faint smoky tint: the pattern reads through the letters, bent rather than dimmed.
      color: new Color('#f1f3f6'),
      metalness: 0,
      roughness: 0.03,
      transmission: 1,
      thickness: 2.6,
      ior: 1.6,
      dispersion: 3,
      attenuationColor: new Color('#b9c0c9'),
      attenuationDistance: 14,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      iridescence: 0.15,
      iridescenceIOR: 1.3,
      specularIntensity: 1,
      ...properties,
    });
    // Per-glyph UVs curve the face normal outward to form a lens.
    const face = shapeSlug(material, context);
    if (motion !== undefined) {
      material.positionNode = jostle(context.position, motion).sub(titleOrigin).mul(motion.scale).add(titleOrigin);
    }
    const lens = uv().sub(0.5).mul(2);
    // Falls to zero at the quad border, so neighbouring glyph quads do not show their seams.
    const falloff = float(1).sub(lens.length().mul(lens.length())).max(0).mul(0.45);
    const normal = normalize(face.add(vec3(lens.x.mul(falloff), lens.y.negate().mul(falloff), 0)));
    material.normalNode = normal;
    material.emissiveNode = color('#7cc8ff').mul(rim(normal).mul(0.35));
    return material;
  });
}

/** Origin of the centred paragraph in its local layout coordinates. */
export const titleOrigin = uniform(new Vector3());

interface PaneMotion {
  readonly scale: Node<'float'>;
  readonly height: Node<'float'>;
  readonly angle: Node<'float'>;
  readonly sway: Node<'float'>;
  readonly pivot: Node<'vec3'>;
}

/** Rotate each pane around its measured ink centre, then slide it a little as it settles. */
function jostle(position: Node<'vec3'>, motion: PaneMotion): Node<'vec3'> {
  const local = position.sub(motion.pivot);
  const c = cos(motion.angle);
  const s = sin(motion.angle);
  return vec3(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)), local.z)
    .add(motion.pivot)
    .add(vec3(motion.sway, 0, 0));
}

/** Separate inline materials preserve one shaped word while giving each pane its own tint and finish. */
export const stainedGlassLetters = [
  { letter: 'G', tint: '#ff4980', thickness: 2.8, roughness: 0.035, ior: 1.52 },
  { letter: 'l', tint: '#ffc043', thickness: 2.4, roughness: 0.06, ior: 1.5 },
  { letter: 'y', tint: '#00f7a3', thickness: 3, roughness: 0.045, ior: 1.54 },
  { letter: 'p', tint: '#2bdcf6', thickness: 2.6, roughness: 0.025, ior: 1.56 },
  { letter: 'h', tint: '#d855f9', thickness: 2.9, roughness: 0.05, ior: 1.53 },
].map(({ letter, tint, thickness, roughness, ior }) => {
  const motion = {
    scale: uniform(1),
    height: uniform(0),
    angle: uniform(0),
    sway: uniform(0),
    pivot: uniform(new Vector3()),
  };
  const properties = {
    name: `stained-glass-${letter}`,
    color: new Color(tint).lerp(new Color('#ffffff'), 0.38),
    attenuationColor: new Color(tint),
    attenuationDistance: 4,
    thickness,
    roughness,
    ior,
    dispersion: 0.7,
    iridescence: 0,
  };
  return {
    letter,
    ...motion,
    material: createGlass(properties, motion),
  };
});

/** Use analytic coverage for edges and shadows. Screen derivatives recover each transformed glyph face normal. */
function shapeSlug(material: MeshPhysicalNodeMaterial, context: SlugContext) {
  material.positionNode = context.position;
  // The black hole bends the letterform itself: coverage is integrated where each fragment's ink came from.
  // Not `shader.opacity`: that carries its own integral, and the hero's Slug paint is opaque anyway.
  const warp = holeWarp(context);
  material.opacityNode = warp.coverage.mul(warp.survive);
  material.alphaToCoverage = true;
  material.maskShadowNode = warp.coverage.greaterThan(0.5);

  const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
  const normal = face.mul(dot(face, toCamera()).sign());
  material.normalNode = normal;
  return normal;
}

function toCamera() {
  return normalize(positionView.negate());
}

function rim(normal: Node<'vec3'>) {
  return pow(float(1).sub(abs(dot(normal, toCamera()))), 2.5);
}
