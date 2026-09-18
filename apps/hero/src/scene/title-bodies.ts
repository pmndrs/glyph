import type { Glyphs } from '@pmndrs/glyph/three';
import { mat4, quat, vec3, lerp } from 'math';
import { easing } from 'math/time';
import { Matrix4 } from 'three/webgpu';
import { POSE_STRIDE } from '../physics/stream';
import {
  createTitleWorld,
  createHeldPose,
  readTitlePose,
  holdLetter,
  releaseLetter,
  reviveLetter,
  swallowLetter,
  stepTitleWorld,
  destroyTitleWorld,
} from '../physics/title-world';
import type { Box3DModule } from '../physics/world';
import { createFlight, departureAt, flight } from './departure';
import { ROBOT_HALF_EXTENTS, type Footprint } from './floor';
import { setTitleReach } from './metrics';
import type { HoleState } from './hole';
import type { Solid } from './outline';

/** The lift: each letter is carried up to this short of the camera and thrown back down, 35 ms after its
 * neighbour. Where it lands is the floor's business. */
const LIFT_CLEARANCE = 1.6;
const LIFT_SECONDS = 0.45;
const STAGGER = 0.035;
/** Thrown down, not dropped: the fall should read as a smash, not a float. */
const THROW = 35;
/** A little sideways and a little spin on the way down, so each letter settles off its mark and off square. */
const DRIFT = 0.9;
const SPIN = 0.35;
/** Successive replays throw each letter a different way, so the word never settles the same twice. */
const REPLAY_TURN = 2.4;
/** Half a letter's diagonal: how far a corner can reach above a tilted letter's centre. */
const HALF_DIAGONAL = 3.2;
/** The heavy title follows a wider, slower arc than the small glyphs. */
const FLIGHT_SECONDS = 0.85;

/** One letter of the title: its rest place in world units, its solid for the physics, and its glyph. */
export interface Letter {
  readonly home: readonly [x: number, y: number, z: number];
  readonly solid: Solid;
  /** The letter's glyph in the broken-apart copy of the paragraph, and its rest matrix there. */
  readonly index: number;
  readonly original: Matrix4;
}

/** A letter's place on the floor, in world units. */
export interface Landing {
  readonly index: number;
  x: number;
  y: number;
}

/** Allocate all lift, departure, event, and matrix storage before playback. */
export function createTitleBodies(
  b3: Box3DModule,
  glyphs: Glyphs,
  letters: readonly Letter[],
  cameraHeight: number,
  thickness: number,
) {
  const inverse = mat4.create();
  glyphs.matrixWorld.toArray(inverse);
  mat4.invert(inverse, inverse);
  const pieces = letters.map((letter) => {
    const offset = mat4.create();
    const original = mat4.create();
    const world = mat4.create();
    letter.original.toArray(original);
    glyphs.matrixWorld.toArray(world);
    mat4.fromTranslation(offset, vec3.fromValues(-letter.home[0], -letter.home[1], -letter.home[2]));
    mat4.multiply(offset, offset, world);
    mat4.multiply(offset, offset, original);
    return { letter, offset };
  });
  const world = createTitleWorld(
    b3,
    letters.map(({ home, solid }) => ({
      position: vec3.fromValues(home[0], home[1], home[2]),
      prisms: solid.prisms,
    })),
    Math.min(...letters.map(({ home }) => home[2])) - thickness / 2,
    ROBOT_HALF_EXTENTS,
  );
  const state = {
    glyphs,
    inverse,
    pieces,
    world,
    liftHeight: cameraHeight - LIFT_CLEARANCE,
    lifting: false,
    elapsed: 0,
    replays: 0,
    departing: false,
    from: letters.map(createHeldPose),
    origins: letters.map(createHeldPose),
    released: new Uint8Array(letters.length),
    swallowed: new Uint8Array(letters.length),
    grow: new Float64Array(letters.length).fill(1),
    landings: letters.map((_, index) => ({ index, x: 0, y: 0 })),
    landingCount: 0,
    pose: createHeldPose(),
    flight: createFlight(),
    velocity: vec3.create(),
    position: vec3.create(),
    rotation: quat.create(),
    scale: vec3.create(),
    body: mat4.create(),
    matrix: mat4.create(),
    draw: new Matrix4(),
  };
  for (let index = 0; index < pieces.length; index++) writeLetter(state, index);
  return state;
}
export type TitleBodies = ReturnType<typeof createTitleBodies>;

/** Reuse the same body and glyph records on every replay. */
export function replayTitle(state: TitleBodies): void {
  state.replays++;
  for (let index = 0; index < state.pieces.length; index++) {
    if (state.swallowed[index] === 1) {
      const home = state.pieces[index]!.letter.home;
      state.pose.x = home[0];
      state.pose.y = home[1];
      state.pose.z = home[2];
      state.pose.yaw = 0;
      reviveLetter(state.world, index, state.pose);
      state.grow[index] = 1;
      writeLetter(state, index);
    }
    readTitlePose(state.from[index]!, state.world, index);
  }
  state.swallowed.fill(0);
  state.released.fill(0);
  state.departing = false;
  state.lifting = true;
  state.elapsed = 0;
}

