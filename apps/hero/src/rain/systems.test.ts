import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { Collapse } from '../black-hole/traits';
import { Mode, Viewport } from '../hero/traits';
import { Impacts } from '../icon-paper/traits';
import { physicsActions } from '../physics/actions';
import { stepPhysics } from '../physics/systems';
import { Body } from '../physics/traits';
import { Time } from '../time/traits';
import { updateTime } from '../time/systems';
import { rainActions } from './actions';
import { COUNT, FADE_SECONDS, RAIN_AFTER, RELEASE_Z } from './content';
import { rainGlyphs } from './systems';
import { Rain } from './traits';

const PRISM = [-0.5, -0.5, -0.4, 0.5, -0.5, -0.4, -0.5, 0.5, -0.4, -0.5, -0.5, 0.4, 0.5, -0.5, 0.4, -0.5, 0.5, 0.4];

it('rains pushable glyph bodies a couple of seconds into play, takes them away past the edge, and stops with play', () => {
  const world = createWorld(Time, Mode, Viewport, Impacts, Collapse, Rain);
  const physics = physicsActions(world);
  physics.initializePhysics();
  physics.setPhysicsFloor(-0.4);
  const commands = rainActions(world);
  commands.initializeRain();

  for (let slot = 0; slot < COUNT; slot++) commands.prepareRainGlyph(slot, { prisms: [PRISM] });

  world.set(Viewport, { width: 18, height: 10 });
  world.set(Mode, { kind: 'play', since: 0 });
  const impacts = world.get(Impacts)!.next;
  const drops = () => world.get(Rain)!.drops;
  const live = () => drops().filter((drop) => drop.phase === 'live');
  let now = 0;
  const advance = (seconds: number) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      now += 1000 / 60;
      updateTime(world, 1 / 60, now);
      rainGlyphs(world);
      stepPhysics(world);
    }
  };

  try {
    advance(RAIN_AFTER - 0.1);
    expect(live()).toHaveLength(0);

    advance(0.2);
    expect(live()).toHaveLength(1);
    const first = live()[0]!;
    const body = first.entity!.get(Body)!;
    expect(body.airborne).toBe(true);
    expect(body.stacks).toBe(true);
    expect(first.z).toBeCloseTo(RELEASE_Z, 0);

    // It lands within a couple of seconds and stays as a body on the floor, rippling nothing.
    advance(2.5);
    expect(first.phase).toBe('live');
    expect(first.entity!.get(Body)!.airborne).toBe(false);
    expect(first.z).toBeLessThan(0.1);
    expect(world.get(Impacts)!.next).toBe(impacts);
    expect(live().length).toBeGreaterThan(3);

    // Pushed past the edge, it is taken away at once and its body with it.
    const entity = first.entity!;
    physics.holdBody(entity, { x: 12, y: 0, z: 0, yaw: 0 });
    physics.releaseBody(entity, [0, 0, 0], 0);
    advance(2 / 60);
    expect(first.phase).toBe('idle');
    expect(first.entity).toBeUndefined();
    expect(entity.isAlive()).toBe(false);

    // The pool bounds the physics: once full, the oldest scales away first, and only then does the next drop fall.
    advance(COUNT * 0.6);
    expect(world.get(Rain)!.dropped).toBeGreaterThan(COUNT);
    expect(live().length).toBeLessThanOrEqual(COUNT);
    expect(live().length).toBeGreaterThan(COUNT - 3);
    const oldest = live().reduce((low, drop) => (drop.serial < low.serial ? drop : low));

    for (let frame = 0; frame < 120 && oldest.phase === 'live'; frame++) advance(1 / 60);

    expect(oldest.phase).toBe('fading');
    const count = world.get(Rain)!.dropped;
    advance(FADE_SECONDS / 2);
    expect(oldest.phase).toBe('fading');
    expect(world.get(Rain)!.dropped).toBe(count);
    advance(FADE_SECONDS);
    expect(world.get(Rain)!.dropped).toBe(count + 1);

    // Leaving play fades them all and stops the rain.
    world.set(Mode, { kind: 'sequence', since: 0 });
    advance(1 / 60);
    expect(live()).toHaveLength(0);
    expect(drops().every((drop) => drop.entity === undefined)).toBe(true);
    advance(FADE_SECONDS + 1);
    expect(drops().every((drop) => drop.phase === 'idle')).toBe(true);
  } finally {
    world.destroy();
  }
});
