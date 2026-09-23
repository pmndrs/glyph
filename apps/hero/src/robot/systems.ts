import type { Object3D } from 'three/webgpu';
import { showLine } from '../letters/text';
import type { World } from 'koota';
import { Time } from '../time/traits';
import { Mode, Viewport } from '../hero/traits';
import { Robot, RobotView, DustView, MarkerView, type RobotDraw, type Drive, type Path, type Pose } from './traits';
import {
  COUNT,
  BASE_Z,
  RISE,
  ARRIVE_AT,
  LOOK_UP_AT,
  LOOK_DOWN_AT,
  RUN_SECONDS,
  LEAVE_AT,
  BODY_REACH,
  FACE_TEXT,
} from './content';
import { clamp, deltaAngle, lerp, mat4, quat, vec2, vec3, wrapAngle } from 'math';
import { easing } from 'math/time';
import { jitter } from '../utils';
import { Body } from '../physics/traits';
import { physicsActions } from '../physics/actions';

/** Run the scripted drive-in, stop, and exit. Only the sequence runs it: play leaves the robot to the pointer. */
export function moveRobots(world: World): void {
  if (world.get(Mode)!.kind !== 'sequence') return;

  const time = world.get(Time)!;
  const viewport = world.get(Viewport)!;

  world.query(Robot).updateEach(([robot]) => {
    robot.departed = false;

    if (robot.time === undefined) {
      robot.active = false;
      robot.face = undefined;

      if (time.now < robot.runAt) return;

      robot.time = 0;
      robot.runAt = Number.POSITIVE_INFINITY;
      layPath(robot.motion.path, viewport.width, viewport.height, robot.runs++);
      robot.gone = false;
    }

    robot.time += time.delta;

    if (robot.time >= RUN_SECONDS) {
      robot.time = undefined;
      robot.face = undefined;
      robot.active = false;
      robot.departed = true;

      return;
    }

    const pose = poseAt(robot.motion.pose, robot.time, robot.motion.path);
    robot.active = true;
    robot.face = robot.time;
    robot.footprint.x = pose.x;
    robot.footprint.y = pose.y;
    robot.footprint.heading = pose.heading;

    if (
      !robot.gone &&
      robot.time >= LEAVE_AT &&
      (Math.abs(pose.x) > viewport.width / 2 + BODY_REACH || Math.abs(pose.y) > viewport.height / 2 + BODY_REACH)
    ) {
      robot.gone = true;
      robot.departed = true;
    }
  });
}

/** Free play: scoot the robot to wherever the pointer last sent it. */
export function driveRobots(world: World): void {
  if (world.get(Mode)!.kind !== 'play') return;

  const delta = world.get(Time)!.delta;

  world.query(Robot).updateEach(([robot]) => {
    robot.departed = false;
    robot.active = true;
    const pose = steer(robot.motion.pose, robot.drive, delta);
    robot.footprint.x = pose.x;
    robot.footprint.y = pose.y;
    robot.footprint.heading = pose.heading;
    // Once it has settled, the face runs the same greeting as the scripted stop.
    robot.face = robot.drive.hasTarget || robot.drive.rested < REST_BEAT ? undefined : faceClock(robot.drive.rested);
  });
}

/** How long the robot sits before it looks up. */
const REST_BEAT = 0.3;

/** The scripted stop's clock, entered at the look-up, `rested` seconds after arriving. */
function faceClock(rested: number): number {
  return LOOK_UP_AT + rested - REST_BEAT;
}

/**
 * Advance a cart with a bounded turn rate by `delta` seconds. The desired heading sways either side of the bearing
 * along the trip, so no trip is a straight line, and settles onto the bearing over the last stretch so the cart stops
 * on the target rather than circling it. Slow carts pivot harder, which is what keeps a target behind them reachable.
 */
