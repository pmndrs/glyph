import type { World } from 'koota';
import { Time } from '../time/traits';
import { Pointer } from './traits';

export function samplePointer(world: World, x: number, y: number): void {
  world.set(Pointer, { x, y });
}

export function fadePointer(world: World): void {
  const pointer = world.get(Pointer)!;
  pointer.strength *= Math.exp(-Math.min(world.get(Time)!.delta, 0.05) / 0.16);

  world.set(Pointer, { strength: pointer.strength < 0.01 ? 0 : pointer.strength });
}
