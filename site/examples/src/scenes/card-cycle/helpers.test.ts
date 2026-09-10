import { describe, expect, it } from 'vitest';

import { BOTTOM_Z, TOP_Z, createCycleState, damp, queueFlip, stepCycle, writeCardTransform } from './config';

describe('card cycle', () => {
  it('returns the flipped card behind the newly active front', () => {
    const state = createCycleState();
    queueFlip(state);
    stepCycle(state, 0.45);
    expect(state.flipping).toBe(true);
    stepCycle(state, 0.45);
    expect(state).toMatchObject({ top: 1, queued: 0, flipping: false, progress: 0 });

    const top = { x: 0, y: 0, z: 0, rotationY: 0 };
    const bottom = { x: 0, y: 0, z: 0, rotationY: 0 };
    writeCardTransform(top, 1, state.top, undefined);
    writeCardTransform(bottom, 0, state.top, undefined);
    expect(top.z).toBe(TOP_Z);
    expect(bottom.z).toBe(BOTTOM_Z);
  });

  it('shows the authored back face halfway through an arc behind the stack', () => {
    const transform = { x: 0, y: 0, z: 0, rotationY: 0 };
    writeCardTransform(transform, 0, 0, 0.5);
    expect(transform.rotationY).toBeCloseTo(Math.PI);
    expect(transform.z).toBeLessThan(BOTTOM_Z);
  });

  it('damps toward a pointer target without overshooting it', () => {
    const next = damp(0, 1, 7, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });
});
