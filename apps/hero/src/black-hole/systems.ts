import { Viewport } from '../hero/traits';
import type { World } from 'koota';
import { Time } from '../time/traits';
import { Collapse, BlackHoleView, type HoleState } from './traits';
import { HOLE_CENTER, HORIZON, POP_AT, PAPER_FROM, PAPER_UNTIL, HORIZON_ON_PLANE } from './content';
import { clamp } from 'math';
import { easing } from 'math/time';

export function advanceCollapse(world: World): void {
  const collapse = world.get(Collapse)!;
  collapseAt(collapse.hole, collapse.openedAt === undefined ? -1 : (world.get(Time)!.now - collapse.openedAt) / 1000);
}

/** Fraction of the way from `from` to `to`, clamped. */
function ramp(t: number, from: number, to: number): number {
  return clamp((t - from) / (to - from), 0, 1);
}

/** The beat `t` seconds after the hole opened. Pure, so the timing can be tested without a scene. */
export function collapseAt(out: HoleState, t: number): HoleState {
  out.time = t;
  out.x = HOLE_CENTER[0];
  out.y = HOLE_CENTER[1];

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
  out.pull = popped ? 0 : easing.cubicIn(ramp(t, 0.65, 2.1));
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
  uniforms.uHoleCamera.value = world.get(Viewport)!.cameraZ;
  group.visible = current.beat === 'open';
  uniforms.uPresence.value = current.presence;
  uniforms.uHeat.value = current.pull;
  const size = Math.max(current.horizon / HORIZON_ON_PLANE, 0.001);
  group.scale.set(size, size, 1);
  uniforms.uHoleCenter.value.set(current.x, current.y);
  uniforms.uHoleHorizon.value = Math.max(current.horizon, 0.001);
  uniforms.uHoleBend.value = current.pull;
  uniforms.uHoleBlackout.value = current.blackout;
  uniforms.uHoleCollapse.value = easing.cubicIn(clamp((current.time - PAPER_FROM) / (PAPER_UNTIL - PAPER_FROM), 0, 1));
  const t = Math.max(0, current.time);
  uniforms.uHoleSpin.value = t * 1.2 + 3 * t ** 3;
  const shake = current.beat === 'open' ? 0.003 * current.pull * (1 - uniforms.uHoleCollapse.value) : 0;
  uniforms.uHoleShake.value.set(Math.sin(t * 71) * shake, Math.cos(t * 93) * shake);
}
