import type { World } from 'koota';
import { Time } from '../time/traits';
import { Collapse, type HoleState } from './traits';
import { HOLE_CENTER, HORIZON, POP_AT } from './content';
import { clamp } from 'math';
import { easing } from 'math/time';

export function advanceCollapse(world: World): void {
  const collapse = world.get(Collapse)!;
  collapseAt(
    collapse.hole,
    collapse.held ?? (collapse.openedAt === undefined ? -1 : (world.get(Time)!.now - collapse.openedAt) / 1000),
  );
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
