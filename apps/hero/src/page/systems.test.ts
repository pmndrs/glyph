import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { Quality } from '../quality/traits';
import { Stone } from '../stone/traits';
import { Time } from '../time/traits';
import { pageActions } from './actions';
import { springLetters, springSpread } from './systems';
import { DropCap, Letterpress, Script, Spread } from './traits';
import { REST, SPRING, createLetters } from './utils';

function run(world: ReturnType<typeof createWorld>, seconds: number, step: () => void): void {
  for (let frame = 0; frame < seconds * 60; frame++) {
    world.set(Time, { delta: 1 / 60, elapsed: world.get(Time)!.elapsed + 1 / 60 });
    step();
  }
}

it('springs the gutters to a new column count, and restates the flow only while they move', () => {
  const world = createWorld(Time, Quality, Spread, Stone);

  try {
    pageActions(world).setColumns(2);
    const before = world.get(Spread)!.geometry;
    run(world, 0.3, () => springSpread(world));
    const midway = world.get(Spread)!;
    expect(midway.columns).toBeLessThan(3);
    expect(midway.columns).toBeGreaterThan(2);
    expect(midway.geometry).toBeGreaterThan(before);
    run(world, 4, () => springSpread(world));
    expect(world.get(Spread)!.columns).toBe(2);
    const settled = world.get(Spread)!.geometry;
    run(world, 1, () => springSpread(world));
    expect(world.get(Spread)!.geometry).toBe(settled);
  } finally {
    world.destroy();
  }
});

it('lets go of a dragged gutter onto the nearest whole column', () => {
  const world = createWorld(Time, Quality, Spread, Stone);

  try {
    pageActions(world).holdColumns(3.62);
    expect(world.get(Spread)!.columns).toBe(3.62);
    pageActions(world).releaseSpread();
    run(world, 4, () => springSpread(world));
    expect(world.get(Spread)!.columns).toBe(4);
  } finally {
    world.destroy();
  }
});

it('carries a displaced letter to its target and leaves it at rest exactly there', () => {
  const world = createWorld(Time, Quality, Spread, Stone, Letterpress, Script, DropCap);

  try {
    pageActions(world).adoptLetters('ab', createLetters(2), 1);
    const letters = world.get(Letterpress)!;
    letters.targetX[1] = 6;
    letters.targetY[1] = -2;
    letters.state[1] = SPRING;
    letters.moving = 1;
    run(world, 0.1, () => springLetters(world));
    expect(letters.x[1]).toBeGreaterThan(0);
    expect(letters.state[1]).toBe(SPRING);
    run(world, 3, () => springLetters(world));
    expect(letters.state[1]).toBe(REST);
    expect(letters.x[1]).toBe(6);
    expect(letters.y[1]).toBe(-2);
    expect(letters.moving).toBe(0);
    expect(letters.x[0]).toBe(0);
  } finally {
    world.destroy();
  }
});
