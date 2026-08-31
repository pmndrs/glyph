import type { GlyphKey, Glyphs, ThreeGlyphMeasurement } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
  captureGlyphOrigins,
  captureGlyphOriginsForPresentation,
  createGlyphOriginTransition,
  glyphOriginPolicy,
  type ShapedTextIdentity,
  type TransitionableText,
} from './glyph-origin-transition';

const key = 'font:glyph:cluster:0' as GlyphKey;

describe('detached glyph-origin transitions', () => {
  it('transitions geometry-only reflows and snaps reshapes', () => {
    const current: ShapedTextIdentity = {
      fontFixture: 'inter',
      text: 'glyph',
      language: 'en',
      direction: 'ltr',
      features: [{ tag: 'kern', value: 1 }],
    };
    expect(glyphOriginPolicy(current, { ...current })).toBe('transition');
    expect(glyphOriginPolicy(current, { ...current }, false)).toBe('snap');
    expect(glyphOriginPolicy(current, { ...current, text: 'glyphs' })).toBe('snap');
    expect(glyphOriginPolicy(current, { ...current, direction: 'rtl' })).toBe('snap');
    expect(glyphOriginPolicy(current, { ...current, features: [] })).toBe('snap');
  });

  it('refreshes the source world matrix once before composing caller-owned glyph matrices', () => {
    const original = new THREE.Matrix4().makeTranslation(3, 4, 5);
    const matrixWorld = new THREE.Matrix4();
    let worldUpdates = 0;
    const text = {
      parent: new THREE.Group(),
      matrixWorld,
      visible: true,
      updateWorldMatrix: () => {
        worldUpdates += 1;
        matrixWorld.makeTranslation(10, 20, 30);
      },
      measureGlyphs: () => [measurement(original)],
      breakApart: () => {
        throw new Error('not used');
      },
    } satisfies TransitionableText;
    const captured = captureGlyphOrigins(text);
    expect(worldUpdates).toBe(1);
    expect(captured?.[0]?.worldMatrix).not.toBe(original);
    original.makeTranslation(9, 9, 9);
    expect(new THREE.Vector3().setFromMatrixPosition(captured![0]!.worldMatrix)).toEqual(new THREE.Vector3(13, 24, 35));
  });

  it('does not measure or copy origins when presentation animation is disabled', () => {
    const identity: ShapedTextIdentity = {
      fontFixture: 'inter',
      text: 'glyph',
      language: 'en',
      direction: 'ltr',
      features: [],
    };
    let measurements = 0;
    const text = {
      parent: new THREE.Group(),
      matrixWorld: new THREE.Matrix4(),
      visible: true,
      updateWorldMatrix: () => undefined,
      measureGlyphs: () => {
        measurements += 1;
        return [measurement(new THREE.Matrix4())];
      },
      breakApart: () => {
        throw new Error('not used');
      },
    } satisfies TransitionableText;

    expect(captureGlyphOriginsForPresentation(text, identity, identity, false)).toBeUndefined();
    expect(measurements).toBe(0);
    expect(captureGlyphOriginsForPresentation(text, identity, identity, true)).toHaveLength(1);
    expect(measurements).toBe(1);
  });

  it('interpolates full world transforms on Glyphs and restores source ownership on finish', () => {
    const parent = new THREE.Group();
    parent.position.set(3, -2, 1);
    parent.rotation.set(0, 0, 0.25);
    parent.scale.setScalar(1.5);
    parent.updateMatrixWorld(true);
    const targetLocal = new THREE.Matrix4().compose(
      new THREE.Vector3(10, 6, -2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.6)),
      new THREE.Vector3(2, 3, 4),
    );
    const start = new THREE.Matrix4().compose(
      new THREE.Vector3(-4, 2, 8),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.1, 0.2)),
      new THREE.Vector3(0.5, 0.75, 1.25),
    );
    let written: THREE.Matrix4 | undefined;
    let disposed = 0;
    const detached = new THREE.Object3D() as unknown as Glyphs;
    detached.position.set(-5, 1, 2);
    detached.rotation.set(0.1, -0.2, 0.15);
    Object.defineProperties(detached, {
      count: { value: 1 },
      measurements: { value: [measurement(targetLocal)] },
      glyphAt: { value: () => ({ key }) },
      setMatrixAt: { value: (_index: number, matrix: THREE.Matrix4) => (written = matrix.clone()) },
      dispose: {
        value: () => {
          disposed += 1;
          detached.removeFromParent();
        },
      },
    });
    const text = {
      parent,
      matrixWorld: new THREE.Matrix4(),
      visible: true,
      updateWorldMatrix: () => undefined,
      measureGlyphs: () => [measurement(targetLocal)],
      breakApart: () => [detached, undefined] as const,
    } satisfies TransitionableText;

    const transition = createGlyphOriginTransition(text, [{ key, worldMatrix: start }]);
    expect(text.visible).toBe(false);
    expect(detached.parent).toBe(parent);
    expect(transition.matchedGlyphs).toBe(1);
    transition.setProgress(0.5);
    detached.updateWorldMatrix(true, false, true);
    const targetWorld = detached.matrixWorld.clone().multiply(targetLocal);
    const targetPosition = new THREE.Vector3();
    const targetQuaternion = new THREE.Quaternion();
    const targetScale = new THREE.Vector3();
    targetWorld.decompose(targetPosition, targetQuaternion, targetScale);
    const writtenWorld = detached.matrixWorld.clone().multiply(written!);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    writtenWorld.decompose(position, quaternion, scale);
    expect(position.distanceTo(startPosition(start).lerp(targetPosition, 0.5))).toBeLessThan(1e-5);
    expect(scale.distanceTo(matrixScale(start).lerp(targetScale, 0.5))).toBeLessThan(1e-5);
    expect(Math.abs(quaternion.length() - 1)).toBeLessThan(1e-6);

    transition.finish();
    expect(disposed).toBe(1);
    expect(detached.parent).toBeNull();
    expect(text.visible).toBe(true);
    expect(() => transition.setProgress(0.25)).toThrowError(DOMException);
  });
});

function measurement(matrix: THREE.Matrix4): ThreeGlyphMeasurement {
  return { key, originalMatrix: matrix } as ThreeGlyphMeasurement;
}

function startPosition(matrix: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

function matrixScale(matrix: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixScale(matrix);
}
