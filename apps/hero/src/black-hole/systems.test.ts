import { createWorld } from 'koota';
import { mat4 } from 'math';
import { Group } from 'three/webgpu';
import { expect, it } from 'vitest';
import { Mode, Viewport } from '../hero/traits';
import { Impacts } from '../icon-paper/traits';
import { letterActions } from '../letters/actions';
import { moveTitle, syncTitle } from '../letters/systems';
import { physicsActions } from '../physics/actions';
import { Body } from '../physics/traits';
import { stepPhysics } from '../physics/systems';
import { playReveal } from '../play-button/systems';
import { REVEAL_AFTER, REVEAL_SECONDS } from '../play-button/content';
import { rainActions } from '../rain/actions';
import { COUNT, RAIN_AFTER } from '../rain/content';
import { rainGlyphs } from '../rain/systems';
import { Rain } from '../rain/traits';
import { starEmberActions } from '../star-embers/actions';
import { syncStarEmbers } from '../star-embers/systems';
import { EMBER_SECONDS, StarEmbers } from '../star-embers/traits';
import { Time } from '../time/traits';
import { updateTime } from '../time/systems';
import { blackHoleActions } from './actions';
import { FINALE_JOIN, GLYPH_GROWTH, HORIZON, PLAY_HORIZON, PLAY_REACH, POP_AT } from './content';
import { holeUniforms } from './materials';
import { advanceCollapse, feedHole, syncBlackHoleView } from './systems';
import { Collapse } from './traits';

const PRISM = [-0.5, -0.5, -0.4, 0.5, -0.5, -0.4, -0.5, 0.5, -0.4, -0.5, -0.5, 0.4, 0.5, -0.5, 0.4, -0.5, 0.5, 0.4];

it('opens small in play, grows as it eats the rain pushed to it, then becomes the finale and ends at the button', () => {
  const world = createWorld(Time, Mode, Viewport, Impacts, Collapse, StarEmbers, Rain);
  const physics = physicsActions(world);
  physics.initializePhysics();
  physics.setPhysicsFloor(-0.4);
  starEmberActions(world).initializeStarEmbers();
  const rain = rainActions(world);
  rain.initializeRain();

  for (let slot = 0; slot < COUNT; slot++) rain.prepareRainGlyph(slot, { prisms: [PRISM] });

  world.set(Viewport, { width: 18, height: 10 });
  world.set(Mode, { kind: 'play', since: 0 });
  const hole = () => world.get(Collapse)!.hole;
  let now = 0;
  const advance = (seconds: number) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      now += 1000 / 60;
      updateTime(world, 1 / 60, now);
      advanceCollapse(world);
      syncStarEmbers(world);
      stepPhysics(world);
      rainGlyphs(world);
      feedHole(world);
    }
  };

  try {
    advance(RAIN_AFTER + 1);
    expect(hole().beat).toBe('closed');
    blackHoleActions(world).openPlayHole({ x: 1.5, y: -0.5 });
    advance(1);
    expect(hole().beat).toBe('play');
    // Rain may already have fallen into it, and a gulp swings either way, so it is about as wide as it opened.
    expect(hole().horizon).toBeGreaterThan(PLAY_HORIZON * 0.6);
    expect(hole().horizon).toBeLessThan(HORIZON);
    expect(hole().blackout).toBe(0);

    // A glyph pushed to the hole is eaten and widens it; one further out is left to the player.
    const live = () => world.get(Rain)!.drops.filter((drop) => drop.phase === 'live');
    expect(live().length).toBeGreaterThan(1);
    const [near, far] = live();
    const before = world.get(Collapse)!.playHorizon;
    physics.holdBody(near!.entity!, { x: 1.6, y: -0.5, z: 0, yaw: 0 });
    physics.releaseBody(near!.entity!, [0, 0, 0], 0);
    physics.holdBody(far!.entity!, { x: 6, y: 4, z: 0, yaw: 0 });
    physics.releaseBody(far!.entity!, [0, 0, 0], 0);
    advance(3 / 60);
    expect(near!.phase).toBe('eaten');
    expect(far!.phase).toBe('live');
    expect(world.get(Collapse)!.playHorizon).toBeCloseTo(before + GLYPH_GROWTH);

    // The meal is a gulp: the hole swells past its new size, then settles at whatever width it has earned.
    let swollen = 0;

    for (let frame = 0; frame < 12; frame++) {
      advance(1 / 60);
      swollen = Math.max(swollen, hole().horizon);
    }

    expect(swollen).toBeGreaterThan(before + GLYPH_GROWTH);
    advance(1.5);
    expect(Math.abs(hole().horizon - world.get(Collapse)!.playHorizon)).toBeLessThan(0.03);

    // A glyph well inside the field, but a few horizons out, is carried round the hole and only creeps nearer: in
    // two seconds it has swung about a quarter turn and is still live, well outside the horizon. One out at the
    // field's edge is only tugged, swinging a fraction as far over the same two seconds.
    const reach = hole().horizon * PLAY_REACH;
    const [orbiting, distant] = [live()[1]!, live()[2]!];
    type Drop = ReturnType<typeof live>[number];
    const place = (drop: Drop, out: number) => {
      physics.holdBody(drop.entity!, { x: 1.5 + out, y: -0.5, z: 0, yaw: 0 });
      physics.releaseBody(drop.entity!, [0, 0, 0], 0);
    };
    const swungBy = (drop: Drop) => Math.abs(Math.atan2(drop.y - hole().y, drop.x - hole().x));
    place(orbiting, reach * 0.5);
    place(distant, reach * 0.85);
    advance(2);
    const nearer = Math.hypot(orbiting.x - hole().x, orbiting.y - hole().y);
    expect(orbiting.phase).toBe('live');
    expect(swungBy(orbiting)).toBeGreaterThan(1.2);
    expect(nearer).toBeLessThan(reach * 0.5);
    expect(nearer).toBeGreaterThan(hole().horizon * 2);
    expect(distant.phase).toBe('live');
    expect(swungBy(distant)).toBeGreaterThan(0.01);
    expect(swungBy(distant)).toBeLessThan(swungBy(orbiting) * 0.4);

    // Fed to the finale's horizon, the finale begins already open, without the hole shrinking to reopen.
    while (world.get(Collapse)!.openedAt === undefined) {
      const next = live()[0];

      if (next === undefined) {
        advance(1);
        continue;
      }

      physics.holdBody(next.entity!, { x: 1.6, y: -0.5, z: 0, yaw: 0 });
      physics.releaseBody(next.entity!, [0, 0, 0], 0);
      advance(3 / 60);
    }

    expect(hole().beat).toBe('open');
    // The finale, and everything drawn about the hole, stays where play's hole was.
    expect(hole().x).toBeCloseTo(1.5);
    expect(hole().y).toBeCloseTo(-0.5);
    const group = new Group();
    group.position.z = 5;
    world.set(Viewport, { cameraZ: 16 });
    blackHoleActions(world).mountBlackHoleView({ group, uniforms: holeUniforms });
    syncBlackHoleView(world);
    // Drawn above the floor, the hole is carried up the camera's ray so it sits over the field on screen.
    expect(group.position.x).toBeCloseTo((1.5 * 11) / 16);
    expect(holeUniforms.uHoleCenter.value.x).toBeCloseTo(1.5);
    expect(holeUniforms.uHoleScreen.value.x).toBeCloseTo(1.5 / 18);
    expect(holeUniforms.uHoleScreen.value.y).toBeCloseTo(-0.5 / 10);
    blackHoleActions(world).unmountBlackHoleView();
    expect(hole().time).toBeGreaterThanOrEqual(FINALE_JOIN);
    expect(hole().horizon).toBeGreaterThanOrEqual(HORIZON * 0.98);
    // The finale carries on from play's pull rather than starting again from nothing.
    const joined = hole().pull;
    expect(joined).toBeGreaterThan(0.25);
    advance(0.5);
    expect(hole().pull).toBeGreaterThanOrEqual(joined);

    // The finale runs to the pop, takes what rain is left, and the button appears while play is still the mode.
    advance(POP_AT);
    expect(hole().beat).toBe('black');
    expect(live()).toHaveLength(0);
    advance(EMBER_SECONDS + REVEAL_AFTER + REVEAL_SECONDS + 0.1);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(playReveal(world)).toBeCloseTo(1);
  } finally {
    world.destroy();
  }
});

