import { trait } from 'koota';
import { createRobotMotion } from './motion';
import { createDust } from './dust';

/** Along the heading, across it, and up; shared by the visual rig and its prepared collider. */
export const ROBOT_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, 1.5];

/**
 * What is driving on the floor, published by the robot and read by whatever it can push. The floor is the screen
 * plane; a footprint is an upright box on it. Owned by each robot entity.
 */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  /** Centre height above the floor. */
  readonly z: number;
  /** Direction of travel, from the x axis. */
  readonly heading: number;
  /** Along the direction of travel, across it, and up. */
  readonly halfExtents: readonly [number, number, number];
}

export const Robot = trait(() => ({
  motion: createRobotMotion(),
  dust: createDust(),
  footprint: { x: 0, y: 0, z: 0.04, heading: 0, halfExtents: ROBOT_HALF_EXTENTS },
  active: false,
  time: undefined as number | undefined,
  runAt: undefined as number | undefined,
  held: undefined as number | undefined,
  runs: 0,
  wave: 0,
  gone: false,
}));
