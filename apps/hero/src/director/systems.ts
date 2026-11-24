import type { World } from 'koota';
import { Shot } from '../camera/traits';
import { stoneActions } from '../stone/actions';
import { Stone } from '../stone/traits';
import { Time } from '../time/traits';
import { directorActions } from './actions';
import { IDLE_SECONDS, STONE_PATH, STONE_SPEED } from './content';
import { Grip, Mode } from './traits';

/** Lead the stone along the script's path at a walking pace: dropped at its head, then drawn from point to point. */
export function walkStonePath(world: World): void {
  const mode = world.get(Mode)!;

  if (mode.pathSince < 0) return;

  const stone = stoneActions(world);
  let remaining = (world.get(Time)!.elapsed - mode.pathSince) * STONE_SPEED;

  if (!world.get(Stone)!.present) stone.dropStone(STONE_PATH[0]![0], STONE_PATH[0]![1]);

  for (let index = 0; index + 1 < STONE_PATH.length; index++) {
    const [fromX, fromY] = STONE_PATH[index]!;
    const [toX, toY] = STONE_PATH[index + 1]!;
    const length = Math.hypot(toX - fromX, toY - fromY);

    if (remaining <= length) {
      const along = remaining / length;
      stone.leadStone(fromX + (toX - fromX) * along, fromY + (toY - fromY) * along);

      return;
    }

    remaining -= length;
  }

  const [endX, endY] = STONE_PATH[STONE_PATH.length - 1]!;
  stone.leadStone(endX, endY);
}

/** A page left alone long enough goes back to its attract loop. */
export function resumeAttract(world: World): void {
  const mode = world.get(Mode)!;

  if (mode.kind !== 'play' || world.get(Grip)!.kind !== 'none' || world.get(Shot)!.diveTarget > 0) return;

  if (world.get(Time)!.elapsed - mode.touchedAt > IDLE_SECONDS) directorActions(world).beginAttract();
}
