import type { World } from 'koota';
import { updateWorld } from 'crashcat';
import { Time } from '../time/traits';
import { SOLVER_SCALE } from './actions';
import { Physics } from './traits';

const STEP = 1 / 60;
/**
 * Most fixed steps one frame may run. A step that costs a good part of the frame would otherwise make each late
 * frame owe more steps than the last. Time a frame cannot run is dropped, so the bodies slow instead of spiralling.
 */
const MAX_STEPS = 2;

/** Advance the solver in fixed steps and publish each body's pose in page units. Returns the steps it ran. */
export function stepPhysics(world: World): number {
  const physics = world.get(Physics);

  if (physics === undefined || physics.bodies.size === 0) return 0;

  physics.accumulator += Math.min(world.get(Time)!.delta, 0.1);
  let steps = 0;

  while (physics.accumulator >= STEP && steps < MAX_STEPS) {
    physics.accumulator -= STEP;
    // Two collision passes a step keep a flung letter from crossing a thin rule.
    updateWorld(physics.engine, undefined, STEP / 2);
    updateWorld(physics.engine, undefined, STEP / 2);
    steps++;
  }

  if (physics.accumulator >= STEP) physics.accumulator = 0;

  if (steps === 0) return 0;

  for (const [key, handle] of physics.bodies) {
    const pose = physics.poses.get(key)!;
    pose.x = handle.position[0] / SOLVER_SCALE;
    pose.y = -handle.position[1] / SOLVER_SCALE;
    pose.angle = 2 * Math.atan2(handle.quaternion[2], handle.quaternion[3]);
    pose.vx = handle.motionProperties.linearVelocity[0] / SOLVER_SCALE;
    pose.vy = -handle.motionProperties.linearVelocity[1] / SOLVER_SCALE;
  }

  return steps;
}