it("holds the letters where they are when play's hole goes critical, then spirals them in before the pop", () => {
  const world = createWorld(Time, Mode, Viewport, Impacts, Collapse, StarEmbers, Rain);
  const physics = physicsActions(world);
  physics.initializePhysics();
  letterActions(world).spawnLetters();
  world.set(Viewport, { width: 18, height: 10 });
  world.set(Mode, { kind: 'play', since: 0 });
  const homes = [-3, -1, 1, 3].map((x) => ({
    home: [x, 1.5, 0.5] as const,
    solid: { prisms: [PRISM] },
    index: 0,
    original: mat4.create(),
  }));
  const title = letterActions(world).prepareTitle(
    mat4.create(),
    homes.map((letter, index) => ({ ...letter, index })),
    10,
    1,
    1,
  );
  letterActions(world).settleTitle();
  const hole = () => world.get(Collapse)!.hole;
  const at = (index: number) => title.pieces[index]!.entity.get(Body)!.position;
  let now = 0;
  const advance = (seconds: number) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      now += 1000 / 60;
      updateTime(world, 1 / 60, now);
      advanceCollapse(world);
      moveTitle(world);
      stepPhysics(world);
      syncTitle(world);
      feedHole(world);
    }
  };

  try {
    blackHoleActions(world).openPlayHole({ x: 0, y: -2 });
    advance(1);
    const before = homes.map((_, index) => [at(index)[0], at(index)[1]] as const);
    blackHoleActions(world).openBlackHole(FINALE_JOIN);
    advance(0.5);

    // Half a second after it goes critical every letter is still out there, drifting.
    const held = homes.map((_, index) =>
      Math.hypot(at(index)[0] - before[index]![0], at(index)[1] - before[index]![1]),
    );

    for (const index of homes.keys()) expect(title.swallowed[index]).toBe(0);

    // As the pull builds they wind in, covering far more ground than they did while it was holding them, and each
    // ends up nearer the hole than it began.
    const paused = homes.map((_, index) => [at(index)[0], at(index)[1]] as const);
    advance(1.2);

    for (let index = 0; index < homes.length; index++) {
      const moved = Math.hypot(at(index)[0] - paused[index]![0], at(index)[1] - paused[index]![1]);
      const start = Math.hypot(before[index]![0] - hole().x, before[index]![1] - hole().y);
      expect(moved).toBeGreaterThan(held[index]! * 3);
      expect(Math.hypot(at(index)[0] - hole().x, at(index)[1] - hole().y)).toBeLessThan(start);
    }

    advance(POP_AT);
    expect([...title.swallowed].every((taken) => taken === 1)).toBe(true);
  } finally {
    world.destroy();
  }
});
