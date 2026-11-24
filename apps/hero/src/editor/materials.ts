import { float, uniform, uv, vec2, vec3 } from 'three/tsl';
import { AdditiveBlending, MeshBasicNodeMaterial, Vector2, Vector3, type Node } from 'three/webgpu';
import { retained } from '../utils';

/**
 * The caret is a light. Its place and height in the world and how lit it is this frame reach every text shader,
 * and so does the last edit, for the ripple that runs out along the edited line.
 */
export const editorUniforms = retained('editor', () => ({
  /** World x and y of the caret's middle, and its height. */
  uCaret: uniform(new Vector3(0, 0, 1)),
  uCaretLit: uniform(0),
  /** The last edit: its place in the world and in the body's paragraph space, its line's height, its age. */
  uEdit: uniform(new Vector2()),
  uEditParagraph: uniform(new Vector2()),
  uEditHeight: uniform(1),
  uEditAge: uniform(100),
}));

const { uCaret, uCaretLit, uEdit, uEditParagraph, uEditHeight, uEditAge } = editorUniforms;

/** The caret's colour: a tungsten bar. */
export const CARET_COLOR = [1, 0.74, 0.42] as const;

/**
 * How much of the caret's light reaches a point of the world. Its reach grows with the caret, but slowly: the
 * headline's caret is ten times the body's and lights a pool only twice as wide.
 */
export function caretLight(world: Node<'vec2'>): Node<'float'> {
  const reach = uCaret.z.mul(0.34).add(0.85);
  const away = world.sub(uCaret.xy).mul(vec2(1, 0.72)).length().div(reach);

  return uCaretLit.div(away.mul(away).mul(1.3).add(1)).mul(away.mul(-0.5).exp());
}

/**
 * The ripple of the last edit at a point: a pulse that leaves the caret and runs out along its line, fading as it
 * goes. `along` and `across` are the point's distance from the edit along the line and across it.
 */
function ripple(along: Node<'float'>, across: Node<'float'>): Node<'float'> {
  const front = uEditAge.mul(11);
  const pulse = along.sub(front).div(0.9);
  const onLine = float(1)
    .sub(across.abs().div(uEditHeight.mul(0.62)).clamp())
    .ceil();

  return pulse.mul(pulse).negate().exp().mul(uEditAge.mul(-1.5).exp()).mul(onLine);
}

/** The ripple for a text in the world's own frame, and for the body in its paragraph's (x right, y up). */
export function worldRipple(world: Node<'vec2'>): Node<'float'> {
  return ripple(world.x.sub(uEdit.x).abs(), world.y.sub(uEdit.y));
}

export function paragraphRipple(paragraph: Node<'vec2'>): Node<'float'> {
  return ripple(paragraph.x.sub(uEditParagraph.x).abs(), paragraph.y.add(uEditParagraph.y));
}

/** The bar itself: a soft-ended stroke brighter than white, so it blooms. */
export function createCaretMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const across = uv().x.sub(0.5).abs().mul(2);
  const ends = uv().y.sub(0.5).abs().mul(2);
  const bar = float(1)
    .sub(across.pow(3))
    .mul(float(1).sub(ends.pow(8)));
  material.colorNode = vec3(...CARET_COLOR)
    .mul(bar)
    .mul(uCaretLit.mul(5.5));
  material.toneMapped = false;

  return material;
}
