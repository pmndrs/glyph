import { expect, it } from 'vitest';
import { ROBOT_HALF_EXTENTS } from '../robot/traits';
import {
  createTitleWorld,
  destroyTitleWorld,
  holdLetter,
  releaseLetter,
  reviveLetter,
  stepTitleWorld,
  swallowLetter,
  type LetterSpec,
} from './world';

function letter(): LetterSpec {
  return {
    position: [0, 0, 0.5],
    prisms: [
      [
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
      ],
    ],
  };
}

it('lifts, lands once, and repeats after being swallowed and revived', () => {
  const state = createTitleWorld([letter()], 0, ROBOT_HALF_EXTENTS);

  try {
    for (let replay = 0; replay < 2; replay++) {
      const pose = { x: 0, y: 0, z: 4, yaw: 0.2 };
      holdLetter(state, 0, pose);
      pose.z = 100;
      stepTitleWorld(state, 1 / 60, undefined);
      expect(state.poses[2]).toBe(4);
      releaseLetter(state, 0, [0, 0, -35], 0.35);
      let landings = 0;
      let bounced = false;
      let lastHeight = state.poses[2]!;

      for (let frame = 0; frame < 240; frame++) {
        stepTitleWorld(state, 1 / 60, undefined);
        landings += state.landedCount;
        const height = state.poses[2]!;

        if (landings > 0 && height > lastHeight + 0.01) bounced = true;

        lastHeight = height;
      }

      expect(landings).toBe(1);
      expect(bounced).toBe(true);
      expect(state.poses[2]).toBeCloseTo(0.5, 1);
      expect(state.poses[3]).toBeCloseTo(0);
      expect(state.poses[4]).toBeCloseTo(0);
      swallowLetter(state, 0);
      stepTitleWorld(state, 1, undefined);
      expect(state.landedCount).toBe(0);
      reviveLetter(state, 0, { x: 0, y: 0, z: 0.5, yaw: 0 });
    }
  } finally {
    destroyTitleWorld(state);
  }
});

it('lets the robot push a flat letter and removes its collision when it leaves', () => {
  const state = createTitleWorld([letter()], 0, [0.3, 0.3, 0.5]);
  const target = { x: -2, y: 0.55, z: 0, heading: 0 };

  try {
    for (let frame = 0; frame < 120; frame++) {
      target.x = -2 + frame / 60;
      stepTitleWorld(state, 1 / 60, target);
    }

    expect(state.poses[0]).toBeGreaterThan(0.4);
    expect(state.poses[2]).toBeCloseTo(0.5, 1);
    expect(state.poses[3]).toBeCloseTo(0);
    expect(state.poses[4]).toBeCloseTo(0);
    expect(state.landedCount).toBe(0);
    holdLetter(state, 0, { x: target.x, y: target.y, z: 4, yaw: 0 });
    releaseLetter(state, 0, [0, 0, -35], 0);

    for (let frame = 0; frame < 240; frame++) stepTitleWorld(state, 1 / 60, undefined);

    expect(state.poses[2]).toBeCloseTo(0.5, 1);
  } finally {
    destroyTitleWorld(state);
  }
});
