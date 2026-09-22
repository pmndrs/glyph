import type { World } from 'koota';
import { clamp, deltaAngle, mat4, quat, vec2, vec3 } from 'math';
import type { Object3D } from 'three/webgpu';
import { bearingToCamera, MARK, offFrameDistance, TRAVEL_HEADING } from '../cameo/content';
import { Frame } from '../cameo/traits';
import { Time } from '../time/traits';
import { jitter, trackAt } from '../utils';
import {
  BLINK_SECONDS,
  BLINKS,
  BODY_LEAN,
  CARDS,
  DUST_BASE_Z,
  DUST_COUNT,
  DUST_RISE,
  HEAD_TILT,
  LOOK,
  LEAN_SECONDS,
  PRINT_RATE,
  ROBOT_HALF_EXTENTS,
  RUSH_LEAN,
  RUSH_LIMIT,
  TAKE_SECONDS,
  TRAVEL,
} from './content';
import { printCard } from './text';
import { DustView, Robot, RobotView, type Pose, type RobotDraw } from './traits';

/** One gentle wave bends the travel line, so the entrance is not drawn with a ruler. Its phase varies per take. */
const BEND = { amplitude: 0.34, frequency: (2 * Math.PI) / 11 };

/** Run the take: advance its clock, place the robot on the travel line, and turn it to the lens on cue. */
export function runTake(world: World): void {
  const time = world.get(Time)!;
  const reach = offFrameDistance(world.get(Frame)!.aspect);

  world.query(Robot).updateEach(([robot]) => {
    robot.finished = false;

    if (robot.time === undefined) {
      if (time.elapsed < robot.startAt) return;

      robot.time = 0;
      robot.startAt = Number.POSITIVE_INFINITY;
      robot.takes++;
    }

    robot.time += time.delta;

    if (robot.time >= TAKE_SECONDS) {
      robot.time = undefined;
      robot.finished = true;

      return;
    }

    poseAt(robot.pose, robot.time, reach, robot.takes, time.delta);
  });
}

/**
 * Where the robot stands and what it is pointed at, `time` seconds into a take across a frame `reach` wide. The
 * lean chases its target over `delta` seconds; sampled without one it simply arrives, which is what a test wants
 * when it asks where the lean is headed at a moment.
 */
export function poseAt(out: Pose, time: number, reach: number, take: number, delta = Number.POSITIVE_INFINITY): Pose {
  const along = trackAt(TRAVEL, time) * reach;
  const phase = take * 1.7;
  const offset = BEND.amplitude * (Math.sin(BEND.frequency * along + phase) - Math.sin(phase));
  const slope = BEND.amplitude * BEND.frequency * Math.cos(BEND.frequency * along + phase);
  const cos = Math.cos(TRAVEL_HEADING);
  const sin = Math.sin(TRAVEL_HEADING);
  out.x = MARK[0] + cos * along - sin * offset;
  out.y = MARK[1] + sin * along + cos * offset;
  out.look = trackAt(LOOK, time);
  // Watching the road, the robot is pointed along the path; looking up, it pivots to face the lens.
  const travelling = TRAVEL_HEADING + Math.atan(slope);
  out.heading = travelling + deltaAngle(travelling, bearingToCamera(out.x, out.y)) * out.look;
  // The travel track's own second difference: the robot tips into a charge and rocks back out of a brake.
  const step = 1 / 15;
  const behind = trackAt(TRAVEL, time - step) * reach;
  const ahead = trackAt(TRAVEL, time + step) * reach;
  const target = clamp(((ahead - 2 * along + behind) / (step * step)) * RUSH_LEAN, -RUSH_LIMIT, RUSH_LIMIT);
  out.lean += (target - out.lean) * (1 - Math.exp(-delta / LEAN_SECONDS));

  return out;
}

/** Seconds the panel tears around a screenful arriving or being taken away. */
const GLITCH_SECONDS = 0.26;

/**
 * The eyes' state `now` seconds into a take. They are out for as long as anything is printed, so a message of
 * several screenfuls never blinks the eyes back on between them, and the panel tears at every change.
 */
