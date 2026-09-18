import { expect, it } from 'vitest';
import Box3D from 'box3d.js/inline';
import { ROBOT_HALF_EXTENTS } from '../robot/traits';
import { createTitleWorld, destroyTitleWorld, holdLetter, releaseLetter, stepTitleWorld } from './physics';

it('copies held targets and reports a physical landing once using retained event buffers', async () => {
  const b3 = await Box3D();
  const state = createTitleWorld(
    b3,
    [
      {
        position: [0, 0, 0.5],
        prisms: [
          [
            -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
            0.5, 0.5, 0.5, 0.5, 0.5,
          ],
        ],
      },
    ],
    0,
    ROBOT_HALF_EXTENTS,
  );
  try {
    const poses = state.poses;
    const landed = state.landed;
    const pose = { x: 0, y: 0, z: 4, yaw: 0.2 };
    holdLetter(state, 0, pose);
    pose.z = 100;
    stepTitleWorld(state, 1 / 60, undefined);
    expect(state.poses[2]).toBe(4);
    releaseLetter(state, 0, [0, 0, -10], 0);
    let landings = 0;
    for (let frame = 0; frame < 240; frame++) {
      stepTitleWorld(state, 1 / 60, undefined);
      landings += state.landedCount;
    }
    expect(landings).toBe(1);
    expect(state.poses[2]).toBeCloseTo(0.5, 1);
    expect(state.poses).toBe(poses);
    expect(state.landed).toBe(landed);
  } finally {
    destroyTitleWorld(state);
  }
});