export function steer(pose: Pose, drive: Drive, delta: number): Pose {
  const cruise = 7;
  const accelerate = 14;
  const brake = 11;

  if (!drive.hasTarget) {
    drive.speed = Math.max(0, drive.speed - brake * delta);
    drive.rested += delta;
    approachLook(pose, drive.rested < REST_BEAT ? 0 : lookAt(faceClock(drive.rested)), delta);

    return pose;
  }

  drive.since += delta;
  const dx = drive.targetX - pose.x;
  const dy = drive.targetY - pose.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 0.06) {
    pose.x = drive.targetX;
    pose.y = drive.targetY;
    drive.hasTarget = false;
    drive.speed = 0;
    drive.rested = 0;

    return pose;
  }

  const settle = clamp(distance / 2.4, 0, 1);
  const sway = drive.bend * Math.cos((drive.travelled / 4.6) * Math.PI * 2) * settle;
  const turn = deltaAngle(pose.heading, Math.atan2(dy, dx) + sway);
  const rate = (3.4 + 6 * (1 - Math.min(drive.speed / cruise, 1))) * delta;
  pose.heading = wrapAngle(pose.heading + clamp(turn, -rate, rate));
  // Brake in time to stop, and ease off through a sharp turn.
  const wanted = Math.min(cruise, Math.sqrt(2 * brake * distance)) * (1 - 0.6 * Math.min(Math.abs(turn) / Math.PI, 1));
  drive.speed += clamp(wanted - drive.speed, -brake * delta, accelerate * delta);
  const step = Math.min(drive.speed * delta, distance);
  pose.x += Math.cos(pose.heading) * step;
  pose.y += Math.sin(pose.heading) * step;
  drive.travelled += step;
  approachLook(pose, 0, delta);

  return pose;
}

/** Ease the look towards `goal` no faster than the scripted look-down, so an interrupted greeting settles. */
function approachLook(pose: Pose, goal: number, delta: number): void {
  const rate = delta / 0.4;
  pose.look += clamp(goal - pose.look, -rate, rate);
}

/** Emit by distance and integrate the retained dust pool. Teleports above four units reset the trail. */
export function stepDust(world: World): void {
  const time = world.get(Time)!;

  world.query(Robot).updateEach(([robot]) => {
    const state = robot.dust;
    const step = time.delta;
    const current = robot.active ? robot.footprint : undefined;

    for (let index = 0; index < COUNT; index++) state.particles[index]!.age += step;

    const before = state.previous;

    if (current !== undefined && state.hasPrevious) {
      const dx = current.x - before[0];
      const dy = current.y - before[1];
      const distance = Math.hypot(dx, dy);

      if (distance > 4) state.carry = 0;
      else if (distance > 0) {
        const cos = Math.cos(current.heading);
        const sin = Math.sin(current.heading);
        const speed = distance / Math.max(step, 0.001);
        const kick = 0.25 + Math.min(speed, 15) * 0.035;

        for (let along = 0.09 - state.carry; along <= distance; along += 0.09) {
          const serial = state.emitted++;
          const particle = state.particles[serial % COUNT]!;
          const side = serial % 2 === 0 ? -1 : 1;
          const across = side * current.halfExtents[1] * 0.85 + (jitter(serial + 31) - 0.5) * 0.2;
          const rear = current.halfExtents[0] + jitter(serial + 53) * 0.25;
          const fraction = along / distance;
          const spread = side * (0.25 + jitter(serial + 71) * 0.65);
          particle.age = 0;
          particle.life = 1.1 + jitter(serial + 97) * 0.7;
          vec3.set(
            particle.position,
            lerp(before[0], current.x, fraction) - cos * rear - sin * across,
            lerp(before[1], current.y, fraction) - sin * rear + cos * across,
            BASE_Z,
          );
          vec3.set(particle.velocity, -cos * kick - sin * spread, -sin * kick + cos * spread, 0);
          particle.roll = jitter(serial + 113) * Math.PI * 2;
          particle.spin = (jitter(serial + 137) - 0.5) * 3;
          particle.size = 0.16 + jitter(serial + 151) * 0.19;
        }

        state.carry = (state.carry + distance) % 0.09;
      }
    } else state.carry = 0;

    state.hasPrevious = current !== undefined;

    if (current !== undefined) vec2.set(before, current.x, current.y);

    const drag = Math.exp(-step * 1.8);

    for (let index = 0; index < COUNT; index++) {
      const particle = state.particles[index]!;

      if (particle.age >= particle.life) continue;

      vec3.scaleAndAdd(particle.position, particle.position, particle.velocity, step);
      vec3.scale(particle.velocity, particle.velocity, drag);
      particle.position[2] = BASE_Z + (RISE * particle.age) / particle.life;
      particle.roll += particle.spin * step;
    }
  });
}

