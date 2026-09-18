import { deltaAngle, lerp, quat, vec3, type Vec3 } from 'math';

import {
  addBroadphaseLayer,
  addObjectLayer,
  box,
  convexHull,
  createWorld,
  createWorldSettings,
  dof,
  enableCollision,
  MaterialCombineMode,
  MotionType,
  registerShapes,
  rigidBody,
  staticCompound,
  updateWorld,
  type Listener,
  type RigidBody,
} from 'crashcat';

registerShapes([box.def, convexHull.def, staticCompound.def]);

/** px, py, pz, qx, qy, qz, qw in the retained pose stream. */
export const POSE_STRIDE = 7;

export interface LetterSpec {
  readonly position: Vec3;
  /** Convex prisms making up the letter's solid, each a flat `[x, y, z, ...]` corner list about its centre. */
  readonly prisms: readonly (readonly number[])[];
}

/** Where the robot wants to be: an upright rounded box on the floor, at a heading in the floor plane. */
export interface RobotTarget {
  readonly x: number;
  readonly y: number;
  /** The floor under it. */
  readonly z: number;
  readonly heading: number;
}

/** A held letter's pose: where it is being carried, and its turn about the floor normal. */
export interface HeldPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

const STEP = 1 / 60;
const LETTER_FRICTION = 0.9;
const FLOOR_THICKNESS = 1;
const ROBOT_ROUNDING_SIDES = 10;

/** Retain bodies, collision storage, and render poses for the lifetime of the scene. */
export function createTitleWorld(
  letters: readonly LetterSpec[],
  floorTop: number,
  robotHalfExtents: readonly [number, number, number],
) {
  const settings = createWorldSettings();
  settings.gravity = [0, 0, -80];
  settings.solver.minVelocityForRestitution = 25;
  const movingLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
  const floorLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
  const parkedLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
  enableCollision(settings, movingLayer, movingLayer);
  enableCollision(settings, movingLayer, floorLayer);
  const world = createWorld(settings);
  const poses = new Float32Array(letters.length * POSE_STRIDE);
  const letterByBody = new Map<number, number>();

  const bodies = letters.map((letter, index) => {
    const shape = staticCompound.create({
      children: letter.prisms.map((prism) => ({
        position: vec3.create(),
        quaternion: quat.create(),
        shape: convexHull.create({ positions: [...prism], density: 8, convexRadius: 0, hullTolerance: 1e-6 }),
      })),
    });
    const body = rigidBody.create(world, {
      motionType: MotionType.DYNAMIC,
      objectLayer: movingLayer,
      shape,
      position: letter.position,
      // Letters slide, rise, and turn around the floor normal without tipping.
      allowedDegreesOfFreedom: dof(true, true, true, false, false, true),
      linearDamping: 0,
      angularDamping: 0,
      friction: LETTER_FRICTION,
      restitution: 0.3,
      frictionCombineMode: MaterialCombineMode.GEOMETRIC_MEAN,
      restitutionCombineMode: MaterialCombineMode.MAX,
    });
    letterByBody.set(body.id, index);
    vec3.toBuffer(poses, letter.position, index * POSE_STRIDE);
    poses[index * POSE_STRIDE + 6] = 1;

    return body;
  });

  const floor = rigidBody.create(world, {
    motionType: MotionType.STATIC,
    objectLayer: floorLayer,
    position: [0, 0, floorTop - FLOOR_THICKNESS / 2],
    shape: box.create({ halfExtents: [80, 80, FLOOR_THICKNESS / 2], convexRadius: 0 }),
    friction: LETTER_FRICTION,
    restitution: 0,
    frictionCombineMode: MaterialCombineMode.GEOMETRIC_MEAN,
    restitutionCombineMode: MaterialCombineMode.MAX,
  });
  const robot = rigidBody.create(world, {
    motionType: MotionType.STATIC,
    objectLayer: parkedLayer,
    shape: convexHull.create({ positions: stadium(robotHalfExtents), convexRadius: 0 }),
    friction: 0.1,
    frictionCombineMode: MaterialCombineMode.GEOMETRIC_MEAN,
    allowSleeping: false,
  });

  const listener: Listener = {
    onContactAdded(a, b) {
      const letter = a === floor ? letterByBody.get(b.id) : b === floor ? letterByBody.get(a.id) : undefined;

      if (letter === undefined || state.airborne[letter] === 0) return;

      state.airborne[letter] = 0;
      state.landed[state.landedCount++] = letter;
    },
  };

  const state = {
    world,
    listener,
    movingLayer,
    parkedLayer,
    floor,
    letters: bodies,
    poses,
    held: new Uint8Array(letters.length),
    airborne: new Uint8Array(letters.length),
    from: Array.from({ length: letters.length }, createHeldPose),
    to: Array.from({ length: letters.length }, createHeldPose),
    moved: new Uint8Array(letters.length),
    landed: new Uint32Array(letters.length),
    landedCount: 0,
    accumulator: 0,
    robot,
    robotActive: false,
    robotFrom: { x: 0, y: 0, z: 0, heading: 0 },
    transform: { position: vec3.create(), quaternion: quat.create() },
    velocity: vec3.create(),
    angular: vec3.create(),
  };

  return state;
}

