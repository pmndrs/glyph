import { deltaAngle, lerp, quat, vec3, type Vec3 } from 'math';

import type Box3D from 'box3d.js/inline';
export type Box3DModule = Awaited<ReturnType<typeof Box3D>>;
/** px, py, pz, qx, qy, qz, qw at the Box3D boundary. */
export const POSE_STRIDE = 7;

type Body = ReturnType<Box3DModule['b3CreateBody']>;

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
/** Substeps per frame before the simulation falls behind rather than freezing the page. */
const MAX_SUBSTEPS = 4;
const SOLVER_SUBSTEPS = 4;
/** Down is into the paper. Strong, so a fall from the camera is over in a blink rather than a float. */
const GRAVITY = 80;
/** Impacts slower than this stop dead: a smash from the camera rebounds once, and its second landing stays down. */
const RESTITUTION_THRESHOLD = 25;
const LETTER_RESTITUTION = 0.3;
/** Stone on paper: heavy, and it grips. A shove moves a letter exactly as far as it was pushed. */
const LETTER_DENSITY = 8;
const LETTER_FRICTION = 0.9;
const FLOOR_THICKNESS = 1;
const FLOOR_HALF_WIDTH = 80;
/** The robot: a rounded box on wheels that rolls rather than grips. */
const ROBOT_FRICTION = 0.1;
const ROBOT_ROUNDING_SIDES = 10;
/** A target further than this from the last one is a jump, not driving: the robot is placed there. */
const MAX_DRIVE = 2.5;

/** Fixed-capacity application state; Box3D owns the physical world and its reusable event views. */
export function createTitleWorld(
  b3: Box3DModule,
  letters: readonly LetterSpec[],
  floorTop: number,
  robotHalfExtents: readonly [number, number, number],
) {
  const poses = new Float32Array(letters.length * POSE_STRIDE);
  const letterByBody = new Map<number, number>();
  const letterByShape = new Map<number, number>();
  const worldDef = b3.b3DefaultWorldDef();
  worldDef.gravity = [0, 0, -GRAVITY];
  worldDef.restitutionThreshold = RESTITUTION_THRESHOLD;
  const world = b3.b3CreateWorld(worldDef);
  const events = b3.createEventsBuffer();
  const move = b3.createBodyMoveEvent();
  const touch = b3.createContactTouchEvent();

  const bodies: Body[] = [];
  for (const [index, letter] of letters.entries()) {
    const bodyDef = b3.b3DefaultBodyDef();
    bodyDef.type = b3.b3BodyType.b3_dynamicBody;
    bodyDef.position = letter.position;
    // Flat on the floor for good: it slides and turns in the plane, and rises and falls, but never tips.
    bodyDef.motionLocks = {
      linearX: false,
      linearY: false,
      linearZ: false,
      angularX: true,
      angularY: true,
      angularZ: false,
    };
    const body = b3.b3CreateBody(world, bodyDef);
    const shapeDef = b3.b3DefaultShapeDef();
    shapeDef.density = LETTER_DENSITY;
    shapeDef.enableContactEvents = true;
    shapeDef.baseMaterial.restitution = LETTER_RESTITUTION;
    shapeDef.baseMaterial.friction = LETTER_FRICTION;
    for (const prism of letter.prisms) {
      const hull = b3.b3CreateHull(prism);
      if (hull === null) continue;
      const shape = b3.b3CreateHullShape(body, shapeDef, hull);
      letterByShape.set(shape.index1, index);
      // The world keeps its own copy of the hull.
      b3.b3DestroyHull(hull);
    }
    bodies.push(body);
    letterByBody.set(body.index1, index);
    vec3.toBuffer(poses, letter.position, index * POSE_STRIDE);
    poses[index * POSE_STRIDE + 6] = 1;
  }

  const floorDef = b3.b3DefaultBodyDef();
  floorDef.type = b3.b3BodyType.b3_staticBody;
  floorDef.position = [0, 0, floorTop - FLOOR_THICKNESS / 2];
  const floor = b3.b3CreateBody(world, floorDef);
  const floorShapeDef = b3.b3DefaultShapeDef();
  floorShapeDef.enableContactEvents = true;
  floorShapeDef.baseMaterial.friction = LETTER_FRICTION;
  const floorShape = b3.b3CreateBoxShape(
    floor,
    floorShapeDef,
    FLOOR_HALF_WIDTH,
    FLOOR_HALF_WIDTH,
    FLOOR_THICKNESS / 2,
  ).index1;
  return {
    b3,
    world,
    events,
    move,
    touch,
    letters: bodies,
    letterByBody,
    letterByShape,
    floorShape,
    poses,
    held: new Uint8Array(letters.length),
    airborne: new Uint8Array(letters.length),
    from: Array.from({ length: letters.length }, createHeldPose),
    to: Array.from({ length: letters.length }, createHeldPose),
    moved: new Uint8Array(letters.length),
    landed: new Uint32Array(letters.length),
    landedCount: 0,
    accumulator: 0,
    robot: createRobotBody(b3, world, robotHalfExtents),
    robotActive: false,
    robotFrom: { x: 0, y: 0, z: 0, heading: 0 },
    transform: { position: vec3.create(), quaternion: quat.create() },
    velocity: vec3.create(),
    angular: vec3.create(),
  };
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
    state.b3.b3Body_SetType(state.letters[index]!, state.b3.b3BodyType.b3_kinematicBody);
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
  state.b3.b3Body_Disable(state.letters[index]!);
}

