import { resetLine, showLine, writeLetter } from './utils';
import type { World } from 'koota';
import { Body, type HeldPose } from '../physics/traits';
import { Time } from '../time/traits';
import { Collapse, type HoleState } from '../black-hole/traits';
import { FEATURE_LINE } from './content';
import { Title, Typing, TitleView, FeatureView, type TitleBodies } from './traits';
import { mat4, vec3, lerp } from 'math';
import { easing } from 'math/time';
import { physicsActions } from '../physics/actions';
import { readBodyPose } from '../physics/utils';
import { flight, departureAt, type Flight } from '../black-hole/utils';

const pose: HeldPose = { x: 0, y: 0, z: 0, yaw: 0 };
const velocity = vec3.create();
const path: Flight = { radius: 1, turn: 0, stretch: 1, size: 1 };
const lineWorld = mat4.create();
const lineInverse = mat4.create();
const transform = mat4.create();
const turn = mat4.create();
const pivot = mat4.create();
const center = vec3.create();
const scale = vec3.create();

export function moveTitle(world: World): void {
  const time = world.get(Time)!;
  const hole = world.get(Collapse)!.hole;

  world.query(Title).updateEach(([title]) => {
    if (title.bodies === undefined) return;

    carryTitle(world, title.bodies, time.delta);
    attractTitle(world, title.bodies, hole, world.get(Collapse)!.fromPlay);
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

  world.query(Typing).updateEach(([typing]) => {
    // Leaving backspaces a character a frame, three times as fast as it typed.
    if (typing.leaving) {
      typing.count = Math.max(typing.count - 1, 0);
      typing.leaving = typing.count > 0;

      return;
    }

    if (!typing.started) return;

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
      vec3.set(velocity, Math.cos(way) * 0.9, Math.sin(way) * 0.9, -35);
      physicsActions(world).releaseBody(
        state.pieces[index]!.entity,
        velocity,
        (index + state.replays) % 2 === 0 ? 0.35 : -0.35,
      );
      state.released[index] = 1;
    }
  }

  state.lifting = pending;
}

/** Park a letter where the hole has taken it, and hide it. */
function swallowLetter(world: World, state: TitleBodies, index: number): void {
  state.swallowed[index] = 1;
  physicsActions(world).parkBody(state.pieces[index]!.entity);
  state.grow[index] = 0;
  writeLetter(state, index);
}

function attractTitle(world: World, state: TitleBodies, hole: HoleState, fromPlay: boolean): void {
  if (hole.beat === 'closed') {
    for (let index = 0; index < state.pieces.length; index++) {
      if (state.grow[index] !== 1) {
        state.grow[index] = 1;
        writeLetter(state, index);
      }
    }

    return;
  }

  // The pop takes whatever is left, including the letters still riding the field through play's finale.
  if (hole.beat === 'black') {
    for (let index = 0; index < state.pieces.length; index++) {
      if (state.swallowed[index] !== 1) swallowLetter(world, state, index);
    }

    return;
  }

  // The sequence's finale sends every letter off on its own moment. Play's hole, and the finale it grows into,
  // take only the letters their field carries in, one at a time, each leaving when it was eaten.
  if (!state.departing && hole.beat !== 'play' && !fromPlay) {
    for (let index = 0; index < state.pieces.length; index++) {
      const from = state.origins[index]!;
      readBodyPose(from, state.pieces[index]!.entity);
      state.departure[index] = departureAt(Math.hypot(from.x - hole.x, from.y - hole.y) / 9, index);
    }

    state.departing = true;
  }

  for (let index = 0; index < state.pieces.length; index++) {
    if (state.swallowed[index] === 1 || Number.isNaN(state.departure[index])) continue;

    const from = state.origins[index]!;
    const x = from.x - hole.x;
    const y = from.y - hole.y;
    const flightPose = flight(path, hole.time, state.departure[index]!, hole.beat === 'play' ? 0.6 : 0.85);

    if (flightPose.size === 0) {
      swallowLetter(world, state, index);
      continue;
    }

    const cosine = Math.cos(flightPose.turn);
    const sine = Math.sin(flightPose.turn);
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

/** Copy simulated letter poses into the mounted glyph draw. */
export function syncTitleViews(world: World): void {
  world.query(Title, TitleView).readEach(([title, mounted]) => {
    const view = mounted!;
    const state = title.bodies!;

    for (let index = 0; index < state.pieces.length; index++) {
      view.glyphs.setMatrixAt(state.pieces[index]!.letter.index, view.draw.fromArray(state.matrices, index * 16));
    }
  });
}

/** Apply typing and collapse to prepared, mounted feature glyphs. */
export function syncFeatureViews(world: World): void {
  const collapse = world.get(Collapse)!.hole;

  world.query(Typing, FeatureView).readEach(([typing, mounted]) => {
    const view = mounted!;

    if (collapse.beat === 'closed' && view.collapsed) {
      view.collapsed = false;

      resetLine(view.line, typing.count);
    }

    if (collapse.beat !== 'closed') {
      view.collapsed = true;
      const copies = view.line.glyphs;

      if (copies !== undefined) {
        copies.visible = collapse.beat === 'open';
        copies.updateWorldMatrix(true, false);
        copies.matrixWorld.toArray(lineWorld);
        mat4.invert(lineInverse, lineWorld);
        const records = view.line.records;

        for (let index = 0; index < records.length; index++) {
          const glyph = records[index]!;

          if (glyph.empty) continue;

          // Only what had been typed flies in: play, with the tagline off, sends nothing.
          if (glyph.cluster >= typing.count) {
            copies.setMatrixAt(glyph.index, view.line.hidden);
            continue;
          }

          vec3.transformMat4(center, glyph.center, lineWorld);
          const x = center[0] - collapse.x;
          const y = center[1] - collapse.y;
          const glyphPose = flight(path, collapse.time, departureAt(Math.abs(x) / 12, glyph.index), 0.8);
          const cosine = Math.cos(glyphPose.turn);
          const sine = Math.sin(glyphPose.turn);
          center[0] = collapse.x + (x * cosine - y * sine) * glyphPose.radius;
          center[1] = collapse.y + (x * sine + y * cosine) * glyphPose.radius;
          vec3.transformMat4(center, center, lineInverse);
          mat4.fromTranslation(transform, center);
          mat4.fromZRotation(turn, glyphPose.turn);
          mat4.multiply(transform, transform, turn);
          vec3.set(scale, glyphPose.size * glyphPose.stretch, glyphPose.size / glyphPose.stretch, 1);
          mat4.scale(transform, transform, scale);
          vec3.set(center, -glyph.center[0], -glyph.center[1], 0);
          mat4.fromTranslation(pivot, center);
          mat4.multiply(transform, transform, pivot);
          mat4.multiply(transform, transform, glyph.original);
          copies.setMatrixAt(glyph.index, view.line.draw.fromArray(transform));
        }
      }

      return;
    }

    showLine(view.line, typing.count);
  });
}
