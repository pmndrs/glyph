import { mat4, vec3, lerp, type Mat4 } from 'math';
import type { World } from 'koota';
import { easing } from 'math/time';
import { Body, createHeldPose, readBodyPose } from '../physics/traits';
import { physicsActions } from '../physics/actions';
import { createFlight, departureAt, flight } from '../black-hole/departure';
import type { HoleState } from '../black-hole/motion';
import type { Solid } from './outline';

const LIFT_SECONDS = 0.45;

/** One letter of the title: its rest place in world units, its solid for the physics, and its glyph. */
export interface Letter {
  readonly home: readonly [x: number, y: number, z: number];
  readonly solid: Solid;
  /** The letter's glyph in the broken-apart copy of the paragraph, and its rest matrix there. */
  readonly index: number;
  readonly original: Mat4;
}

/** A letter's place on the floor, in world units. */
export interface Landing {
  readonly index: number;
  x: number;
  y: number;
}

/** Allocate all lift, departure, event, and matrix storage before playback. */
export function createTitleBodies(
  world: World,
  worldMatrix: Mat4,
  letters: readonly Letter[],
  cameraHeight: number,
  thickness: number,
) {
  const inverse = mat4.create();
  mat4.copy(inverse, worldMatrix);
  mat4.invert(inverse, inverse);
  const physics = physicsActions(world);
  physics.setFloor(Math.min(...letters.map(({ home }) => home[2])) - thickness / 2);

  const pieces = letters.map((letter) => {
    const offset = mat4.create();
    const original = mat4.create();
    const transform = mat4.create();
    mat4.copy(original, letter.original);
    mat4.copy(transform, worldMatrix);
    mat4.fromTranslation(offset, vec3.fromValues(-letter.home[0], -letter.home[1], -letter.home[2]));
    mat4.multiply(offset, offset, transform);
    mat4.multiply(offset, offset, original);

    const entity = physics.spawnSolid(
      vec3.fromValues(letter.home[0], letter.home[1], letter.home[2]),
      letter.solid.prisms,
    );

    return { letter, offset, entity };
  });

  const state = {
    matrices: new Float64Array(letters.length * 16),
    inverse,
    pieces,
    liftHeight: cameraHeight - 1.6,
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
    scale: vec3.create(),
    body: mat4.create(),
    matrix: mat4.create(),
  };

  for (let index = 0; index < pieces.length; index++) writeLetter(state, index);

  return state;
}

export type TitleBodies = ReturnType<typeof createTitleBodies>;

/** Reuse the same body and glyph records on every replay. */
export function replayTitle(world: World, state: TitleBodies): void {
  state.replays++;

  for (let index = 0; index < state.pieces.length; index++) {
    if (state.swallowed[index] === 1) {
      const home = state.pieces[index]!.letter.home;
      state.pose.x = home[0];
      state.pose.y = home[1];
      state.pose.z = home[2];
      state.pose.yaw = 0;
      physicsActions(world).revive(state.pieces[index]!.entity, state.pose);
      state.grow[index] = 1;
      writeLetter(state, index);
    }

    readBodyPose(state.from[index]!, state.pieces[index]!.entity);
  }

  state.swallowed.fill(0);
  state.released.fill(0);
  state.departing = false;
  state.lifting = true;
  state.elapsed = 0;
}

export function prepareTitle(world: World, state: TitleBodies, delta: number, hole: HoleState): void {
  carryTitle(world, state, delta);
  attractTitle(world, state, hole);
}

/** Project entity poses after physics and collect this frame's landings. */
export function updateTitle(state: TitleBodies): void {
  state.landingCount = 0;

  for (let index = 0; index < state.pieces.length; index++) {
    const body = state.pieces[index]!.entity.get(Body)!;

    if (body.moved) writeLetter(state, index);

    if (!body.landed) continue;

    const landing = state.landings[state.landingCount++]!;
    landing.index = index;
    landing.x = body.position[0];
    landing.y = body.position[1];
  }
}

export function disposeTitle(state: TitleBodies): void {
  for (const piece of state.pieces) {
    if (piece.entity.isAlive()) piece.entity.destroy();
  }
}

export function titleReach(state: TitleBodies): number {
  let reach = 0;

  for (let index = 0; index < state.pieces.length; index++) {
    const body = state.pieces[index]!.entity.get(Body)!;
    const qx = body.rotation[0];
    const qy = body.rotation[1];
    const upright = 1 - 2 * (qx * qx + qy * qy);
    reach = Math.max(reach, body.position[2] + Math.sqrt(Math.max(0, 1 - upright * upright)) * 3.2);
  }

  return reach;
}

function carryTitle(world: World, state: TitleBodies, delta: number): void {
  if (!state.lifting) return;

  state.elapsed += delta;
  let pending = false;
  const pose = state.pose;

  for (let index = 0; index < state.pieces.length; index++) {
    if (state.released[index] === 1) continue;

    const time = state.elapsed - index * 0.035;

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
      physicsActions(world).hold(state.pieces[index]!.entity, pose);
      pending = true;
    } else {
      pose.x = home[0];
      pose.y = home[1];
      pose.z = home[2] + state.liftHeight;
      pose.yaw = 0;
      physicsActions(world).hold(state.pieces[index]!.entity, pose);
      const way = (index + state.replays) * 2.4;
      vec3.set(state.velocity, Math.cos(way) * 0.9, Math.sin(way) * 0.9, -35);
      physicsActions(world).release(
        state.pieces[index]!.entity,
        state.velocity,
        (index + state.replays) % 2 === 0 ? 0.35 : -0.35,
      );
      state.released[index] = 1;
    }
  }

  state.lifting = pending;
}

function attractTitle(world: World, state: TitleBodies, hole: HoleState): void {
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
    for (let index = 0; index < state.pieces.length; index++)
      readBodyPose(state.origins[index]!, state.pieces[index]!.entity);

    state.departing = true;
  }

  for (let index = 0; index < state.pieces.length; index++) {
    if (state.swallowed[index] === 1) continue;

    const from = state.origins[index]!;
    const x = from.x - hole.x;
    const y = from.y - hole.y;
    const flightPose = flight(state.flight, hole.time, departureAt(Math.hypot(x, y) / 9, index), 0.85);

    if (flightPose.size === 0 || hole.beat === 'black') {
      state.swallowed[index] = 1;
      physicsActions(world).park(state.pieces[index]!.entity);
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
    physicsActions(world).hold(state.pieces[index]!.entity, pose);
    state.grow[index] = flightPose.size * (1 + 0.35 * Math.sin(Math.PI * (1 - flightPose.size)));
  }
}

/** Publish each simulated pose into the retained matrix stream consumed by the view. */
function writeLetter(state: TitleBodies, index: number): void {
  const piece = state.pieces[index]!;
  const body = piece.entity.get(Body)!;
  const grow = state.grow[index]!;
  vec3.set(state.scale, grow, grow, 1);
  mat4.fromRotationTranslationScale(state.body, body.rotation, body.position, state.scale);
  mat4.multiply(state.matrix, state.inverse, state.body);
  mat4.multiply(state.matrix, state.matrix, piece.offset);
  state.matrices.set(state.matrix, index * 16);
}
