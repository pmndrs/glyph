import type { World } from 'koota';
import { FEATURE_LINE } from '../content';
import { Frame, Sequence } from '../sequence/traits';
import { sequenceActions } from '../sequence/actions';
import { Robot } from '../robot/traits';
import { Title, Typing } from './traits';
import { titleReach, updateTitle } from './bodies';

export function moveTitle(world: World): void {
  const frame = world.get(Frame)!;
  const robot = world.queryFirst(Robot)?.get(Robot);
  const footprint = robot?.active ? robot.footprint : undefined;
  const hole = world.get(Sequence)!.hole;
  for (const entity of world.query(Title)) {
    const title = entity.get(Title)!;
    if (title.bodies === undefined) continue;
    updateTitle(title.bodies, frame.delta, footprint, hole);
    title.reach = titleReach(title.bodies);
    for (let slot = 0; slot < title.bodies.landingCount; slot++) {
      const landing = title.bodies.landings[slot]!;
      sequenceActions(world).impact(landing.x, landing.y, 0);
    }
  }
}

export function typeFeature(world: World): void {
  const sequence = world.get(Sequence)!;
  if (sequence.hole.beat !== 'closed') return;
  const shock = sequence.impacts[sequence.latestImpact];
  const frame = world.get(Frame)!;
  for (const entity of world.query(Typing)) {
    const typing = entity.get(Typing)!;
    if (shock !== undefined && shock.id !== typing.wave) {
      typing.wave = shock.id;
      typing.start = shock.at + 550;
      typing.beat = 0;
      typing.count = 0;
    }
    if (frame.now < typing.start) continue;
    // Three captured frames per character at the shared 60 Hz update cadence.
    typing.beat++;
    typing.count = Math.min(Math.floor(typing.beat / 3), FEATURE_LINE.text.length);
  }
}
