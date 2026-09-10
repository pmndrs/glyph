import { describe, expect, it } from 'vitest';

import { BOTTOM_Z, CARD_FACES, TOP_Z, createCycleState, damp, queueFlip, stepCycle, writeCardTransform } from './config';

const createTransform = () => ({ x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 });

describe('card cycle', () => {
  it('returns the flipped card behind the newly active front', () => {
    const state = createCycleState();
    queueFlip(state);
    stepCycle(state, 0.45);
    expect(state.flipping).toBe(true);
    stepCycle(state, 0.45);
    expect(state).toMatchObject({ top: 1, queued: 0, flipping: false, progress: 0 });

    const top = createTransform();
    const bottom = createTransform();
    writeCardTransform(top, 1, state.top, undefined);
    writeCardTransform(bottom, 0, state.top, undefined);
    expect(top.z).toBe(TOP_Z);
    expect(bottom.z).toBe(BOTTOM_Z);
  });

  it('shows the authored back face halfway through a visible three-axis arc', () => {
    const transform = createTransform();
    writeCardTransform(transform, 0, 0, 0.5);
    expect(transform.rotationY).toBeCloseTo(Math.PI);
    expect(transform.x).toBeGreaterThan(0.9);
    expect(transform.y).toBeGreaterThan(0.5);
    expect(transform.z).toBeGreaterThan(TOP_Z);
    expect(transform.rotationX).not.toBe(0);
    expect(transform.rotationZ).not.toBe(0);
  });

  it('uses baked private-use icon glyphs instead of text substitutes', () => {
    expect(CARD_FACES.map((face) => face.icon.codePointAt(0))).toEqual([61749, 61671]);
  });

  it('damps toward a pointer target without overshooting it', () => {
    const next = damp(0, 1, 7, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });
});
