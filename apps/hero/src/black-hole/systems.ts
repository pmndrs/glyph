import { Viewport } from '../hero/traits';
import type { World } from 'koota';
import { Time } from '../time/traits';
import { Collapse, BlackHoleView, type HoleState } from './traits';
import {
  HOLE_CENTER,
  HORIZON,
  POP_AT,
  PAPER_FROM,
  PAPER_UNTIL,
  HORIZON_ON_PLANE,
  PLAY_REACH,
  GLYPH_GROWTH,
  LETTER_GROWTH,
  FINALE_JOIN,
  WIND_SECONDS,
} from './content';
import { clamp, lerp, vec3, type Vec3 } from 'math';
import { easing } from 'math/time';
import { Title } from '../letters/traits';
import { letterActions } from '../letters/actions';
import { Rain } from '../rain/traits';
import { rainActions } from '../rain/actions';
import { physicsActions } from '../physics/actions';
import { Body } from '../physics/traits';
import { blackHoleActions } from './actions';
import { swirl } from './utils';

export function advanceCollapse(world: World): void {
  const collapse = world.get(Collapse)!;
  const { now, delta } = world.get(Time)!;

  if (collapse.openedAt !== undefined) {
    collapseAt(collapse.hole, (now - collapse.openedAt) / 1000, collapse.x, collapse.y, collapse.joinedPull);
  } else if (collapse.playSince !== undefined) {
    // The hole eases up to the width its meals have earned it.
    const grown = lerp(collapse.playGrown, collapse.playHorizon, 1 - Math.exp(-delta / 0.35));
    world.set(Collapse, { playGrown: grown });
    playHoleAt(
      collapse.hole,
      (now - collapse.playSince) / 1000,
      grown,
      (now - collapse.fedAt) / 1000,
      collapse.x,
      collapse.y,
    );
  } else collapseAt(collapse.hole, -1, HOLE_CENTER[0], HOLE_CENTER[1]);
}

/**
 * Play's little hole at `x, y`, `t` seconds after appearing, `horizon` wide once open, `sinceFed` seconds after
 * its last meal: a meal is a gulp, the hole swelling past its size and settling back, its pull flinching with it.
 * Pure, like the finale's beat.
 */
export function playHoleAt(
  out: HoleState,
  t: number,
  horizon: number,
  sinceFed: number,
  x: number,
  y: number,
): HoleState {
  const open = easing.cubicOut(ramp(t, 0, 0.5));
  const gulp = sinceFed >= 0 && sinceFed < 3 ? Math.exp(-sinceFed * 4.5) * Math.sin(sinceFed * 19) * 0.3 : 0;
  out.beat = 'play';
  out.time = t;
  out.x = x;
  out.y = y;
  out.horizon = horizon * open * (1 + gulp);
  // Its pull, which bends the glass nearby, grows with it.
  out.pull = (0.12 + 0.45 * (horizon / HORIZON)) * open * (1 + gulp * 2);
  out.presence = open * (1 + gulp * 0.6);
  out.sincePop = undefined;
  out.blackout = 0;

  return out;
}

const pull = vec3.create();

/** A current `inward` toward the hole and `across` round it, for a body `dx, dy` from it, `distance` out. */
function spiral(out: Vec3, dx: number, dy: number, distance: number, inward: number, across: number): Vec3 {
  return vec3.set(
    out,
    (dx / distance) * inward - (dy / distance) * across,
    (dy / distance) * inward + (dx / distance) * across,
    0,
  );
}

/**
 * Play's field at a body `distance` out, given how far it reaches: nothing beyond it. Most of the field is an
 * orbit, a speed round the hole that quickens toward it, and the inward pull under it is a creep that is next to
 * nothing far out and grows only near, so a body settles into going round and round before it is much nearer. The
 * whole current fades in from nothing at the field's edge, where the furthest bodies feel only a tug. The orbit gives out over the last
 * horizons, where the pull becomes a rush, so nothing settles just outside. Bodies on the paper are held by
 * friction, so the field is a current that sets their speed rather than a force they would have to overcome.
 * `pace` scales the whole current for heavier bodies.
 */
