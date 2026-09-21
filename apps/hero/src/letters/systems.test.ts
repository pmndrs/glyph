import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { Collapse } from '../black-hole/traits';
import { letterActions } from './actions';
import { typeFeature } from './systems';
import { Typing } from './traits';
import { FEATURE_LINE } from './content';

it('types the tagline in three frames a character and backspaces it out one a frame', () => {
  const world = createWorld(Time, Collapse);
  const commands = letterActions(world);
  commands.spawnLetters();
  const typing = world.queryFirst(Typing)!;
  const count = () => typing.get(Typing)!.count;

  try {
    commands.typeFeatureAfter(0);
    expect(count()).toBe(0);

    for (let frame = 0; frame < 30; frame++) typeFeature(world);

    expect(count()).toBe(10);
    commands.clearFeature();
    expect(count()).toBe(10);

    for (let frame = 0; frame < 4; frame++) typeFeature(world);

    expect(count()).toBe(6);

    for (let frame = 0; frame < 60; frame++) typeFeature(world);

    expect(count()).toBe(0);
    expect(typing.get(Typing)!.leaving).toBe(false);

    // Fully typed, then taken by the hole: nothing is left to backspace.
    commands.typeFeatureAfter(0);

    for (let frame = 0; frame < FEATURE_LINE.length * 3 + 3; frame++) typeFeature(world);

    expect(count()).toBe(FEATURE_LINE.length);
    world.get(Collapse)!.hole.beat = 'black';
    commands.clearFeature();
    expect(count()).toBe(0);
  } finally {
    world.destroy();
  }
});
