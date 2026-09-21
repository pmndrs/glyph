import {
  abs,
  color,
  exp,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  screenCoordinate,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import { AdditiveBlending, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { THEME_RED } from '../letters/content';
import { BUTTON_HEIGHT, BUTTON_RADIUS, BUTTON_WIDTH, FRAME_MARGIN, LABEL, SEGMENTS, type Segment } from './content';

/** 0..1: how far the module has powered up. */
export const uPlayReveal = uniform(0);
/** 0..1: the pointer resting on the button, smoothed. */
export const uPlayHover = uniform(0);

/** Signed distance to a rounded box of the given half size, negative inside. */
function roundedBox(point: Node<'vec2'>, halfWidth: number, halfHeight: number, corner: number): Node<'float'> {
  const q = abs(point).sub(vec2(halfWidth - corner, halfHeight - corner));

  return length(max(q, 0))
    .add(min(max(q.x, q.y), 0))
    .sub(corner);
}

/** 1 inside a distance field, antialiased over a pixel at its edge. */
function inside(distance: Node<'float'>): Node<'float'> {
  const width = fwidth(distance);

  return smoothstep(width, width.negate(), distance);
}

/**
 * Signed distances to the eleven segments of one display cell, in display units: the cell is 0.4 wide and 0.7
 * tall, centred on the origin, and leans to the right. The outer seven are cut from a hollow box by diagonals
 * through its corners, each pushed out by the gap; the middle bar and the four diagonals are bands of the same
 * thickness cut the same way, in frames shifted and turned to lie across the halves.
 */
function segments(point: Node<'vec2'>): Record<Segment, Node<'float'>> {
  const [halfWidth, halfHeight] = [0.2, 0.35];
  const thickness = 0.085;
  const gap = 0.025;
  const cell = vec2(point.x.sub(point.y.mul(0.18)), point.y);
  const hollow = roundedBox(cell, halfWidth - thickness, halfHeight - thickness, 0).negate();
  const bounds = roundedBox(cell, halfWidth, halfHeight, halfWidth * 0.4);
  // The diagonals through each corner: zero on the line, and either side of it in between.
  const corners = (q: Node<'vec2'>) => ({
    topRight: q.x.sub(q.y).sub(halfWidth).add(halfHeight),
    topLeft: q.x.add(q.y).add(halfWidth).sub(halfHeight),
    bottomLeft: q.x.sub(q.y).add(halfWidth).sub(halfHeight),
    bottomRight: q.x.add(q.y).sub(halfWidth).add(halfHeight),
  });
  // A band along the frame's x axis, pointed at both ends by the four corner diagonals.
  const bar = (q: Node<'vec2'>): Node<'float'> => {
    const to = corners(q);

    return abs(q.y)
      .mul(2)
      .sub(thickness)
      .max(to.bottomLeft.add(gap))
      .max(to.topRight.negate().add(gap))
      .max(to.topLeft.add(gap))
      .max(to.bottomRight.negate().add(gap));
  };
  // The frame of one diagonal: squeezed towards the middle, slid into its quarter, and turned by an eighth.
  const diagonal = (right: boolean, lower: boolean): Node<'vec2'> => {
    const q = vec2(cell.x.mul(1.9).add(right ? -0.1 : 0.1), cell.y.mul(lower ? -0.95 : 0.95).sub(0.15));
    const angle = right ? -Math.PI / 4 : Math.PI / 4;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];

    return vec2(q.x.mul(cos).sub(q.y.mul(sin)), q.x.mul(sin).add(q.y.mul(cos)));
  };
  const to = corners(cell);
  const middle = (halfWidth + thickness) / 2;
  const rise = cell.x.sub(cell.y);
  const fall = cell.x.add(cell.y);
  const outer = {
    A: hollow.max(to.topRight.add(gap)).max(to.topLeft.negate().add(gap)),
    B: hollow.max(to.topRight.negate().add(gap)).max(to.topLeft.negate().add(gap)).max(rise.sub(middle)),
    C: hollow.max(to.bottomLeft.negate().add(gap)).max(to.bottomRight.negate().add(gap)).max(fall.sub(middle)),
    D: hollow.max(to.bottomLeft.negate().add(gap)).max(to.bottomRight.add(gap)),
    E: hollow.max(to.bottomLeft.add(gap)).max(to.bottomRight.add(gap)).max(rise.negate().sub(middle)),
    F: hollow.max(to.topRight.add(gap)).max(to.topLeft.add(gap)).max(fall.negate().sub(middle)),
    G: bar(cell),
    H: bar(diagonal(false, false)),
    I: bar(diagonal(true, false)),
    J: bar(diagonal(false, true)),
    K: bar(diagonal(true, true)),
  };

  return Object.fromEntries(SEGMENTS.map((name) => [name, outer[name].max(bounds)])) as Record<Segment, Node<'float'>>;
}

/** Distances to the label's lit segments and to every segment of every cell, in display units. */
function display(point: Node<'vec2'>): { lit: Node<'float'>; all: Node<'float'> } {
  // Display units to sheet units, narrower across so the cells stand tall, and the cell pitch.
  const scale = vec2(0.34, 0.4);
  const pitch = 0.6;
  let lit: Node<'float'> = float(1e6);
  let all: Node<'float'> = float(1e6);

  LABEL.forEach((letter, index) => {
    const centre = (index - (LABEL.length - 1) / 2) * pitch;
    const cell = segments(point.div(scale).sub(vec2(centre, 0)));

    for (const name of SEGMENTS) {
      all = all.min(cell[name]);

      if (letter.includes(name)) lit = lit.min(cell[name]);
    }
  });

  return { lit, all };
}

/**
 * A black metal module with a recessed screen, lit from above, reading the label on a segment display in the
 * title's red over the faint ghosts of every segment. Powering up, it fades in, lights every segment in a
 * self-test, then settles on the label; the pointer brightens the segments and their glow.
 */
export function createPlayModuleMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  material.name = 'play-module';
  const point = uv()
    .sub(0.5)
    .mul(vec2(BUTTON_WIDTH + 2 * FRAME_MARGIN, BUTTON_HEIGHT + 2 * FRAME_MARGIN));
  const bezel = 0.045;
  const body = roundedBox(point, BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2, BUTTON_RADIUS);
  const screen = roundedBox(point, BUTTON_WIDTH / 2 - bezel, BUTTON_HEIGHT / 2 - bezel, 0.02);
  // 0 at the bottom edge, 1 at the top: the module is lit from above.
  const light = smoothstep(-BUTTON_HEIGHT / 2, BUTTON_HEIGHT / 2, point.y);
  const metal = mix(color('#15161a'), color('#2b2e35'), light).add(
    inside(abs(body).sub(0.004)).mul(mix(0.12, 0.42, light)),
  );
  // The recess: a shadow under the screen's top edge, a sliver of light along its bottom edge.
  const lip = exp(screen.mul(45));
  const glass = color('#0b0c10')
    .mul(float(1).sub(lip.mul(light).mul(0.9)))
    .add(color('#2a2c33').mul(lip).mul(float(1).sub(light)).mul(0.45));
  const { lit, all } = display(point);
  const powered = smoothstep(0, 0.18, uPlayReveal);
  const selfTest = smoothstep(0.2, 0.27, uPlayReveal).mul(smoothstep(0.6, 0.53, uPlayReveal));
  const label = smoothstep(0.62, 0.72, uPlayReveal);
  const on = inside(all).mul(selfTest).max(inside(lit).mul(label));
  const glow = exp(all.max(0).mul(-55))
    .mul(selfTest)
    .max(exp(lit.max(0).mul(-55)).mul(label))
    .mul(float(0.32).add(uPlayHover.mul(0.28)));
  const ghost = inside(all).mul(float(0.07).add(uPlayHover.mul(0.04)));
  const red = color(THEME_RED);
  const core = mix(red, color('#ffffff'), float(0.18).add(uPlayHover.mul(0.14)));
  // Faint scanlines over the screen, three device pixels apart.
  const scan = mix(0.86, 1, step(0.33, fract(screenCoordinate.y.div(3))));
  const face = glass
    .add(red.mul(ghost.add(glow)))
    .add(core.mul(on))
    .mul(scan);
  // Screen light leaking onto the black around the module, gone well before the plane's square edge.
  const spill = red
    .mul(exp(body.max(0).mul(-40)))
    .mul(step(0, body))
    .mul(smoothstep(FRAME_MARGIN, FRAME_MARGIN * 0.4, body))
    .mul(selfTest.max(label))
    .mul(float(0.035).add(uPlayHover.mul(0.03)));
  material.colorNode = mix(metal, face, inside(screen)).mul(inside(body)).add(spill).mul(powered);
  material.toneMapped = false;

  return material;
}

/** Lay the button's sheet over the finished frame. Its sheet is black where the button is not drawn. */
export function composePlayButton(finished: Node<'vec4'>, sheet: Node<'vec4'>): Node<'vec4'> {
  return vec4(finished.rgb.add(sheet.rgb), 1);
}
