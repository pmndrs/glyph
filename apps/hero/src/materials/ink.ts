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
  fract,
  mix,
  mx_noise_float,
  normalize,
  positionView,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import {
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type MeshPhysicalNodeMaterialParameters,
  Vector2,
  Vector3,
  type Node,
} from 'three/webgpu';

import { uCut, uFloat, uTime } from '../uniforms';
import { brand } from '../theme';

type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** How strongly each glyph quad bulges as a lens. */
const LENS_CURVATURE = 0.45;
const RIM = color('#7cc8ff');
const SWEEP = color('#ff5ad2');
const GLITCH_A = color('#00f0ff');
const GLITCH_B = color('#ff2e6e');

/** Lit Slug ink for every word: a standard material, since there are many words and only one glass title. */
export const ink = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.32, metalness: 0.2 });
  const normal = shapeSlug(material, context);
  const band = smoothstep(0.08, 0, abs(fract(positionWorld.x.mul(0.06).sub(uTime.mul(0.18))).sub(0.5)));
  material.colorNode = context.shader.color;
  material.emissiveNode = RIM.mul(rim(normal).mul(0.8))
    .add(SWEEP.mul(band.mul(0.25)))
    .add(glitch());
  return material;
});

/**
 * Glass Slug letters: physical transmission refracts the scene behind them, with dispersion splitting the light.
 * Smooth lens normals keep the faces continuous while bending the background icons.
 */
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
    // Each Slug glyph is drawn on a unit quad, so its uv is a per-letter lens: tilting the normal outward from the
    // centre curves the refraction, and the icons behind magnify and bend as they cross each letterform.
    const face = shapeSlug(material, context, { drift: false });
    if (motion !== undefined) {
      material.positionNode = jostle(context.position, motion).sub(titleOrigin).mul(motion.scale).add(titleOrigin);
    }
    const lens = uv().sub(0.5).mul(2);
    // Falls to zero at the quad border, so neighbouring glyph quads do not show their seams.
    const falloff = float(1).sub(lens.length().mul(lens.length())).max(0).mul(LENS_CURVATURE);
    const normal = normalize(face.add(vec3(lens.x.mul(falloff), lens.y.negate().mul(falloff), 0)));
    material.normalNode = normal;
    material.emissiveNode = RIM.mul(rim(normal).mul(0.35));
    return material;
  });
}

export const glass = createGlass();

/** Origin of the centred paragraph in its local layout coordinates. */
export const titleOrigin = uniform(new Vector3());

interface PaneMotion {
  readonly scale: Node<'float'>;
  readonly height: Node<'float'>;
  readonly angle: Node<'float'>;
  readonly sway: Node<'float'>;
  readonly pivot: Node<'vec3'>;
  /** Where the floor's physics has pushed the pane from its rest place, and how far it has turned about its centre. */
  readonly shove: Node<'vec2'>;
  readonly turn: Node<'float'>;
}

/** Rotate each pane around its measured ink centre, then slide it: a little as it settles, further when shoved. */
function jostle(position: Node<'vec3'>, motion: PaneMotion): Node<'vec3'> {
  const local = position.sub(motion.pivot);
  const angle = motion.angle.add(motion.turn);
  const c = cos(angle);
  const s = sin(angle);
  return vec3(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)), local.z)
    .add(motion.pivot)
    .add(vec3(motion.sway.add(motion.shove.x), motion.shove.y, 0));
}

/** Separate inline materials preserve one shaped word while giving each pane its own tint and finish. */
export const stainedGlassLetters = [
  { letter: 'G', tint: brand.red, thickness: 2.8, roughness: 0.035, ior: 1.52 },
  { letter: 'l', tint: brand.orange, thickness: 2.4, roughness: 0.06, ior: 1.5 },
  { letter: 'y', tint: brand.teal, thickness: 3, roughness: 0.045, ior: 1.54 },
  { letter: 'p', tint: brand.blue, thickness: 2.6, roughness: 0.025, ior: 1.56 },
  { letter: 'h', tint: brand.purple, thickness: 2.9, roughness: 0.05, ior: 1.53 },
].map(({ letter, tint, thickness, roughness, ior }) => {
  const motion = {
    scale: uniform(1),
    height: uniform(0),
    angle: uniform(0),
    sway: uniform(0),
    pivot: uniform(new Vector3()),
    shove: uniform(new Vector2()),
    turn: uniform(0),
  };
  return {
    letter,
    ...motion,
    material: createGlass(
      {
        name: `stained-glass-${letter}`,
        color: new Color(tint).lerp(new Color('#ffffff'), 0.38),
        attenuationColor: new Color(tint),
        attenuationDistance: 4,
        thickness,
        roughness,
        ior,
        dispersion: 0.7,
        iridescence: 0,
      },
      motion,
    ),
  };
});

export type StainedGlassLetter = (typeof stainedGlassLetters)[number];

/** Flat, unlit ink for the background pattern: crisp coverage, no lighting cost across hundreds of icons. */
export const pattern = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  // Opaque, with alpha-to-coverage edges: the icons must write depth, or the glass has nothing behind it to refract.
  // Depth in the field is carried by colour, not by fading them out.
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage;
  material.alphaToCoverage = true;
  return material;
});

/** Marks the rim twin's meshes; post-processing moves them onto the rim layer, out of the main camera's view. */
export const RIM_SILHOUETTE = 'glyph-hero-rim-silhouette';

/**
 * A flat stand-in for the glass title on the rim layer. Rendering the glass itself there would make three redraw the
 * whole opaque scene into a transmission buffer for that pass; this is five coverage-cut quads instead.
 */
export const silhouette = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.name = RIM_SILHOUETTE;
  material.positionNode = context.position.add(drift(context.position).mul(uFloat));
  material.colorNode = color('#000000');
  material.opacityNode = context.shader.coverage;
  material.alphaToCoverage = true;
  return material;
});

/** Idle drift, shared so the rim twin moves exactly with the glass it stands in for. */
function drift(position: Node<'vec3'>): Node<'vec3'> {
  return vec3(
    sin(uTime.mul(0.9).add(position.y.mul(0.8))).mul(0.05),
    sin(uTime.mul(1.3).add(position.x.mul(1.1))).mul(0.07),
    sin(uTime.mul(0.7).add(position.x.mul(0.5)).add(position.y.mul(0.9))).mul(0.12),
  );
}

/**
 * Shared Slug plumbing: drives position from the glyph graph (Slug coverage requires it), adds the idle drift,
 * cuts the letterform out with alpha-to-coverage so depth stays exact, and casts letter-shaped shadows. Returns the
 * face normal from screen-space derivatives, which follows a glyph's real orientation even while physics tumbles
 * it (its rotation lives in the glyph transform, not the object's normal matrix).
 */
function shapeSlug(
  material: MeshStandardNodeMaterial,
  { shader, position }: SlugContext,
  options: { readonly drift: boolean } = { drift: true },
) {
  material.positionNode = options.drift ? position.add(drift(position).mul(uFloat)) : position;
  material.opacityNode = shader.coverage.mul(shader.opacity);
  material.alphaToCoverage = true;
  material.maskShadowNode = shader.coverage.greaterThan(0.5);

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

function glitch() {
  const noise = mx_noise_float(positionWorld.mul(vec3(0.5, 9, 0.5)).add(vec3(0, uTime.mul(14), 0)));
  const mask = step(float(1).sub(uCut.mul(0.9)), noise.mul(0.5).add(0.5)).mul(uCut);
  return mix(GLITCH_A, GLITCH_B, noise.mul(0.5).add(0.5)).mul(mask.mul(2.5));
}
