import { describe, expect, it } from 'vitest';
import { createRobotMotion, layPath, poseAt, RUN_SECONDS } from './motion';
import { createDust, stepDust, COUNT } from './dust';
import { ROBOT_HALF_EXTENTS } from './traits';

describe('robot motion and dust', () => {
  it('arrives at the authored stop, looks up, and leaves beyond the viewport using the same pose record', () => {
    const state = createRobotMotion();
    for (const run of [0, 1, 2, 10]) {
      expect(layPath(state.path, 20, 12, run)).toBe(state.path);
      poseAt(state.pose, 0, state.path);
      expect(state.pose.x < -10 || state.pose.y < -6).toBe(true);
      expect(poseAt(state.pose, 4, state.path)).toBe(state.pose);
      expect(state.pose.x).toBeCloseTo(-0.4, 12);
      expect(state.pose.y).toBeCloseTo(0.3, 12);
      expect(state.pose.look).toBe(1);
      poseAt(state.pose, RUN_SECONDS, state.path);
      expect(state.pose.x > 10 || state.pose.y > 6).toBe(true);
    }
  });

  it('copies borrowed robot positions, emits by distance, fades, and does not emit across teleports', () => {
    const state = createDust();
    const footprint = { x: 0, y: 0, z: 0, heading: 0, halfExtents: ROBOT_HALF_EXTENTS };
    const slot = state.particles[0]!;
    const position = slot.position;
    stepDust(state, 1 / 60, footprint);
    footprint.x = 0.36;
    stepDust(state, 1 / 60, footprint);
    expect(state.emitted).toBe(4);
    expect(slot.age).toBe(0);
    expect(slot.position).toBe(position);
    footprint.x = 10;
    stepDust(state, 1 / 60, footprint);
    expect(state.emitted).toBe(4);
    for (let frame = 0; frame < 120; frame++) stepDust(state, 1 / 60, undefined);
    expect(state.particles.every((particle) => particle.age >= particle.life)).toBe(true);
    expect(state.particles).toHaveLength(COUNT);
    expect(state.particles[0]).toBe(slot);
  });
});
