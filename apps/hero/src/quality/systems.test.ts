import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { qualityActions } from './actions';
import { LEAST_SCALE } from './content';
import { budgetFrame } from './systems';
import { Quality } from './traits';

function run(world: ReturnType<typeof createWorld>, seconds: number, interval: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += interval) {
    world.set(Time, { delta: Math.min(interval, 0.1), raw: interval });
    budgetFrame(world);
  }
}

it('sheds resolution while frames run late, then asks for the lite tier, which a cut grants', () => {
  const world = createWorld(Time, Quality);

  try {
    run(world, 3, 1 / 60);
    expect(world.get(Quality)!.scale).toBe(1);
    run(world, 2.5, 1 / 30);
    expect(world.get(Quality)!.scale).toBeLessThan(1);
    expect(world.get(Quality)!.tier).toBe('full');
    run(world, 12, 1 / 30);
    expect(world.get(Quality)!.scale).toBe(LEAST_SCALE);
    expect(world.get(Quality)!.pendingTier).toBe('lite');
    expect(world.get(Quality)!.tier).toBe('full');
    expect(qualityActions(world).grantPendingTier()).toBe(true);
    expect(world.get(Quality)!.tier).toBe('lite');
  } finally {
    world.destroy();
  }
});

it('gives resolution back when frames are on time again, and reads a stalled tab as nothing', () => {
  const world = createWorld(Time, Quality);

  try {
    run(world, 2.5, 1 / 30);
    const shed = world.get(Quality)!.scale;
    expect(shed).toBeLessThan(1);
    // A hidden tab: one frame a second.
    run(world, 30, 1);
    expect(world.get(Quality)!.scale).toBe(shed);
    run(world, 40, 1 / 60);
    expect(world.get(Quality)!.scale).toBe(1);
  } finally {
    world.destroy();
  }
});
