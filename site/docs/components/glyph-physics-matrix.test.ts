import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

import { bindBodyToGlyph, bodyWorldToGlyphLocal } from './glyph-physics-matrix';

function expectMatrixClose(actual: Matrix4, expected: Matrix4) {
  expect(actual.elements).toHaveLength(expected.elements.length);
  for (const [index, value] of actual.elements.entries()) {
    expect(value).toBeCloseTo(expected.elements[index]!, 6);
  }
}

describe('Box3D to detached Glyphs matrix mapping', () => {
  it('reproduces the exact captured local matrix before the body moves', () => {
    const rootWorld = new Matrix4().compose(
      new Vector3(2, -1, 0.5),
      new Quaternion().setFromEuler(new Euler(0.1, -0.2, 0.3)),
      new Vector3(1.25, 0.8, 1),
    );
    const originalLocal = new Matrix4().compose(
      new Vector3(-0.7, 0.4, 0),
      new Quaternion().setFromEuler(new Euler(0, 0, -0.15)),
      new Vector3(1, 1, 1),
    );
    const glyphWorld = rootWorld.clone().multiply(originalLocal);
    const initialBodyWorld = new Matrix4().compose(
      new Vector3(1.4, -0.2, 0.5),
      new Quaternion().setFromEuler(new Euler(0.1, -0.2, 0.3)),
      new Vector3(1, 1, 1),
    );
    const bodyToGlyph = bindBodyToGlyph(initialBodyWorld, glyphWorld, new Matrix4());
    const resolved = bodyWorldToGlyphLocal(rootWorld.clone().invert(), initialBodyWorld, bodyToGlyph, new Matrix4());

    expectMatrixClose(resolved, originalLocal);
  });
});