export function moveRobotBodies(world: World): void {
  const physics = physicsActions(world);

  // Only robot data is written back here, preserving the physics actions' body updates.
  world
    .query(Robot, Body)
    .select(Robot)
    .updateEach(([robot], entity) => {
      const body = entity.get(Body)!;

      if (!robot.active) {
        if (body.mode !== 'parked') physics.parkBody(entity);

        return;
      }

      const target = robot.footprint;
      const pose = robot.physicsPose;
      pose.x = target.x;
      pose.y = target.y;
      pose.z = target.z;
      pose.yaw = target.heading;
      const dx = target.x - body.to.x;
      const dy = target.y - body.to.y;

      if (body.mode === 'parked' || dx * dx + dy * dy > 2.5 * 2.5) physics.reviveBody(entity, pose);

      physics.holdBody(entity, pose);
    });
}

/** Where it stops to look up: on top of the title, over the Y. The path is laid through this point. */
const STOP: readonly [x: number, y: number] = [-0.4, 0.3];
/** Direction of travel, from the x axis: up and to the right, steeper than the icon drift so the two read apart. */
const HEADING = 0.62;
const HEADING_COS = Math.cos(HEADING);
const HEADING_SIN = Math.sin(HEADING);
/** Two sine waves bend the drive path. Advancing their phase varies each replay while preserving the stop. */
const MEANDER = [
  { amplitude: 0.7, frequency: (2 * Math.PI) / 9.5 },
  { amplitude: 0.22, frequency: (2 * Math.PI) / 3.1 },
] as const;

/** Lays the run through STOP so it starts and ends past the visible edge of a `width` by `height` floor. */
function layPath(out: Path, width: number, height: number, run: number): Path {
  const [stopX, stopY] = STOP;
  const cos = HEADING_COS;
  const sin = HEADING_SIN;
  // In from beyond both the left and the bottom edge. Out once beyond the right or the top edge.
  const inward = Math.max((stopX + width / 2 + 2.6) / cos, (stopY + height / 2 + 2.6) / sin);
  const outward = Math.min((width / 2 + 2.6 - stopX) / cos, (height / 2 + 2.6 - stopY) / sin);
  out.inward = inward;
  out.outward = outward;
  out.phase = run * 2.4;

  return out;
}

/** Where the robot is `time` seconds into a run along `path`. */
function poseAt(out: Pose, time: number, path: Path): Pose {
  // Arc length along the line of travel, measured from the stop.
  let s: number;

  if (time < ARRIVE_AT) s = -path.inward * (1 - easing.cubicOut(time / ARRIVE_AT));
  else if (time < LEAVE_AT) s = 0;
  else s = path.outward * easing.cubicIn(saturate((time - LEAVE_AT) / (RUN_SECONDS - LEAVE_AT)));

  let offset = 0;
  let slope = 0;

  for (let index = 0; index < MEANDER.length; index++) {
    const wave = MEANDER[index]!;
    const k = wave.frequency;
    const shift = path.phase * (index + 1);
    offset += wave.amplitude * (Math.sin(k * s + shift) - Math.sin(shift));
    slope += wave.amplitude * k * Math.cos(k * s + shift);
  }

  const cos = HEADING_COS;
  const sin = HEADING_SIN;
  const x = STOP[0] + cos * s - sin * offset;
  const y = STOP[1] + sin * s + cos * offset;

  out.x = x;
  out.y = y;
  out.heading = HEADING + Math.atan(slope);
  out.look = lookAt(time);

  return out;
}

/** 0 = looking ahead, 1 = face turned up to the camera, `time` seconds into a run. */
function lookAt(time: number): number {
  if (time < LOOK_UP_AT) return 0;
  if (time < LOOK_DOWN_AT) return easing.sineInOut(saturate((time - LOOK_UP_AT) / 0.55));

  return 1 - easing.sineInOut(saturate((time - LOOK_DOWN_AT) / 0.4));
}

function saturate(value: number): number {
  return clamp(value, 0, 1);
}

const TYPE_FROM = LOOK_UP_AT + 1.1;
const TYPE_UNTIL = LOOK_DOWN_AT + 0.25;
const GLITCH_SECONDS = 0.3;

/** How many letters of the face's message are lit, `face` seconds on the display's clock. */
export function faceLetters(face: number): number {
  return face >= TYPE_FROM && face < TYPE_UNTIL ? Math.min(FACE_TEXT.length, Math.floor((face - TYPE_FROM) * 9)) : 0;
}