function fieldCurrent(
  out: Vec3,
  dx: number,
  dy: number,
  distance: number,
  horizon: number,
  reach: number,
  pace: number,
): Vec3 {
  const near = 1 - Math.min(distance / reach, 1);
  const orbit = swirl(distance / horizon, 1);
  // The field fades in from nothing at its edge, so the furthest bodies are tugged rather than caught.
  const faint = Math.min(near * 3, 1);
  const across = lerp(1.8, 4.5, near) * orbit * faint * pace;
  const inward = (lerp(0.03, 0.5, near ** 3) * faint + 14 * (1 - orbit) ** 2) * pace;

  return spiral(out, dx, dy, distance, inward, across);
}

/** The finale's field: a rush in, and round, a full spiral far out and none at the horizon. */
function finaleCurrent(out: Vec3, dx: number, dy: number, distance: number, horizon: number, speed: number): Vec3 {
  const round = swirl(distance / horizon, 1.05);
  const inward = speed / Math.hypot(1, round);

  return spiral(out, dx, dy, distance, inward, inward * round);
}

/**
 * Feed the hole. In play, whatever lies in its gravity field is drawn in, faster the nearer, and whatever crosses
 * the horizon is eaten, which widens the hole and its field, rain by a little and a letter by more, until it is
 * the finale's hole and the finale begins, joined already open. Through the finale the hole draws in and eats the
 * rain too, and the pop takes whatever is left.
 */
export function feedHole(world: World): void {
  const collapse = world.get(Collapse)!;
  const hole = collapse.hole;

  if (hole.beat === 'closed') return;

  const physics = physicsActions(world);
  const rain = world.get(Rain);
  const finale = hole.beat !== 'play';
  const reach = finale ? Number.POSITIVE_INFINITY : hole.horizon * PLAY_REACH;
  // How far the finale has wound, squared so it begins where play's slow field left off and gathers pace: what the
  // hole holds keeps its place for a beat, then spirals in hard, at full speed well before the pop.
  const wind = clamp((hole.time - FINALE_JOIN) / WIND_SECONDS, 0, 1) ** 2;
  let growth = 0;

  if (rain !== undefined) {
    for (let slot = 0; slot < rain.drops.length; slot++) {
      const drop = rain.drops[slot]!;

      if (drop.phase !== 'live') continue;

      if (hole.beat === 'black') {
        rainActions(world).dismissDrop(slot, false);
        continue;
      }

      // The field lies on the paper: rain still falling passes over it until it lands, on the paper or on glass.
      if (!finale && drop.z > 1.2) continue;

      const dx = hole.x - drop.x;
      const dy = hole.y - drop.y;
      const distance = Math.hypot(dx, dy);

      // Overlapping the horizon is enough to be eaten: a glyph is about half its size across.
      if (distance < hole.horizon + drop.size * 0.45) {
        rainActions(world).eatDrop(slot);
        growth += GLYPH_GROWTH;
      } else if (distance < reach) {
        physics.kickBody(
          drop.entity!,
          finale
            ? finaleCurrent(pull, dx, dy, distance, hole.horizon, lerp(3, 26, wind))
            : fieldCurrent(pull, dx, dy, distance, hole.horizon, reach, 1),
        );
      }
    }
  }

  // The sequence's finale draws the title in on its own clock. Play's hole, and the finale it grows into, carry the
  // letters on the field they are already riding, which turns from an orbit into a spiral as the pull builds.
  if (!finale || collapse.fromPlay) {
    const title = world.queryFirst(Title)?.get(Title)?.bodies;

    if (title !== undefined) {
      for (let index = 0; index < title.pieces.length; index++) {
        if (title.swallowed[index] === 1) continue;

        const body = title.pieces[index]!.entity.get(Body)!;

        if (body.mode !== 'dynamic') continue;

        const dx = hole.x - body.position[0];
        const dy = hole.y - body.position[1];
        const distance = Math.hypot(dx, dy);

        // A letter lying over the hole is eaten once its centre comes near.
        if (distance < hole.horizon + 0.5) {
          letterActions(world).eatLetter(index, hole.time);
          growth += LETTER_GROWTH;
        } else if (distance < reach) {
          // A letter is heavy: the same field carries it at two thirds the pace. Through the finale the orbit
          // becomes a spiral that gathers pace with the finale, so the letters wind in rather than leaving at once.
          physics.kickBody(
            title.pieces[index]!.entity,
            finale
              ? finaleCurrent(pull, dx, dy, distance, hole.horizon, lerp(1.2, 16, wind) * 0.65)
              : fieldCurrent(pull, dx, dy, distance, hole.horizon, reach, 0.65),
          );
        }
      }
    }
  }

  if (!finale) {
    if (growth > 0) blackHoleActions(world).growPlayHole(growth);

    // The handover waits for the drawn hole, easing after its meals, to reach the finale's horizon, so nothing jumps.
    if (world.get(Collapse)!.playGrown >= HORIZON * 0.98) blackHoleActions(world).openBlackHole(FINALE_JOIN);
  }
}

