import { describe, expect, it } from 'vitest';

import { FrameStepper, MAX_FRAME_MS, MAX_STEPS_PER_FRAME } from './frame-stepper';
import { STEP_SECONDS } from './glyph-physics-world';

const STEP_MS = STEP_SECONDS * 1000;

describe('frame stepper', () => {
  it('runs one step per 60 Hz frame and keeps the fractional remainder', () => {
    const stepper = new FrameStepper();
    let steps = 0;
    for (let frame = 0; frame < 60; frame += 1) steps += stepper.advance(STEP_MS, 1, () => undefined);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it('never runs more than the cap in a frame and never lets pending time grow when each step overruns the frame', () => {
    const stepper = new FrameStepper();
    // The wall clock advances by what the steps cost: each step takes 12 ms, so a frame of two steps takes 24 ms plus
    // 4 ms of render, and the next frame is that much later. A carried backlog would grow each frame.
    const stepCostMs = 12;
    const renderMs = 4;
    let clock = 0;
    let previous = 0;
    let largestPending = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      const steps = stepper.advance(clock - previous, 1, () => {
        clock += stepCostMs;
      });
      previous = clock - steps * stepCostMs;
      clock += renderMs;
      expect(steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
      expect(stepper.pendingMs).toBeLessThan(STEP_MS);
      largestPending = Math.max(largestPending, stepper.pendingMs);
    }
    expect(largestPending).toBeLessThan(STEP_MS);
  });

  it('discards the time it could not run instead of carrying it to the next frame', () => {
    const stepper = new FrameStepper();
    expect(stepper.advance(MAX_FRAME_MS, 1, () => undefined)).toBe(MAX_STEPS_PER_FRAME);
    expect(stepper.pendingMs).toBe(0);
    expect(stepper.advance(0, 1, () => undefined)).toBe(0);
  });

  it('runs whole fixed steps only, so the step count is a function of the frame gaps', () => {
    const run = (): number => {
      const stepper = new FrameStepper();
      let steps = 0;
      for (const gap of [16, 17, 33, 100, 5, 16, 40]) steps += stepper.advance(gap, 1, () => undefined);
      return steps;
    };
    expect(run()).toBe(run());
  });
});
