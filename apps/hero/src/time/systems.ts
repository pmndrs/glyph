import type { World } from 'koota';
import { Time } from './traits';

/** Advance playback time only while the application is ready. */
export function updateTime(world: World, delta: number, now: number, running: boolean): void {
  const time = world.get(Time)!;
  time.now = now;
  time.delta = running ? Math.min(delta, 0.1) : 0;
  time.elapsed += time.delta;
}
