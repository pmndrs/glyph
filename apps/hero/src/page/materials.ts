import { defineTextMaterial, type ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import {
  Loop,
  float,
  mix,
  modelWorldMatrix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  uniform,
  uniformArray,
  vec3,
  vec4,
  Fn,
} from 'three/tsl';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { cameraUniforms } from '../camera/materials';
import { CARET_COLOR, caretLight, paragraphRipple, worldRipple } from '../editor/materials';
import { stoneLight, stoneRedshift } from '../stone/materials';
import { retained } from '../utils';
import { BODY_BOX, PAGE } from './content';

/** Gutters the page may show at once. */
const RULES = 5;

export const pageUniforms = retained('page', () => ({
  /** 0..1: the room's light. */
  uLight: uniform(0),
  /** 0..1: how much of the ink has arrived, top to bottom. */
  uInk: uniform(0),
  uTime: uniform(0),
  /** The film grain's clock. */
  uGrain: uniform(0),
  /** World x of each column rule. Unused slots sit far off the page. */
  uRules: uniformArray<'float'>(new Array<number>(RULES).fill(1e6), 'float'),
  /** World x of the body's right edge. */
  uBodyRight: uniform(0),
}));

const { uLight, uInk, uRules, uBodyRight } = pageUniforms;

/** The light on a point of the page: the room, the caret, and the stone's disk, all dimmed as the dive closes in. */
export function pageLight(world: Node<'vec2'>): Node<'vec3'> {
  const room = vec3(1, 0.975, 0.93).mul(uLight);
  const caret = vec3(...CARET_COLOR)
    .mul(caretLight(world))
    .mul(2.6);
  const dive = float(1).sub(smoothstep(0.35, 0.8, cameraUniforms.uDive).mul(0.94));

  return room.add(caret).add(stoneLight(world)).mul(dive);
}

/** How much of the ink has arrived at a height of the world: a front that runs down the page, a little ragged. */
function arrived(world: Node<'vec2'>): Node<'float'> {
  const top = PAGE.height / 2;
  const front = uInk.mul(PAGE.height + 6);
  const depth = float(top)
    .sub(world.y)
    .add(mx_noise_float(vec3(world.x.mul(0.35), world.y.mul(0.35), 3)).mul(1.4));

  return float(1).sub(smoothstep(front.sub(4.5), front, depth));
}

type SlugContext = Extract<ThreeTextMaterialContext, { format: 'pmndrs.slug' }>;

/** Ink lit by the page's lights, reddened and heated near the stone, washed in by the ink front. */
function ink(context: SlugContext, pulse: (world: Node<'vec2'>) => Node<'float'>): MeshBasicNodeMaterial {
  const world = modelWorldMatrix.mul(vec4(context.position, 1)).xy;
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    forceSinglePass: true,
  });
  const wave = pulse(world);
  // The edited line lifts as the ripple passes. The bounds are padded for it.
  material.positionNode = context.position.add(vec3(0, wave.mul(0.07), 0));
  const shift = stoneRedshift(world);
  const lit = context.shader.color.mul(pageLight(world));
  const hot = mix(lit, lit.mul(vec3(2.4, 0.62, 0.22)), shift);
  material.colorNode = hot.add(
    vec3(...CARET_COLOR)
      .mul(wave)
      .mul(1.6),
  );
  material.opacityNode = context.shader.opacity.mul(arrived(world));
  material.toneMapped = false;

  return material;
}

/** Every text of the spread but the body and the headline. Its ripple is told in the world's frame. */
export const inkMaterial = defineTextMaterial(
  (context) =>
    context.kind === 'glyph' && context.format === 'pmndrs.slug'
      ? ink(context, worldRipple)
      : context.createDefaultMaterial(),
  { boundsPadding: 0.1 },
);

/**
 * The body. Its ripple runs along `paragraphPosition`, the paragraph's own frame, so it follows the edited line
 * wherever the body is placed. Only the paragraph drawn whole has that frame current: letters drawn one by one
 * carry the place they were split from, and nothing is typed into those.
 */
export const bodyMaterial = defineTextMaterial(
  (context) =>
    context.kind === 'glyph' && context.format === 'pmndrs.slug'
      ? ink(context, () => paragraphRipple(context.paragraphPosition.xy))
      : context.createDefaultMaterial(),
  { boundsPadding: 0.1 },
);

/**
 * The page: dark stock under the room's light, the caret's pool, the stone's glow, a fine tooth, and a hairline
 * rule down each gutter. Outside the sheet there is only the dark.
 */
export function createPaperMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const world = positionWorld.xy;
  const sheet = smoothstep(0, 0.06, float(PAGE.width / 2).sub(world.x.abs())).mul(
    smoothstep(0, 0.06, float(PAGE.height / 2).sub(world.y.abs())),
  );
  const tooth = mx_noise_float(vec3(world.mul(46), 1))
    .mul(0.5)
    .add(mx_noise_float(vec3(world.mul(7), 5)).mul(0.5));
  const stock = vec3(0.0135, 0.013, 0.0155).mul(tooth.mul(0.3).add(1));
  const rule = Fn(() => {
    const line = float(0).toVar();

    Loop(RULES, ({ i }) => {
      line.assign(line.max(float(1).sub(smoothstep(0.008, 0.022, world.x.sub(uRules.element(i)).abs()))));
    });

    return line;
  })();
  const top = PAGE.height / 2 - BODY_BOX.top;
  const bottom = PAGE.height / 2 - BODY_BOX.bottom;
  const inBody = smoothstep(bottom - 0.1, bottom + 0.4, world.y).mul(smoothstep(top + 0.1, top - 0.4, world.y));
  // The body's right edge is a rule too, fainter: it is what a hand takes hold of to narrow the page.
  const edge = float(1)
    .sub(smoothstep(0.008, 0.022, world.x.sub(uBodyRight).sub(0.45).abs()))
    .mul(0.45);
  const light = pageLight(world);
  const paper = stock.mul(mix(float(0.3), float(1), sheet)).mul(light.mul(0.95).add(vec3(0.003)));
  const rules = vec3(0.92, 0.88, 0.8).mul(rule.max(edge)).mul(inBody).mul(uInk).mul(light).mul(0.22);
  material.colorNode = paper.add(rules.mul(sheet));
  material.toneMapped = false;

  return material;
}
