import { defineTextMaterial, type ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import {
  Fn,
  If,
  Loop,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  modelWorldMatrix,
  mx_noise_float,
  normalize,
  positionView,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Color, DoubleSide, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { CARET_COLOR, caretLight } from '../editor/materials';
import { pageLight } from '../page/materials';
import { retained } from '../utils';
import { HEADLINE_CAPACITY } from './traits';

export const titleUniforms = retained('title', () => ({
  /** Paragraph x of each character's leading edge, then of the line's end. */
  uEdges: uniformArray<'float'>(new Array<number>(HEADLINE_CAPACITY + 1).fill(1e6), 'float'),
  /** Seconds since each character arrived. Negative before it has. */
  uArrivals: uniformArray<'float'>(new Array<number>(HEADLINE_CAPACITY).fill(-1), 'float'),
}));

const { uEdges, uArrivals } = titleUniforms;

type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** How far either side of a fragment the bevel reads the outline, in em: the bevel is this wide. */
const BEVEL = 0.03;

/**
 * A typed letter. A character is drawn from the moment it arrives, and for its first second the ink is still wet:
 * the outline is read through a noise that wanders, so the letter lands as a blot and draws itself in to its true
 * edge. The outline is also read a little to each side, which gives the slope of its edge: `bevel` points out of
 * the letter across its edge, in the em's own axes, and is nothing in the letter's interior. `rim` is the edge that
 * faces the caret, which the caret lights.
 */
function typedInk(context: SlugContext) {
  // Seconds since the character under this fragment arrived, by the caret stops either side of it.
  const age = float(
    Fn(() => {
      const found = float(-1).toVar();
      const x = context.paragraphPosition.x;

      Loop(HEADLINE_CAPACITY, ({ i }) => {
        If(x.greaterThanEqual(uEdges.element(i)).and(x.lessThan(uEdges.element(i.add(1)))), () => {
          found.assign(uArrivals.element(i));
        });
      });

      return found;
    })(),
  );
  const wet = age.max(0).mul(-2.4).exp();
  const here = context.shader.renderCoordinate;
  const grain = here.mul(5.5);
  const reach = wet.mul(0.085);
  const em = here.add(
    vec2(mx_noise_float(vec3(grain.x, grain.y, 2)).mul(reach), mx_noise_float(vec3(grain.x, grain.y, 9)).mul(reach)),
  );
  const typed = age.greaterThanEqual(0).select(float(1), float(0));
  const coverage = context.shader.coverageAt(em).mul(typed);
  const right = context.shader.coverageAt(em.add(vec2(BEVEL, 0)));
  const left = context.shader.coverageAt(em.sub(vec2(BEVEL, 0)));
  const up = context.shader.coverageAt(em.add(vec2(0, BEVEL)));
  const down = context.shader.coverageAt(em.sub(vec2(0, BEVEL)));
  const bevel = vec2(left.sub(right), down.sub(up));
  const world = modelWorldMatrix.mul(vec4(context.position, 1)).xy;
  // Ink with no ink a little toward the caret: this fragment is on the edge that faces it.
  const rim = float(1).sub(right).mul(caretLight(world)).mul(3.4);

  return { coverage, wet, rim, world, bevel, em: here };
}

/**
 * The headline in glass. Each letter is a slab with a bevelled edge: its face is flat, so the page shows through
 * it clear, and across the bevel the normal leans out of the letter, so the edge refracts the page hard, catches
 * the studio, and splits a little into colour. The caret lights the edges that face it.
 */
export const glassHeadline = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  const material = new MeshPhysicalNodeMaterial({
    name: 'glass-headline',
    side: DoubleSide,
    // A letter is a flat pane: the back-face pass for double-sided transmission buys it nothing.
    forceSinglePass: true,
    color: new Color('#ffffff'),
    roughness: 0.06,
    transmission: 1,
    thickness: 1.5,
    ior: 1.5,
    dispersion: 1.4,
    attenuationColor: new Color('#f3e6cf'),
    attenuationDistance: 9,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const { coverage, wet, rim, world, bevel, em } = typedInk(context);
  material.positionNode = context.position;
  material.opacityNode = coverage;
  material.alphaToCoverage = true;
  // The em's own axes in view space, from screen derivatives: what one em to the right, and one em up, is here.
  const emX = dFdx(em);
  const emY = dFdy(em);
  const viewX = dFdx(positionView);
  const viewY = dFdy(positionView);
  const determinant = emX.x.mul(emY.y).sub(emY.x.mul(emX.y));
  const scale = float(1).div(determinant.abs().max(1e-9)).mul(determinant.sign());
  const alongX = normalize(viewX.mul(emY.y).sub(viewY.mul(emX.y)).mul(scale));
  const alongY = normalize(viewY.mul(emX.x).sub(viewX.mul(emY.x)).mul(scale));
  const toCamera = normalize(positionView.negate());
  const face = normalize(cross(viewX, viewY));
  const facing = face.mul(dot(face, toCamera).sign());
  const lean = alongX.mul(bevel.x).add(alongY.mul(bevel.y));
  const normal = normalize(facing.add(lean.mul(1.35)));
  material.normalNode = normal;
  const edge = bevel.length().clamp();
  const caret = vec3(...CARET_COLOR);
  // The glass holds a little of whatever light is on the page, most along its bevel, so it reads on a dark field.
  material.emissiveNode = caret
    .mul(rim.add(wet.mul(1.6)))
    .add(pageLight(world).mul(edge.mul(0.42).add(0.035)))
    .add(caret.mul(caretLight(world)).mul(edge.mul(0.9).add(0.12)));

  return material;
});

/** The headline as lit ink, for a tier without transmission: the same typing and blot, a lit bevel, and the rim. */
export const inkHeadline = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    forceSinglePass: true,
  });
  const { coverage, wet, rim, world, bevel } = typedInk(context);
  const caret = vec3(...CARET_COLOR);
  const edge = bevel.length().clamp();
  material.positionNode = context.position;
  material.colorNode = context.shader.color
    .mul(pageLight(world).mul(edge.mul(0.75).add(0.2)).add(0.02))
    .add(caret.mul(rim.add(wet.mul(1.6))))
    .add(caret.mul(caretLight(world)).mul(edge.mul(0.9).add(0.12)));
  material.opacityNode = coverage;
  material.toneMapped = false;

  return material;
});
