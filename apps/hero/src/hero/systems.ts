import type { World } from 'koota';
import { sequenceActions } from '../sequence/actions';
import { iconFieldActions } from '../icon-field/actions';
import { Robot } from '../robot/traits';
import { Title } from '../letters/traits';
import { PaperView, Viewport } from './traits';
import { Time } from '../time/traits';
import { PATTERN_ANGLE } from '../icon-field/content';

export function sampleViewport(world: World, width: number, height: number, cameraZ: number, aspect: number): void {
  world.set(Viewport, { width, height, cameraZ, aspect });
}

/** Scroll the mounted paper with the foreground icon field. */
export function updatePaper(world: World): void {
  const drift = world.get(PaperView);

  if (drift === undefined) return;

  const distance = 3.2 * (30 / 22) * world.get(Time)!.elapsed;
  drift.set(Math.cos(PATTERN_ANGLE) * distance, Math.sin(PATTERN_ANGLE) * distance);
}

/** Feed robot departure into the hero script. */
export function triggerRobotDeparture(world: World): void {
  world.query(Robot).readEach(([robot]) => {
    if (robot.departed) sequenceActions(world).triggerSequence('robot-departed');
  });
}

/** Turn letter landings into field impacts and script events. */
export function applyLetterLandings(world: World): void {
  world.query(Title).readEach(([title]) => {
    const bodies = title.bodies;

    if (bodies === undefined || bodies.landingCount === 0) return;

    for (let slot = 0; slot < bodies.landingCount; slot++) {
      const landing = bodies.landings[slot]!;
      iconFieldActions(world).impactIconFields(landing.x, landing.y, 0);
    }

    sequenceActions(world).triggerSequence('letters-landed');
  });
}
