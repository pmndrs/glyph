import type { World } from 'koota';
import { Frame } from './sequence/traits';
import { advanceSequence } from './sequence/systems';
import { moveRobots, emitDust } from './robot/systems';
import { moveTitle, typeFeature } from './typography/systems';
import { moveFields } from './field/systems';

/** Application order is explicit and usable without React, a DOM, or a renderer. */
export function advanceHero(world: World, delta: number, now: number): void {
  const frame = world.get(Frame)!;
  frame.now = now;
  frame.delta = frame.ready ? Math.min(delta, 0.1) : 0;
  if (!frame.ready) return;
  frame.elapsed += frame.delta;
  moveRobots(world);
  advanceSequence(world);
  moveTitle(world);
  typeFeature(world);
  moveFields(world);
  emitDust(world);
}
