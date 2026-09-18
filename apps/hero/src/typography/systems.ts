import type { World } from 'koota';
import { Time } from '../time/traits';
import type { HoleState } from '../black-hole/motion';
import { FEATURE_LINE } from './content';
import { Title, Typing } from './traits';
import { prepareTitle, titleReach, updateTitle } from './bodies';

export function moveTitle(world: World, hole: HoleState): void {
  const time = world.get(Time)!;

  world.query(Title).updateEach(([title]) => {
    if (title.bodies !== undefined) prepareTitle(world, title.bodies, time.delta, hole);
  });
}

/** Publish poses and this frame's landings for the application to compose. */
export function syncTitle(world: World): void {
  world.query(Title).updateEach(([title]) => {
    if (title.bodies === undefined) return;

    updateTitle(title.bodies);
    title.reach = titleReach(title.bodies);
  });
}

export function typeFeature(world: World): void {
  const time = world.get(Time)!;

  world.query(Typing).updateEach(([typing]) => {
    if (time.now < typing.start) return;

    // Three captured frames per character at the shared 60 Hz update cadence.
    typing.beat++;
    typing.count = Math.min(Math.floor(typing.beat / 3), FEATURE_LINE.length);
  });
}