/** Fraction of the way from `from` to `to`, clamped. */
function ramp(t: number, from: number, to: number): number {
  return clamp((t - from) / (to - from), 0, 1);
}

/**
 * The beat `t` seconds after the hole opened at `x, y`, its pull rising from `joinedPull`, what play's hole had
 * built by the handover, to full. Pure, so the timing can be tested without a scene.
 */
export function collapseAt(out: HoleState, t: number, x: number, y: number, joinedPull = 0): HoleState {
  out.time = t;
  out.x = x;
  out.y = y;

  if (t < 0) {
    out.beat = 'closed';
    out.time = -1;
    out.horizon = HORIZON;
    out.pull = 0;
    out.presence = 0;
    out.sincePop = undefined;
    out.blackout = 0;

    return out;
  }

  const open = easing.cubicOut(ramp(t, 0, 0.4));
  const swell = 1 + 0.6 * easing.sineInOut(ramp(t, 2.65, POP_AT - 0.1));
  const pinch = easing.cubicIn(ramp(t, POP_AT - 0.1, POP_AT));
  const popped = t >= POP_AT;
  out.beat = popped ? 'black' : 'open';
  out.horizon = HORIZON * open * swell;
  out.pull = popped ? 0 : lerp(joinedPull, 1, easing.cubicIn(ramp(t, 0.65, 2.1)));
  out.presence = popped ? 0 : open * swell * (1 - pinch);
  out.sincePop = popped ? t - POP_AT : undefined;
  out.blackout = popped ? 1 : 0;

  return out;
}

/** GPU publication is a view concern. Simulation only changes the collapse trait. */
export function syncBlackHoleView(world: World): void {
  const view = world.get(BlackHoleView);

  if (view === undefined) return;

  const { group, uniforms } = view;
  const current = world.get(Collapse)!.hole;
  const { width, height, cameraZ } = world.get(Viewport)!;
  uniforms.uHoleCamera.value = cameraZ;
  // The viewport's extent is measured on the floor, where the hole lies, so this is its place on screen.
  uniforms.uHoleScreen.value.set(current.x / width, current.y / height);
  group.visible = current.beat === 'open' || current.beat === 'play';
  // The hole is drawn above the floor: its floor position carried up the camera's ray, so it sits over the field.
  const along = (cameraZ - group.position.z) / cameraZ;
  group.position.x = current.x * along;
  group.position.y = current.y * along;
  uniforms.uPresence.value = current.presence;
  uniforms.uHeat.value = current.pull;
  const size = Math.max(current.horizon / HORIZON_ON_PLANE, 0.001);
  group.scale.set(size, size, 1);
  uniforms.uHoleCenter.value.set(current.x, current.y);
  uniforms.uHoleHorizon.value = Math.max(current.horizon, 0.001);
  uniforms.uHoleBend.value = current.pull;
  uniforms.uHoleBlackout.value = current.blackout;
  // Play's hole never takes the paper; only the finale does.
  uniforms.uHoleCollapse.value =
    current.beat === 'play' ? 0 : easing.cubicIn(clamp((current.time - PAPER_FROM) / (PAPER_UNTIL - PAPER_FROM), 0, 1));
  const t = Math.max(0, current.time);
  uniforms.uHoleSpin.value = t * 1.2 + 3 * t ** 3;
  const shake = current.beat === 'open' ? 0.003 * current.pull * (1 - uniforms.uHoleCollapse.value) : 0;
  uniforms.uHoleShake.value.set(Math.sin(t * 71) * shake, Math.cos(t * 93) * shake);
}
