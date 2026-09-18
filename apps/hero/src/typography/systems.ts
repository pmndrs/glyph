import type { World } from 'koota';
import { FEATURE_LINE } from './content';
import { Frame, Sequence } from '../sequence/traits';
import { sequenceActions } from '../sequence/actions';
import { Title, Typing } from './traits';
import { prepareTitle, titleReach, updateTitle } from './bodies';

export function moveTitle(world: World): void {
  const frame = world.get(Frame)!;
  const hole = world.get(Sequence)!.hole;

  world.query(Title).updateEach(([title]) => {
    if (title.bodies !== undefined) prepareTitle(world, title.bodies, frame.delta, hole);
  });
}

export function syncTitle(world: World): void {
  world.query(Title).updateEach(([title]) => {
    if (title.bodies === undefined) return;

    updateTitle(title.bodies);
    title.reach = titleReach(title.bodies);

    for (let slot = 0; slot < title.bodies.landingCount; slot++) {
      const landing = title.bodies.landings[slot]!;
      sequenceActions(world).impact(landing.x, landing.y, 0);
    }
  });
}

export function typeFeature(world: World): void {
  const sequence = world.get(Sequence)!;

  if (sequence.hole.beat !== 'closed') return;

  const shock = sequence.impacts[sequence.latestImpact];
  const frame = world.get(Frame)!;

  world.query(Typing).updateEach(([typing]) => {
    if (shock !== undefined && shock.id !== typing.wave) {
      typing.wave = shock.id;
      typing.start = shock.at + 550;
      typing.beat = 0;
      typing.count = 0;
    }

    if (frame.now < typing.start) return;

    // Three captured frames per character at the shared 60 Hz update cadence.
    typing.beat++;
    typing.count = Math.min(Math.floor(typing.beat / 3), FEATURE_LINE.length);
  });
}