/** Landings are a fixed buffer; consume only landingCount entries before the next update. */
export function updateTitle(state: TitleBodies, delta: number, robot: Footprint | undefined, hole: HoleState): void {
  carryTitle(state, delta);
  attractTitle(state, hole);
  stepTitleWorld(state.world, delta, robot);
  setTitleReach(titleReach(state));
  for (let index = 0; index < state.pieces.length; index++) {
    if (state.world.moved[index] === 1) writeLetter(state, index);
  }
  state.landingCount = state.world.landedCount;
  for (let slot = 0; slot < state.landingCount; slot++) {
    const index = state.world.landed[slot]!;
    const landing = state.landings[slot]!;
    landing.index = index;
    landing.x = state.world.poses[index * POSE_STRIDE]!;
    landing.y = state.world.poses[index * POSE_STRIDE + 1]!;
  }
}

export function disposeTitle(state: TitleBodies): void {
  destroyTitleWorld(state.world);
}

export function titleReach(state: TitleBodies): number {
  const poses = state.world.poses;
  let reach = 0;
  for (let index = 0; index < state.pieces.length; index++) {
    const offset = index * POSE_STRIDE;
    const qx = poses[offset + 3]!;
    const qy = poses[offset + 4]!;
    const upright = 1 - 2 * (qx * qx + qy * qy);
    reach = Math.max(reach, poses[offset + 2]! + Math.sqrt(Math.max(0, 1 - upright * upright)) * HALF_DIAGONAL);
  }
  return reach;
}

function carryTitle(state: TitleBodies, delta: number): void {
  if (!state.lifting) return;
  state.elapsed += delta;
  let pending = false;
  const pose = state.pose;
  for (let index = 0; index < state.pieces.length; index++) {
    if (state.released[index] === 1) continue;
    const time = state.elapsed - index * STAGGER;
    if (time < 0) {
      pending = true;
      continue;
    }
    const home = state.pieces[index]!.letter.home;
    const from = state.from[index]!;
    if (time < LIFT_SECONDS) {
      const rise = easing.sineInOut(time / LIFT_SECONDS);
      pose.x = lerp(from.x, home[0], rise);
      pose.y = lerp(from.y, home[1], rise);
      pose.z = home[2] + state.liftHeight * rise;
      pose.yaw = from.yaw * (1 - rise);
      holdLetter(state.world, index, pose);
      pending = true;
    } else {
      pose.x = home[0];
      pose.y = home[1];
      pose.z = home[2] + state.liftHeight;
      pose.yaw = 0;
      holdLetter(state.world, index, pose);
      const way = (index + state.replays) * REPLAY_TURN;
      vec3.set(state.velocity, Math.cos(way) * DRIFT, Math.sin(way) * DRIFT, -THROW);
      releaseLetter(state.world, index, state.velocity, (index + state.replays) % 2 === 0 ? SPIN : -SPIN);
      state.released[index] = 1;
    }
  }
  state.lifting = pending;
}

function attractTitle(state: TitleBodies, hole: HoleState): void {
  if (hole.beat === 'closed') {
    for (let index = 0; index < state.pieces.length; index++) {
      if (state.grow[index] !== 1) {
        state.grow[index] = 1;
        writeLetter(state, index);
      }
    }
    return;
  }
  if (!state.departing) {
    for (let index = 0; index < state.pieces.length; index++) readTitlePose(state.origins[index]!, state.world, index);
    state.departing = true;
  }
  for (let index = 0; index < state.pieces.length; index++) {
    if (state.swallowed[index] === 1) continue;
    const from = state.origins[index]!;
    const x = from.x - hole.x;
    const y = from.y - hole.y;
    const flightPose = flight(state.flight, hole.time, departureAt(Math.hypot(x, y) / 9, index), FLIGHT_SECONDS);
    if (flightPose.size === 0 || hole.beat === 'black') {
      state.swallowed[index] = 1;
      swallowLetter(state.world, index);
      state.grow[index] = 0;
      writeLetter(state, index);
      continue;
    }
    const cosine = Math.cos(flightPose.turn);
    const sine = Math.sin(flightPose.turn);
    const pose = state.pose;
    pose.x = hole.x + (x * cosine - y * sine) * flightPose.radius;
    pose.y = hole.y + (x * sine + y * cosine) * flightPose.radius;
    pose.z = from.z + Math.sin(Math.PI * (1 - flightPose.size)) * 1.8;
    pose.yaw = from.yaw + flightPose.turn;
    holdLetter(state.world, index, pose);
    state.grow[index] = flightPose.size * (1 + 0.35 * Math.sin(Math.PI * (1 - flightPose.size)));
  }
}

/** Marshal the physics buffer into math scratch, then publish one Three matrix to Glyph. */
function writeLetter(state: TitleBodies, index: number): void {
  const piece = state.pieces[index]!;
  vec3.fromBuffer(state.position, state.world.poses, index * POSE_STRIDE);
  quat.fromBuffer(state.rotation, state.world.poses, index * POSE_STRIDE + 3);
  const grow = state.grow[index]!;
  vec3.set(state.scale, grow, grow, 1);
  mat4.fromRotationTranslationScale(state.body, state.rotation, state.position, state.scale);
  mat4.multiply(state.matrix, state.inverse, state.body);
  mat4.multiply(state.matrix, state.matrix, piece.offset);
  state.glyphs.setMatrixAt(piece.letter.index, state.draw.fromArray(state.matrix));
}