export function eyesAt(out: { shown: number; tear: number }, now: number): void {
  out.shown = 1;
  out.tear = 0;

  for (const card of CARDS) {
    if (now >= card.from && now < card.until) out.shown = 0;

    for (const edge of [card.from, card.until]) {
      const through = (now - (edge - GLITCH_SECONDS / 2)) / GLITCH_SECONDS;

      if (through >= 0 && through < 1) out.tear = Math.max(out.tear, 1 - Math.abs(through * 2 - 1));
    }
  }

  for (const at of BLINKS) {
    if (now >= at && now < at + BLINK_SECONDS) out.shown = 0;
  }
}

/** How many characters of each screenful the face has printed `now` seconds into a take. */
export function printedAt(now: number): readonly number[] {
  return CARDS.map((card) =>
    now >= card.from && now < card.until ? Math.min(card.text.length, Math.floor((now - card.from) * PRINT_RATE)) : 0,
  );
}

/** Emit dust by distance travelled and integrate the retained pool. */
export function stepDust(world: World): void {
  const step = world.get(Time)!.delta;

  world.query(Robot).updateEach(([robot]) => {
    const state = robot.dust;
    const pose = robot.time === undefined ? undefined : robot.pose;

    for (let index = 0; index < DUST_COUNT; index++) state.particles[index]!.age += step;

    const before = state.previous;

    if (pose !== undefined && state.hasPrevious) {
      const dx = pose.x - before[0];
      const dy = pose.y - before[1];
      const distance = Math.hypot(dx, dy);

      if (distance > 4) state.carry = 0;
      else if (distance > 0) {
        const cos = Math.cos(pose.heading);
        const sin = Math.sin(pose.heading);
        const speed = distance / Math.max(step, 0.001);
        const kick = 0.22 + Math.min(speed, 15) * 0.04;

        for (let along = 0.1 - state.carry; along <= distance; along += 0.1) {
          const serial = state.emitted++;
          const particle = state.particles[serial % DUST_COUNT]!;
          const side = serial % 2 === 0 ? -1 : 1;
          const across = side * ROBOT_HALF_EXTENTS[1] * 0.8 + (jitter(serial + 31) - 0.5) * 0.2;
          const rear = ROBOT_HALF_EXTENTS[0] + jitter(serial + 53) * 0.25;
          const fraction = along / distance;
          const spread = side * (0.2 + jitter(serial + 71) * 0.6);
          particle.age = 0;
          particle.life = 1 + jitter(serial + 97) * 0.7;
          vec3.set(
            particle.position,
            before[0] + dx * fraction - cos * rear - sin * across,
            before[1] + dy * fraction - sin * rear + cos * across,
            DUST_BASE_Z,
          );
          vec3.set(particle.velocity, -cos * kick - sin * spread, -sin * kick + cos * spread, 0);
          particle.roll = (jitter(serial + 113) - 0.5) * 0.7;
          particle.spin = (jitter(serial + 137) - 0.5) * 2.4;
          particle.size = 0.15 + jitter(serial + 151) * 0.18;
        }

        state.carry = (state.carry + distance) % 0.1;
      }
    } else state.carry = 0;

    state.hasPrevious = pose !== undefined;

    if (pose !== undefined) vec2.set(before, pose.x, pose.y);

    const drag = Math.exp(-step * 1.8);

    for (let index = 0; index < DUST_COUNT; index++) {
      const particle = state.particles[index]!;

      if (particle.age >= particle.life) continue;

      vec3.scaleAndAdd(particle.position, particle.position, particle.velocity, step);
      vec3.scale(particle.velocity, particle.velocity, drag);
      particle.position[2] = DUST_BASE_Z + (DUST_RISE * particle.age) / particle.life;
      particle.roll += particle.spin * step;
    }
  });
}

/** Publish the simulated pose into the mounted rig. */
export function syncRobotPose(world: World): void {
  world.query(Robot, RobotView).readEach(([robot, mounted]) => {
    const { root, lean } = mounted!;
    root.visible = robot.time !== undefined;

    if (!root.visible) return;

    const { x, y, heading, look } = robot.pose;
    root.position.set(x, y, 0.02);
    root.rotation.z = heading;
    lean.rotation.y = robot.pose.lean - BODY_LEAN * look;
  });
}

