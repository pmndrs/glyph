import type { World } from 'koota';
import { Time } from './traits';

/** Accumulate a bounded delta so a background tab does not fling every letter through the floor on return. */
export function updateTime(world: World, delta: number): void {
  const time = world.get(Time)!;
  time.delta = Math.min(delta, 1 / 20);
  time.elapsed += time.delta;
  world.set(Time, time);
}
