import { POSE_STRIDE } from './stream';
import type { Box3DModule } from './world';

type Vec3 = [x: number, y: number, z: number];
type Quat = [x: number, y: number, z: number, w: number];
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
  /** Along the heading, across it, and up. Read when the robot first arrives; it keeps that shape. */
  readonly halfExtents: readonly [number, number, number];
}

/** A held letter's pose: where it is being carried, and its turn about the floor normal. */
export interface HeldPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** What a letter is let go with. */
export interface Release {
  readonly velocity: Vec3;
  /** Angular speed about the floor normal. */
  readonly spin: number;
}

export interface StepResult {
  /** Letters whose pose changed. */
  readonly moved: readonly number[];
  /** Letters that met the floor for the first time since they were released. */
  readonly landed: readonly number[];
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

/**
 * The title's letters as stone slabs on the floor, and a robot driving among them. Letters fall under gravity on
 * to a static floor and rest there; they slide and turn on it but never tip. A letter can be carried out of the
 * simulation's hands (kinematic) and let go again. The robot is kinematic too: nothing on the floor can stop it,
 * and it is driven to its pose each frame so it shoves with the momentum of its actual motion. It leaves the world
 * while nothing is driving.
 */
export class TitleWorld {
  readonly letterCount: number;
  /** Letter poses, `letterCount × POSE_STRIDE` (px, py, pz, qx, qy, qz, qw). */
  readonly poses: Float32Array;
  readonly #b3: Box3DModule;
  readonly #world: ReturnType<Box3DModule['b3CreateWorld']>;
  readonly #events: ReturnType<Box3DModule['createEventsBuffer']>;
  readonly #move: ReturnType<Box3DModule['createBodyMoveEvent']>;
  readonly #touch: ReturnType<Box3DModule['createContactTouchEvent']>;
  readonly #letters: readonly Body[];
  readonly #letterByBody = new Map<number, number>();
  readonly #letterByShape = new Map<number, number>();
  readonly #floorShape: number;
  /** Made the first time the robot drives on to the floor. */
  #robot: Body | undefined;
  /** Where the robot was last driven to, while it is on the floor. */
  #robotTarget: RobotTarget | undefined;
  /** Letters being carried, with where they are carried from and to over the current frame. */
  readonly #held = new Map<number, { from: HeldPose; to: HeldPose }>();
  /** Letters let go and not yet down. */
  readonly #airborne = new Set<number>();
  #accumulator = 0;

  constructor(b3: Box3DModule, letters: readonly LetterSpec[], floorTop: number) {
    this.#b3 = b3;
    this.letterCount = letters.length;
    this.poses = new Float32Array(letters.length * POSE_STRIDE);

    const worldDef = b3.b3DefaultWorldDef();
    worldDef.gravity = [0, 0, -GRAVITY];
    worldDef.restitutionThreshold = RESTITUTION_THRESHOLD;
    this.#world = b3.b3CreateWorld(worldDef);
    this.#events = b3.createEventsBuffer();
    this.#move = b3.createBodyMoveEvent();
    this.#touch = b3.createContactTouchEvent();

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
      const body = b3.b3CreateBody(this.#world, bodyDef);
      const shapeDef = b3.b3DefaultShapeDef();
      shapeDef.density = LETTER_DENSITY;
      shapeDef.enableContactEvents = true;
      shapeDef.baseMaterial.restitution = LETTER_RESTITUTION;
      shapeDef.baseMaterial.friction = LETTER_FRICTION;
      for (const prism of letter.prisms) {
        const hull = b3.b3CreateHull(prism);
        if (hull === null) continue;
        const shape = b3.b3CreateHullShape(body, shapeDef, hull);
        this.#letterByShape.set(shape.index1, index);
        // The world keeps its own copy of the hull.
        b3.b3DestroyHull(hull);
      }
      bodies.push(body);
      this.#letterByBody.set(body.index1, index);
      this.#writePose(index, letter.position, [0, 0, 0, 1]);
    }
    this.#letters = bodies;

    const floorDef = b3.b3DefaultBodyDef();
    floorDef.type = b3.b3BodyType.b3_staticBody;
    floorDef.position = [0, 0, floorTop - FLOOR_THICKNESS / 2];
    const floor = b3.b3CreateBody(this.#world, floorDef);
    const floorShapeDef = b3.b3DefaultShapeDef();
    floorShapeDef.enableContactEvents = true;
    floorShapeDef.baseMaterial.friction = LETTER_FRICTION;
    this.#floorShape = b3.b3CreateBoxShape(
      floor,
      floorShapeDef,
      FLOOR_HALF_WIDTH,
      FLOOR_HALF_WIDTH,
      FLOOR_THICKNESS / 2,
    ).index1;
  }

