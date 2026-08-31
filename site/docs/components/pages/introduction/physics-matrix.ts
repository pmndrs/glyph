import { worldToLocalMatrix } from '@pmndrs/glyph/three';
import { Matrix4 } from 'three';

/** Capture the fixed transform from a Box3D body origin to one rendered glyph. */
export function bindBodyToGlyph(initialBodyWorld: Matrix4, glyphWorld: Matrix4, target: Matrix4): Matrix4 {
  return target.copy(initialBodyWorld).invert().multiply(glyphWorld);
}

/** Convert a current Box3D world transform into the detached Glyphs root's local instance matrix. */
export function bodyWorldToGlyphLocal(
  rootWorldInverse: Matrix4,
  bodyWorld: Matrix4,
  bodyToGlyph: Matrix4,
  target: Matrix4,
): Matrix4 {
  target.multiplyMatrices(bodyWorld, bodyToGlyph);
  return worldToLocalMatrix(rootWorldInverse, target, target);
}
