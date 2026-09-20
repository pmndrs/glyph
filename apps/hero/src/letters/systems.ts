import type { World } from 'koota';
import { Body } from '../physics/traits';
import { Time } from '../time/traits';
import { Collapse, type HoleState } from '../black-hole/traits';
import { FEATURE_LINE } from './content';
import { Title, Typing, type TitleBodies } from './traits';
import { mat4, vec3, lerp } from 'math';
import { easing } from 'math/time';
import { physicsActions } from '../physics/actions';
import { readBodyPose } from '../physics/utils';
import { flight, departureAt } from '../black-hole/utils';

export function moveTitle(world: World): void {
  const time = world.get(Time)!;
  const hole = world.get(Collapse)!.hole;

  world.query(Title).updateEach(([title]) => {
    if (title.bodies === undefined) return;

    carryTitle(world, title.bodies, time.delta);
    attractTitle(world, title.bodies, hole);
  });
}

/** Publish poses and this frame's landings for the application to compose. */
export function syncTitle(world: World): void {
  world.query(Title).updateEach(([title]) => {
    if (title.bodies === undefined) return;

    updateTitle(title.bodies);
    title.reach = titleReach(title.bodies);
  });
}

export function typeFeature(world: World): void {
  if (world.get(Collapse)!.hole.beat !== 'closed') return;

  const time = world.get(Time)!;

  world.query(Typing).updateEach(([typing]) => {
    if (time.now < typing.start) return;

    // Three captured frames per character at the shared 60 Hz update cadence.
    typing.beat++;
    typing.count = Math.min(Math.floor(typing.beat / 3), FEATURE_LINE.length);
  });
}

function carryTitle(world: World, state: TitleBodies, delta: number): void {
  if (!state.lifting) return;

  const liftSeconds = 0.45;
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

    if (time < liftSeconds) {
      const rise = easing.sineInOut(time / liftSeconds);
      pose.x = lerp(from.x, home[0], rise);
      pose.y = lerp(from.y, home[1], rise);
      pose.z = home[2] + state.liftHeight * rise;
      pose.yaw = from.yaw * (1 - rise);
      physicsActions(world).holdBody(state.pieces[index]!.entity, pose);
      pending = true;
    } else {
      pose.x = home[0];
      pose.y = home[1];
      pose.z = home[2] + state.liftHeight;
      pose.yaw = 0;
      physicsActions(world).holdBody(state.pieces[index]!.entity, pose);
      const way = (index + state.replays) * 2.4;
      vec3.set(state.velocity, Math.cos(way) * 0.9, Math.sin(way) * 0.9, -35);
      physicsActions(world).releaseBody(
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
      physicsActions(world).parkBody(state.pieces[index]!.entity);
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
    physicsActions(world).holdBody(state.pieces[index]!.entity, pose);
    state.grow[index] = flightPose.size * (1 + 0.35 * Math.sin(Math.PI * (1 - flightPose.size)));
  }
}

/** Project entity poses after physics and collect this frame's landings. */
function updateTitle(state: TitleBodies): void {
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

function titleReach(state: TitleBodies): number {
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

/** Publish each simulated pose into the retained matrix stream consumed by the view. */
export function writeLetter(state: TitleBodies, index: number): void {
  const piece = state.pieces[index]!;
  const body = piece.entity.get(Body)!;
  const grow = state.grow[index]!;
  vec3.set(state.scale, grow, grow, 1);
  mat4.fromRotationTranslationScale(state.body, body.rotation, body.position, state.scale);
  mat4.multiply(state.matrix, state.inverse, state.body);
  mat4.multiply(state.matrix, state.matrix, piece.offset);
  state.matrices.set(state.matrix, index * 16);
}