export type TitleWorld = ReturnType<typeof createTitleWorld>;

export function createHeldPose() {
  return { x: 0, y: 0, z: 0, yaw: 0 };
}

/** Snapshot a retained pose into caller-owned storage. */
export function readTitlePose(out: ReturnType<typeof createHeldPose>, world: TitleWorld, index: number): void {
  const offset = index * POSE_STRIDE;
  out.x = world.poses[offset]!;
  out.y = world.poses[offset + 1]!;
  out.z = world.poses[offset + 2]!;
  out.yaw = 2 * Math.atan2(world.poses[offset + 5]!, world.poses[offset + 6]!);
}

export function holdLetter(state: TitleWorld, index: number, pose: HeldPose): void {
  if (state.held[index] === 0) {
    rigidBody.setMotionType(state.world, state.letters[index]!, MotionType.KINEMATIC, true);
    state.airborne[index] = 0;
    readTitlePose(state.from[index]!, state, index);
    state.held[index] = 1;
  } else Object.assign(state.from[index]!, state.to[index]!);

  Object.assign(state.to[index]!, pose);
}

function setTransform(state: TitleWorld, x: number, y: number, z: number, yaw: number): void {
  vec3.set(state.transform.position, x, y, z);
  quat.set(state.transform.quaternion, 0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2));
}

export function swallowLetter(state: TitleWorld, index: number): void {
  state.held[index] = 0;
  state.airborne[index] = 0;
  parkBody(state, state.letters[index]!);
}

export function reviveLetter(state: TitleWorld, index: number, pose: HeldPose): void {
  const body = state.letters[index]!;
  setTransform(state, pose.x, pose.y, pose.z, pose.yaw);
  rigidBody.setTransform(state.world, body, state.transform.position, state.transform.quaternion, true);
  rigidBody.setLinearVelocity(state.world, body, vec3.zero(state.velocity));
  rigidBody.setAngularVelocity(state.world, body, vec3.zero(state.angular));
  rigidBody.setObjectLayer(state.world, body, state.movingLayer);
  rigidBody.setMotionType(state.world, body, MotionType.KINEMATIC, true);
  writePose(state, index, state.transform.position, state.transform.quaternion);
}

export function releaseLetter(state: TitleWorld, index: number, velocity: Vec3, spin: number): void {
  if (state.held[index] === 0) return;

  const body = state.letters[index]!;
  const to = state.to[index]!;
  setTransform(state, to.x, to.y, to.z, to.yaw);
  rigidBody.setTransform(state.world, body, state.transform.position, state.transform.quaternion, true);
  state.held[index] = 0;
  rigidBody.setMotionType(state.world, body, MotionType.DYNAMIC, true);
  rigidBody.setLinearVelocity(state.world, body, velocity);
  rigidBody.setAngularVelocity(state.world, body, vec3.set(state.angular, 0, 0, spin));
  state.airborne[index] = 1;
}

