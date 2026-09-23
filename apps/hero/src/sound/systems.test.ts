import { rigidBody } from 'crashcat';
import { createWorld, type World } from 'koota';
import { mat4 } from 'math';
import { expect, it } from 'vitest';
import { Collapse } from '../black-hole/traits';
import { advanceCollapse, feedHole } from '../black-hole/systems';
import { heroActions } from '../hero/actions';
import { applyLetterLandings, triggerRobotDeparture } from '../hero/systems';
import { Mode, Viewport } from '../hero/traits';
import { Impacts } from '../icon-paper/traits';
import { Keys, Pointer } from '../input/traits';
import { letterActions } from '../letters/actions';
import { FEATURE_LINE } from '../letters/content';
import { moveTitle, syncTitle, typeFeature } from '../letters/systems';
import { stepPhysics } from '../physics/systems';
import { Body, Physics } from '../physics/traits';
import { rainActions } from '../rain/actions';
import { COUNT } from '../rain/content';
import { rainGlyphs } from '../rain/systems';
import { Rain } from '../rain/traits';
import { driveRobots, faceLetters, moveRobotBodies, moveRobots } from '../robot/systems';
import { Robot } from '../robot/traits';
import { sequenceActions } from '../sequence/actions';
import { advanceSequence } from '../sequence/systems';
import { Timeline } from '../sequence/traits';
import { syncStarEmbers } from '../star-embers/systems';
import { updateTime } from '../time/systems';
import { Time } from '../time/traits';
import { listenForSounds } from './systems';
import { Sound, type SoundCue } from './traits';

type Heard = SoundCue & { at: number };

/** A glyph of rain: a thin triangular slab. */
const PANE = [-0.5, -0.5, -0.4, 0.5, -0.5, -0.4, -0.5, 0.5, -0.4, -0.5, -0.5, 0.4, 0.5, -0.5, 0.4, -0.5, 0.5, 0.4];

const CUBE = [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, 0.5, 0.5,
];

function scene(): World {
  const world = createWorld(Time, Keys, Pointer, Viewport, Mode, Timeline, Collapse, Impacts);
  heroActions(world).initializeHero();
  heroActions(world).setViewport(18, 10, 16, 1.8);

  return world;
}

/** Run the frame loop's simulation for `seconds`, draining each frame's cues into `heard` as the mixer would. */
function simulate(world: World, seconds: number, heard: Heard[], each?: () => void): void {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    updateTime(world, 1 / 60, world.get(Time)!.now + 1000 / 60);
    advanceSequence(world);
    moveRobots(world);
    driveRobots(world);
    triggerRobotDeparture(world);
    advanceSequence(world);
    advanceCollapse(world);
    syncStarEmbers(world);
    moveTitle(world);
    moveRobotBodies(world);
    stepPhysics(world);
    syncTitle(world);
    applyLetterLandings(world);
    advanceSequence(world);
    typeFeature(world);
    rainGlyphs(world);
    feedHole(world);
    listenForSounds(world);
    const queue = world.get(Sound)!.queue;
    const at = world.get(Time)!.elapsed;

    for (let index = 0; index < queue.count; index++) heard.push({ ...queue.cues[index]!, at });

    queue.count = 0;
    each?.();
  }
}

it('hears the lift, each letter landing on its note, the typed tagline, the greeting, and the finale', () => {
  const world = scene();
  letterActions(world).prepareTitle(
    mat4.create(),
    [
      { home: [-2, 0, 0.5], solid: { prisms: [CUBE] }, index: 0, original: mat4.create() },
      { home: [2, 0, 0.5], solid: { prisms: [CUBE] }, index: 1, original: mat4.create() },
    ],
    10,
    1,
    1,
  );
  const robot = world.queryFirst(Robot)!;
  const heard: Heard[] = [];
  let driving = 0;
  let greeting = 0;
  let open = 0;
  let black = 0;
  const climb: [time: number, rise: number][] = [];
  const voices = (from = 0) => heard.slice(from).map(({ voice }) => voice);

  try {
    // The opening lift a second in draws breath, then both letters land, each on its own note.
    simulate(world, 1.1, heard);
    expect(voices()).toEqual(['whoosh']);

    simulate(world, 1.4, heard);
    const landings = heard.filter(({ voice }) => voice === 'thud');
    const notes = heard.filter(({ voice }) => voice === 'chime');
    expect(landings).toHaveLength(2);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.rate).not.toBe(notes[1]!.rate);
    expect(notes.map(({ at }) => at)).toEqual(landings.map(({ at }) => at));

    // The tagline types in, a note a letter. The robot drives over with its motor running, stops, says each
    // letter its face prints, and drives off, and the hole opens behind it with a gulp, its drones climbing right up
    // to the pop.
    simulate(world, 16, heard, () => {
      const current = robot.get(Robot)!;
      const { motor, drone, rise } = world.get(Sound)!;
      const hole = world.get(Collapse)!.hole;

      if (current.active && current.face !== undefined && faceLetters(current.face) > 0)
        greeting = Math.max(greeting, motor);
      else if (current.active) driving = Math.max(driving, motor);

      if (hole.beat === 'open' && hole.time > 1) open = Math.max(open, drone);
      if (hole.beat === 'open') climb.push([hole.time, rise]);
      if (hole.beat === 'black') black = Math.max(black, drone);
    });
    const all = voices();
    const gulp = all.indexOf('gulp');
    const boom = all.indexOf('boom');
    expect(all.slice(0, gulp).filter((voice) => voice === 'doo')).toHaveLength(
      [...FEATURE_LINE].filter((character) => /\p{L}/u.test(character)).length,
    );
    const face = heard.slice(0, gulp).filter(({ voice }) => voice === 'speech');
    expect(face.map(({ take }) => take)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(driving).toBeGreaterThan(0.3);
    expect(greeting).toBe(0);
    expect(gulp).toBeGreaterThan(0);
    expect(boom).toBeGreaterThan(gulp);
    expect(all.filter((voice) => voice === 'gulp' || voice === 'boom')).toHaveLength(2);
    expect(open).toBeGreaterThan(0.3);
    // The drones only ever climb while the hole is open, and go on climbing after its pull is full, to the pop.
    const late = climb.find(([time]) => time >= 2.5)![1];
    expect(climb.every(([, rise], index) => index === 0 || rise >= climb[index - 1]![1])).toBe(true);
    expect(climb.at(-1)![1]).toBeGreaterThan(Math.max(0.95, late + 0.15));
    expect(black).toBe(0);

    // The embers sparkle from their burst: two faint sprays either side of the hole. Once the embers have gone out,
    // the Play button powers up.
    const popped = heard[boom]!.at;
    const sparkles = heard.filter(({ voice }) => voice === 'sparkle');
    expect(sparkles.map(({ at, take }) => [at, take])).toEqual([
      [popped, 0],
      [popped, 1],
    ]);
    expect(sparkles[0]!.pan).toBeLessThan(sparkles[1]!.pan);
    expect(sparkles.every(({ gain }) => gain < 0.3)).toBe(true);
    expect(voices(heard.indexOf(sparkles[1]!) + 1)).toEqual(Array(6).fill('blip'));
  } finally {
    world.destroy();
  }
});