export function reviveLetter(state: TitleWorld, index: number, pose: HeldPose): void {
  const { b3 } = state;
  const body = state.letters[index]!;
  setTransform(state, pose.x, pose.y, pose.z, pose.yaw);
  b3.b3Body_SetTransform(body, state.transform.position, state.transform.quaternion);
  b3.b3Body_SetLinearVelocity(body, vec3.zero(state.velocity));
  b3.b3Body_SetAngularVelocity(body, vec3.zero(state.angular));
  b3.b3Body_Enable(body);
  writePose(state, index, state.transform.position, state.transform.quaternion);
}

export function releaseLetter(state: TitleWorld, index: number, velocity: Vec3, spin: number): void {
  if (state.held[index] === 0) return;
  const { b3 } = state;
  const body = state.letters[index]!;
  const to = state.to[index]!;
  setTransform(state, to.x, to.y, to.z, to.yaw);
  b3.b3Body_SetTransform(body, state.transform.position, state.transform.quaternion);
  state.held[index] = 0;
  b3.b3Body_SetType(body, b3.b3BodyType.b3_dynamicBody);
  b3.b3Body_SetLinearVelocity(body, velocity);
  b3.b3Body_SetAngularVelocity(body, vec3.set(state.angular, 0, 0, spin));
  b3.b3Body_SetAwake(body, true);
  state.airborne[index] = 1;
}

/** Fixed 60 Hz integration. Event arrays belong to state and expire at the next step. */
export function stepTitleWorld(state: TitleWorld, delta: number, target: RobotTarget | undefined): void {
  const { b3, transform, robotFrom } = state;
  arrive(state, target);
  state.accumulator = Math.min(state.accumulator + delta, STEP * MAX_SUBSTEPS);
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
      b3.b3Body_SetTargetTransform(state.robot, transform, STEP, true);
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
      b3.b3Body_SetTargetTransform(state.letters[index]!, transform, STEP, true);
    }
    b3.b3World_Step(state.world, STEP, SOLVER_SUBSTEPS);
    b3.getEvents(state.events, state.world);
    for (let index = 0; index < b3.getNumBodyMoveEvents(state.events); index++) {
      const event = b3.getBodyMoveEventAt(state.move, state.events, index);
      const letter = state.letterByBody.get(event.bodyId.index1);
      if (letter === undefined) continue;
      writePose(state, letter, event.position, event.rotation);
      state.moved[letter] = 1;
    }
    for (let index = 0; index < b3.getNumContactBeginEvents(state.events); index++) {
      const touch = b3.getContactBeginEventAt(state.touch, state.events, index);
      const a = touch.shapeIdA.index1;
      const b = touch.shapeIdB.index1;
      const letter =
        a === state.floorShape
          ? state.letterByShape.get(b)
          : b === state.floorShape
            ? state.letterByShape.get(a)
            : undefined;
      if (letter === undefined || state.airborne[letter] === 0) continue;
      state.airborne[letter] = 0;
      state.landed[state.landedCount++] = letter;
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
  state.b3.destroyEventsBuffer(state.events);
  state.b3.b3DestroyWorld(state.world);
}

/** Allocate the robot collider during preparation, before its first visible drive. */
function createRobotBody(
  b3: Box3DModule,
  world: ReturnType<Box3DModule['b3CreateWorld']>,
  halfExtents: readonly [number, number, number],
): Body {
  const def = b3.b3DefaultBodyDef();
  def.type = b3.b3BodyType.b3_kinematicBody;
  def.isEnabled = false;
  const body = b3.b3CreateBody(world, def);
  const shape = b3.b3DefaultShapeDef();
  shape.baseMaterial.friction = ROBOT_FRICTION;
  const hull = b3.b3CreateHull(stadium(halfExtents));
  if (hull !== null) {
    b3.b3CreateHullShape(body, shape, hull);
    b3.b3DestroyHull(hull);
  }
  return body;
}

function arrive(state: TitleWorld, target: RobotTarget | undefined): void {
  const { b3, robotFrom } = state;
  if (target === undefined) {
    if (state.robotActive) b3.b3Body_Disable(state.robot);
    state.robotActive = false;
    return;
  }
  const dx = target.x - robotFrom.x;
  const dy = target.y - robotFrom.y;
  if (!state.robotActive || dx * dx + dy * dy > MAX_DRIVE * MAX_DRIVE) {
    setTransform(state, target.x, target.y, target.z, target.heading);
    b3.b3Body_SetTransform(state.robot, state.transform.position, state.transform.quaternion);
    b3.b3Body_SetLinearVelocity(state.robot, vec3.zero(state.velocity));
    b3.b3Body_SetAngularVelocity(state.robot, vec3.zero(state.angular));
    if (!state.robotActive) b3.b3Body_Enable(state.robot);
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
/**
 * The robot's solid: a box with its two sides rounded off, standing on the floor (z from 0 to its full height).
 * The rounding is along the wide axis, so a letter met off centre is nudged aside rather than carried.
 */
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