/** Fixed 60 Hz integration. Event arrays belong to state and expire at the next step. */
export function stepTitleWorld(state: TitleWorld, delta: number, target: RobotTarget | undefined): void {
  const { transform, robotFrom } = state;
  arrive(state, target);
  state.accumulator = Math.min(state.accumulator + delta, STEP * 4);
  const substeps = Math.floor(state.accumulator / STEP);
  state.accumulator -= substeps * STEP;
  state.moved.fill(0);
  state.landedCount = 0;

  for (let substep = 1; substep <= substeps; substep++) {
    const t = substep / substeps;

    if (state.robotActive && target !== undefined) {
      setTransform(
        state,
        lerp(robotFrom.x, target.x, t),
        lerp(robotFrom.y, target.y, t),
        target.z,
        robotFrom.heading + deltaAngle(robotFrom.heading, target.heading) * t,
      );
      rigidBody.moveKinematic(state.robot, transform.position, transform.quaternion, STEP);
    }

    for (let index = 0; index < state.letters.length; index++) {
      if (state.held[index] === 0) continue;

      const from = state.from[index]!;
      const to = state.to[index]!;
      setTransform(
        state,
        lerp(from.x, to.x, t),
        lerp(from.y, to.y, t),
        lerp(from.z, to.z, t),
        from.yaw + deltaAngle(from.yaw, to.yaw) * t,
      );
      rigidBody.wake(state.world, state.letters[index]!);
      rigidBody.moveKinematic(state.letters[index]!, transform.position, transform.quaternion, STEP);
    }

    // Four collision steps keep the fast smash from crossing thin letter and floor solids.
    for (let step = 0; step < 4; step++) updateWorld(state.world, state.listener, STEP / 4);

    for (let index = 0; index < state.letters.length; index++) {
      const body = state.letters[index]!;

      if (body.objectLayer === state.parkedLayer) continue;

      writePose(state, index, body.position, body.quaternion);
      state.moved[index] = 1;
    }
  }

  for (let index = 0; index < state.letters.length; index++) {
    if (state.held[index] === 0) continue;

    const to = state.to[index]!;
    setTransform(state, to.x, to.y, to.z, to.yaw);
    writePose(state, index, transform.position, transform.quaternion);
    state.moved[index] = 1;
  }

  if (target !== undefined) {
    robotFrom.x = target.x;
    robotFrom.y = target.y;
    robotFrom.z = target.z;
    robotFrom.heading = target.heading;
  }
}

export function destroyTitleWorld(state: TitleWorld): void {
  for (const body of state.letters) rigidBody.remove(state.world, body);

  rigidBody.remove(state.world, state.robot);
  rigidBody.remove(state.world, state.floor);
}

/** Park hidden bodies without rebuilding their shapes when playback reuses them. */
function parkBody(state: TitleWorld, body: RigidBody): void {
  rigidBody.setObjectLayer(state.world, body, state.parkedLayer);
  rigidBody.setMotionType(state.world, body, MotionType.STATIC, false);
}

function arrive(state: TitleWorld, target: RobotTarget | undefined): void {
  const { robotFrom } = state;

  if (target === undefined) {
    if (state.robotActive) parkBody(state, state.robot);

    state.robotActive = false;

    return;
  }

  const dx = target.x - robotFrom.x;
  const dy = target.y - robotFrom.y;

  if (!state.robotActive || dx * dx + dy * dy > 2.5 * 2.5) {
    setTransform(state, target.x, target.y, target.z, target.heading);
    rigidBody.setTransform(state.world, state.robot, state.transform.position, state.transform.quaternion, true);
    rigidBody.setLinearVelocity(state.world, state.robot, vec3.zero(state.velocity));
    rigidBody.setAngularVelocity(state.world, state.robot, vec3.zero(state.angular));

    if (!state.robotActive) {
      rigidBody.setObjectLayer(state.world, state.robot, state.movingLayer);
      rigidBody.setMotionType(state.world, state.robot, MotionType.KINEMATIC, true);
    }

    robotFrom.x = target.x;
    robotFrom.y = target.y;
    robotFrom.z = target.z;
    robotFrom.heading = target.heading;
  }

  state.robotActive = true;
}

function writePose(state: TitleWorld, index: number, position: readonly number[], rotation: readonly number[]): void {
  const offset = index * POSE_STRIDE;
  state.poses.set(position, offset);
  state.poses.set(rotation, offset + 3);
}

/** An upright collider with rounded sides. Off-center contacts nudge letters aside. */
function stadium([along, across, up]: readonly [number, number, number]): number[] {
  const points: number[] = [];
  const radius = Math.min(along, across);
  const reach = Math.max(across - radius, 0);

  for (const z of [0, up * 2]) {
    for (let side = 0; side < ROBOT_ROUNDING_SIDES; side += 1) {
      const angle = (side / ROBOT_ROUNDING_SIDES) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      points.push(x, y + reach, z, x, y - reach, z);
    }
  }

  return points;
}