it('plays a fanfare into play, taps each press, and runs the motor only while the robot drives', () => {
  const world = scene();
  const heard: Heard[] = [];
  let driving = 0;
  let resting = 1;

  try {
    heroActions(world).pressHero(0.2, 0.1);
    simulate(world, 1 / 60, heard);
    expect(heard.map(({ voice }) => voice).sort()).toEqual(['chime', 'chime', 'chime', 'chime', 'tap']);

    simulate(world, 5, heard, () => {
      const { drive } = world.queryFirst(Robot)!.get(Robot)!;
      const { motor } = world.get(Sound)!;

      if (drive.hasTarget) driving = Math.max(driving, motor);
      else resting = Math.min(resting, motor);
    });
    expect(driving).toBeGreaterThan(0.5);
    expect(resting).toBe(0);
    // A beat into play the little hole opens with a deep gulp, and once the robot has rested it looks up and says
    // its greeting a syllable a letter.
    const later = heard.slice(5);
    expect(later.filter(({ voice }) => voice !== 'speech').map(({ voice }) => voice)).toEqual(['gulp']);
    expect(later.filter(({ voice }) => voice === 'speech').map(({ take }) => take)).toEqual([0, 1, 2, 3, 4, 5]);

    const pressed = heard.length;
    heroActions(world).pressHero(-0.3, -0.2);
    simulate(world, 1 / 60, heard);
    expect(heard.slice(pressed).map(({ voice }) => voice)).toEqual(['tap']);
  } finally {
    world.destroy();
  }
});

it('rings each glyph of rain once as it comes down, whether on the floor, the glass, or another glyph', () => {
  const world = scene();
  letterActions(world).prepareTitle(
    mat4.create(),
    [-6, -3, 0, 3, 6].map((x, index) => ({
      home: [x, 0, 0.5] as const,
      solid: { prisms: [CUBE] },
      index,
      original: mat4.create(),
    })),
    10,
    1,
    1,
  );

  for (let slot = 0; slot < COUNT; slot++) rainActions(world).prepareRainGlyph(slot, { prisms: [PANE] });

  const engine = world.get(Physics)!.engine;
  const heard: Heard[] = [];
  // The solver's own fall speed for each glyph, fastest first. Under gravity alone a glyph only falls faster, so one
  // whose fall suddenly slows has come down on something.
  const fastest = new Map<number, number>();
  const down = new Set<number>();
  let above = 0;

  try {
    heroActions(world).pressHero(0, -0.9);
    // Play's script would open its little hole somewhere at random, so it stays shut here and the rain is the same
    // every run.
    sequenceActions(world).loadSequence([]);
    simulate(world, 9, heard, () => {
      for (const drop of world.get(Rain)!.drops) {
        if (drop.phase !== 'live') continue;

        const fall = -rigidBody.get(engine, drop.entity!.get(Body)!.id)!.motionProperties.linearVelocity[2];

        if (fall < (fastest.get(drop.serial) ?? 0) - 1) down.add(drop.serial);

        fastest.set(drop.serial, Math.max(fall, fastest.get(drop.serial) ?? 0));
      }
    });

    // Some glyphs came to rest on the glass or on one another, and those never reach the floor first.
    for (const drop of world.get(Rain)!.drops) if (drop.phase === 'live' && drop.z > 0.9 && drop.z < 3) above++;

    // The fanfare rang on the press; every chime after it is rain.
    const rain = heard.filter(({ voice, at }) => voice === 'chime' && at > heard[0]!.at);
    expect(above).toBeGreaterThan(0);
    expect(down.size).toBeGreaterThan(10);
    expect(rain).toHaveLength(down.size);
  } finally {
    world.destroy();
  }
});