/**
 * Advance the animated rig, then crane the head up to the lens, before the display is placed on the joint.
 *
 * The rig is set from the take's own clock rather than stepped by frame deltas, so every take plays the same rig
 * at the same second whatever the frame rate did, and a check that seeks to a moment sees the pose that moment
 * actually has.
 */
export function animateRobotRig(world: World): void {
  world.query(Robot, RobotView).readEach(([robot, mounted]) => {
    if (robot.time === undefined) return;

    const { root, head, mixer, transforms } = mounted!;
    mixer.setTime(robot.time);

    if (head !== undefined && robot.pose.look > 0) {
      root.updateWorldMatrix(true, true);
      tiltJoint(head, transforms, robot.pose.heading, -HEAD_TILT * robot.pose.look);
    }
  });
}

/** Print the face's lines, glitch its eyes, and ride the display on the head joint. */
export function syncRobotFace(world: World): void {
  world.query(Robot, RobotView).readEach(([robot, mounted]) => {
    const view = mounted!;
    const { root, head, screen, transforms, cards } = view;

    if (robot.time === undefined) {
      for (const card of cards) printCard(card, 0);

      view.eyes.value = 1;
      view.tear.value = 0;

      if (screen !== null) screen.visible = false;

      return;
    }

    const now = robot.time;
    const printed = printedAt(now);
    let showing = 0;

    for (let index = 0; index < cards.length; index++) {
      const count = printed[index] ?? 0;
      // A beating screenful is driven by the take's own clock; every other one is printed and left alone.
      printCard(cards[index]!, count, CARDS[index]!.beating === true && count > 0 ? now : Number.NaN);
      showing += count;
    }

    eyesAt(transforms.eyes, now);
    view.eyes.value = transforms.eyes.shown;
    view.tear.value = transforms.eyes.tear;
    view.seed.value = Math.floor(now * 48);

    if (screen === null) return;

    screen.visible = showing > 0;

    // The display rides on the head joint: its matrix is the joint's, brought into the mover's frame.
    if (head !== undefined && screen.visible) {
      root.updateWorldMatrix(true, true);
      root.matrixWorld.toArray(transforms.world);
      head.matrixWorld.toArray(transforms.head);
      mat4.invert(transforms.world, transforms.world);
      mat4.multiply(transforms.world, transforms.world, transforms.head);
      view.faceLocal.toArray(transforms.face);
      mat4.multiply(transforms.world, transforms.world, transforms.face);
      screen.matrix.fromArray(transforms.world);
    }
  });
}

/** Copy simulated dust particles into their mounted glyph groups, stood upright to face the lens. */
export function syncDustViews(world: World): void {
  world.query(Robot, DustView).readEach(([robot, mounted]) => {
    const groups = mounted!;
    const particles = robot.dust.particles;

    for (let index = 0; index < DUST_COUNT; index++) {
      const group = groups[index];

      if (group == null) continue;

      const particle = particles[index]!;
      group.visible = particle.age < particle.life;

      if (!group.visible) continue;

      group.position.fromArray(particle.position);
      group.rotation.set(Math.PI / 2, 0, particle.roll);
      group.scale.setScalar(particle.size * (1 - (particle.age / particle.life) * 0.55));
    }
  });
}

/** Marshal the animated bone once at each boundary. Composition stays in math scratch. */
function tiltJoint(joint: Object3D, scratch: RobotDraw['transforms'], heading: number, angle: number): void {
  if (joint.parent === null) return;

  vec3.set(scratch.axis, -Math.sin(heading), Math.cos(heading), 0);
  joint.parent.getWorldQuaternion(scratch.parentWorld).toArray(scratch.parent);
  quat.setAxisAngle(scratch.tilt, scratch.axis, angle);
  quat.invert(scratch.rotation, scratch.parent);
  quat.multiply(scratch.rotation, scratch.rotation, scratch.tilt);
  quat.multiply(scratch.rotation, scratch.rotation, scratch.parent);
  joint.quaternion.toArray(scratch.local);
  quat.multiply(scratch.local, scratch.rotation, scratch.local);
  joint.quaternion.fromArray(scratch.local);
}
