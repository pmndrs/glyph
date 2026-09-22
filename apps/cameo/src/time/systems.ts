import type { World } from 'koota';
import { Time } from './traits';

/** Sample the frame timestamp and accumulate a bounded playback delta. */
export function updateTime(world: World, delta: number, now: number): void {
  const time = world.get(Time)!;
  time.now = now;
  time.delta = Math.min(delta, 0.1);
  time.elapsed += time.delta;
  world.set(Time, time);
}