  /** Carries letter `index` to `pose` over the next step, out of the simulation's hands until `release`. */
  hold(index: number, pose: HeldPose): void {
    const body = this.#letters[index];
    if (body === undefined) return;
    const held = this.#held.get(index);
    if (held === undefined) {
      this.#b3.b3Body_SetType(body, this.#b3.b3BodyType.b3_kinematicBody);
      this.#airborne.delete(index);
      this.#held.set(index, { from: this.#heldPoseOf(index), to: pose });
    } else {
      this.#held.set(index, { from: held.to, to: pose });
    }
  }

  /** Pushes letter `index` with `[x, y]`, as an acceleration: the force scales with its mass. */
  shove(index: number, accelerationX: number, accelerationY: number): void {
    const body = this.#letters[index];
    if (body === undefined || this.#held.has(index)) return;
    const mass = this.#b3.b3Body_GetMass(body);
    this.#b3.b3Body_ApplyForceToCenter(body, [accelerationX * mass, accelerationY * mass, 0], true);
  }

  /** Sets how much a letter's motion is drained each second, for a fall into the hole rather than an orbit. */
  drag(index: number, damping: number): void {
    const body = this.#letters[index];
    if (body !== undefined) this.#b3.b3Body_SetLinearDamping(body, damping);
  }

  /** Lifts letter `index` off the floor with an upward speed of `speed`: a pluck, and the floor's friction is gone
   * until it lands again. */
  pluck(index: number, speed: number): void {
    const body = this.#letters[index];
    if (body === undefined || this.#held.has(index)) return;
    const velocity = this.#b3.b3Body_GetLinearVelocity([0, 0, 0], body);
    this.#b3.b3Body_SetLinearVelocity(body, [velocity[0], velocity[1], speed]);
    this.#b3.b3Body_SetAwake(body, true);
  }

  /** Takes letter `index` out of the world; `revive` puts it back. */
  swallow(index: number): void {
    const body = this.#letters[index];
    if (body === undefined) return;
    this.#held.delete(index);
    this.#airborne.delete(index);
    this.#b3.b3Body_Disable(body);
  }

  /** Puts a swallowed letter back in the world, at rest at `pose`. */
  revive(index: number, pose: HeldPose): void {
    const body = this.#letters[index];
    if (body === undefined) return;
    this.#b3.b3Body_SetTransform(body, [pose.x, pose.y, pose.z], yawQuaternion(pose.yaw));
    this.#b3.b3Body_SetLinearVelocity(body, [0, 0, 0]);
    this.#b3.b3Body_SetAngularVelocity(body, [0, 0, 0]);
    this.#b3.b3Body_Enable(body);
    this.#writePose(index, [pose.x, pose.y, pose.z], yawQuaternion(pose.yaw));
  }

  /** Lets a held letter go with a throw and a spin; it lands when the floor says so. */
  release(index: number, release: Release): void {
    const body = this.#letters[index];
    const held = this.#held.get(index);
    if (body === undefined || held === undefined) return;
    this.#b3.b3Body_SetTransform(body, [held.to.x, held.to.y, held.to.z], yawQuaternion(held.to.yaw));
    this.#held.delete(index);
    this.#b3.b3Body_SetType(body, this.#b3.b3BodyType.b3_dynamicBody);
    this.#b3.b3Body_SetLinearVelocity(body, release.velocity);
    this.#b3.b3Body_SetAngularVelocity(body, [0, 0, release.spin]);
    this.#b3.b3Body_SetAwake(body, true);
    this.#airborne.add(index);
  }

  /** Advances by `delta` seconds, driving the robot to `target` over that time, or with it gone when undefined. */
  step(delta: number, target: RobotTarget | undefined): StepResult {
    const b3 = this.#b3;
    const robot = this.#arrive(target);
    const robotFrom = this.#robotTarget;
    this.#robotTarget = target;

    this.#accumulator = Math.min(this.#accumulator + delta, STEP * MAX_SUBSTEPS);
    const substeps = Math.floor(this.#accumulator / STEP);
    this.#accumulator -= substeps * STEP;
    const moved = new Set<number>();
    const landed: number[] = [];
    for (let substep = 1; substep <= substeps; substep += 1) {
      // The robot and carried letters reach their targets in even parts across the substeps, so a shove is spread
      // over the whole frame.
      const t = substep / substeps;
      if (robot !== undefined && target !== undefined && robotFrom !== undefined) {
        b3.b3Body_SetTargetTransform(
          robot,
          {
            position: [lerp(robotFrom.x, target.x, t), lerp(robotFrom.y, target.y, t), target.z],
            quaternion: yawQuaternion(robotFrom.heading + shortestTurn(robotFrom.heading, target.heading) * t),
          },
          STEP,
          true,
        );
      }
      for (const [index, { from, to }] of this.#held) {
        const body = this.#letters[index];
        if (body === undefined) continue;
        b3.b3Body_SetTargetTransform(
          body,
          {
            position: [lerp(from.x, to.x, t), lerp(from.y, to.y, t), lerp(from.z, to.z, t)],
            quaternion: yawQuaternion(from.yaw + shortestTurn(from.yaw, to.yaw) * t),
          },
          STEP,
          true,
        );
      }
      b3.b3World_Step(this.#world, STEP, SOLVER_SUBSTEPS);
      b3.getEvents(this.#events, this.#world);
      for (let index = 0; index < b3.getNumBodyMoveEvents(this.#events); index += 1) {
        const event = b3.getBodyMoveEventAt(this.#move, this.#events, index);
        const letter = this.#letterByBody.get(event.bodyId.index1);
        if (letter === undefined) continue;
        this.#writePose(letter, event.position, event.rotation);
        moved.add(letter);
      }
      if (this.#airborne.size === 0) continue;
      for (let index = 0; index < b3.getNumContactBeginEvents(this.#events); index += 1) {
        const touch = b3.getContactBeginEventAt(this.#touch, this.#events, index);
        const a = touch.shapeIdA.index1;
        const b = touch.shapeIdB.index1;
        let letter: number | undefined;
        if (a === this.#floorShape) letter = this.#letterByShape.get(b);
        else if (b === this.#floorShape) letter = this.#letterByShape.get(a);
        if (letter === undefined || !this.#airborne.has(letter)) continue;
        this.#airborne.delete(letter);
        landed.push(letter);
      }
    }
    // A carried letter's pose comes from where it is carried, not from a move event it may not raise.
    for (const [index, { to }] of this.#held) {
      this.#writePose(index, [to.x, to.y, to.z], yawQuaternion(to.yaw));
      moved.add(index);
    }
    return { moved: [...moved], landed };
  }

  destroy(): void {
    this.#b3.destroyEventsBuffer(this.#events);
    this.#b3.b3DestroyWorld(this.#world);
  }

  /** Puts the robot on the floor at its target, or takes it off; returns it while it is on. */
  #arrive(target: RobotTarget | undefined): Body | undefined {
    const b3 = this.#b3;
    const last = this.#robotTarget;
    if (target === undefined) {
      if (last !== undefined && this.#robot !== undefined) b3.b3Body_Disable(this.#robot);
      return undefined;
    }
    const robot = (this.#robot ??= this.#makeRobot(target));
    if (last === undefined || Math.hypot(target.x - last.x, target.y - last.y) > MAX_DRIVE) {
      // Arriving, or asked to be somewhere it could not have driven to in a frame: placed there, at rest. Driving
      // across a jump would give it a velocity of hundreds of units a second and launch every letter it met.
      b3.b3Body_SetTransform(robot, [target.x, target.y, target.z], yawQuaternion(target.heading));
      b3.b3Body_SetLinearVelocity(robot, [0, 0, 0]);
      b3.b3Body_SetAngularVelocity(robot, [0, 0, 0]);
      if (last === undefined) b3.b3Body_Enable(robot);
      // Placed, so this frame drives from here rather than from wherever it was.
      this.#robotTarget = target;
    }
    return robot;
  }

  #makeRobot(target: RobotTarget): Body {
    const b3 = this.#b3;
    const bodyDef = b3.b3DefaultBodyDef();
    bodyDef.type = b3.b3BodyType.b3_kinematicBody;
    bodyDef.position = [target.x, target.y, target.z];
    bodyDef.rotation = yawQuaternion(target.heading);
    bodyDef.isEnabled = false;
    const body = b3.b3CreateBody(this.#world, bodyDef);
    const shapeDef = b3.b3DefaultShapeDef();
    shapeDef.baseMaterial.friction = ROBOT_FRICTION;
    const hull = b3.b3CreateHull(stadium(target.halfExtents));
    if (hull !== null) {
      b3.b3CreateHullShape(body, shapeDef, hull);
      b3.b3DestroyHull(hull);
    }
    this.#robot = body;
    return body;
  }

  #heldPoseOf(index: number): HeldPose {
    const offset = index * POSE_STRIDE;
    return {
      x: this.poses[offset] ?? 0,
      y: this.poses[offset + 1] ?? 0,
      z: this.poses[offset + 2] ?? 0,
      yaw: 2 * Math.atan2(this.poses[offset + 5] ?? 0, this.poses[offset + 6] ?? 1),
    };
  }

  #writePose(index: number, position: readonly number[], rotation: readonly number[]): void {
    const offset = index * POSE_STRIDE;
    this.poses.set(position, offset);
    this.poses.set(rotation, offset + 3);
  }
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

function yawQuaternion(yaw: number): Quat {
  return [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** The signed turn from one heading to another, the short way round. */
function shortestTurn(from: number, to: number): number {
  const turn = (to - from) % (2 * Math.PI);
  if (turn > Math.PI) return turn - 2 * Math.PI;
  if (turn < -Math.PI) return turn + 2 * Math.PI;
  return turn;
}
