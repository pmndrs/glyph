import type { World } from 'koota';
import { Frame, Sequence } from '../sequence/traits';
import { sequenceActions } from '../sequence/actions';
import { Robot } from './traits';
import { layPath, poseAt, FIRST_RUN_DELAY, REPLAY_DELAY, RUN_SECONDS, LEAVE_AT, BODY_REACH } from './motion';
import { stepDust } from './dust';

export function moveRobots(world: World): void {
  const frame = world.get(Frame)!;
  const sequence = world.get(Sequence)!;
  const shock = sequence.impacts[sequence.latestImpact];

  world.query(Robot).updateEach(([robot]) => {
    if (shock !== undefined && shock.id !== robot.wave) {
      robot.wave = shock.id;
      robot.runAt = shock.at + REPLAY_DELAY * 1000;
    }
    if (robot.time === undefined) {
      robot.runAt ??= frame.now + FIRST_RUN_DELAY * 1000;
      robot.active = false;
      if (frame.now < robot.runAt) return;
      robot.time = 0;
      robot.runAt = Number.POSITIVE_INFINITY;
      layPath(robot.motion.path, frame.width, frame.height, robot.runs++);
      robot.gone = false;
    }
    robot.time = robot.held ?? robot.time + frame.delta;
    if (robot.time >= RUN_SECONDS) {
      robot.time = undefined;
      robot.active = false;
      sequenceActions(world).openCollapse();
      return;
    }
    const pose = poseAt(robot.motion.pose, robot.time, robot.motion.path);
    robot.active = true;
    robot.footprint.x = pose.x;
    robot.footprint.y = pose.y;
    robot.footprint.heading = pose.heading;
    if (
      !robot.gone &&
      robot.time >= LEAVE_AT &&
      (Math.abs(pose.x) > frame.width / 2 + BODY_REACH || Math.abs(pose.y) > frame.height / 2 + BODY_REACH)
    ) {
      robot.gone = true;
      sequenceActions(world).openCollapse();
    }
  });
}

export function emitDust(world: World): void {
  const frame = world.get(Frame)!;
  world.query(Robot).updateEach(([robot]) => {
    stepDust(robot.dust, frame.delta, robot.active ? robot.footprint : undefined);
  });
}