/** The eyes' glitch: whether they are shown, and how hard the screen is tearing, `now` seconds into a run. */
function eyesAt(out: { shown: number; tear: number }, now: number): void {
  const away = (now - (TYPE_FROM - GLITCH_SECONDS)) / GLITCH_SECONDS;
  const back = (now - TYPE_UNTIL) / GLITCH_SECONDS;

  if (away >= 0 && away < 1) {
    out.shown = away < 0.5 ? 1 : 0;
    out.tear = 1 - Math.abs(away * 2 - 1);
  } else if (back >= 0 && back < 1) {
    out.shown = back < 0.5 ? 0 : 1;
    out.tear = 1 - Math.abs(back * 2 - 1);
  } else {
    out.shown = now >= TYPE_FROM && now < TYPE_UNTIL ? 0 : 1;
    out.tear = 0;
  }
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

/** Publish the simulated pose into the mounted robot root. */
export function syncRobotPose(world: World): void {
  world.query(Robot, RobotView).readEach(([robot, mounted]) => {
    const { root, lean } = mounted!;
    root.visible = robot.active;

    if (!robot.active) return;

    const { x, y, heading, look } = robot.motion.pose;
    root.position.set(x, y, 0.04);
    root.rotation.z = heading;
    lean.rotation.y = -0.34 * look;
  });
}

/** Advance the mounted rig before placing its screen on the head joint. */
export function animateRobotRig(world: World): void {
  world.query(Robot, RobotView).readEach(([robot, mounted]) => {
    if (!robot.active) return;

    const { root, head, mixer, transforms } = mounted!;
    const { heading, look } = robot.motion.pose;
    mixer.update(world.get(Time)!.delta);

    if (head !== undefined && look > 0) {
      root.updateWorldMatrix(true, true);
      tiltJoint(head, transforms, heading, -0.62 * look);
    }
  });
}

/** Update the mounted display's text, glitch uniforms, and head-relative pose. */
export function syncRobotDisplay(world: World): void {
  world.query(Robot, RobotView).readEach(([robot, mounted]) => {
    const view = mounted!;
    const { root, head, transforms } = view;

    if (!robot.active || robot.face === undefined) {
      showLine(view.line, 0);
      view.eyes.value = 1;
      view.tear.value = 0;

      if (view.screen !== null) view.screen.visible = false;

      return;
    }

    // Looking up, the face prints its message a letter at a time, and clears it as it looks back down.
    const now = robot.face;
    const count = faceLetters(now);
    showLine(view.line, count);

    if (view.screen !== null) view.screen.visible = count > 0;

    eyesAt(transforms.eyes, now);
    const eyes = transforms.eyes;
    view.eyes.value = eyes.shown;
    view.tear.value = eyes.tear;
    view.seed.value = Math.floor(now * 48);

    // The display rides on the head joint: its matrix is the joint's, brought into the mover's frame.
    const screen = view.screen;

    if (head !== undefined && screen !== null && count > 0) {
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

/** Place the destination marker and ease it in while the robot is on its way, out once it has arrived. */
export function syncMarkerView(world: World): void {
  const delta = world.get(Time)!.delta;

  world.query(Robot, MarkerView).readEach(([robot, mounted]) => {
    const view = mounted!;
    const drive = robot.drive;

    if (drive.hasTarget) view.mesh.position.set(drive.targetX, drive.targetY, 0.02);

    view.presence.value += ((drive.hasTarget ? 1 : 0) - view.presence.value) * (1 - Math.exp(-delta / 0.1));
    view.age.value = drive.since;
    view.mesh.visible = view.presence.value > 0.005;
  });
}

/** Copy simulated dust particles into mounted glyph groups. */
export function syncDustViews(world: World): void {
  world.query(Robot, DustView).readEach(([robot, mounted]) => {
    const groups = mounted!;
    const particles = robot.dust.particles;

    for (let index = 0; index < COUNT; index++) {
      const group = groups[index];

      if (group == null) continue;

      const particle = particles[index]!;
      group.visible = particle.age < particle.life;

      if (!group.visible) continue;

      group.position.fromArray(particle.position);
      group.rotation.z = particle.roll;
      group.scale.setScalar(particle.size * (1 - (particle.age / particle.life) * 0.55));
    }
  });
}
