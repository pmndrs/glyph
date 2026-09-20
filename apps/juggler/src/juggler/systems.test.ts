import { createWorld, type World } from 'koota';
import { expect, it } from 'vitest';
import { FIRST_RELEASE_DELAY, RELEASE_INTERVAL, letterActions } from '../letters/actions';
import {
  ageLetters,
  explodeLetters,
  fallLetters,
  moveDebris,
  releaseInterval,
  releaseLetters,
  scrollParagraph,
  seatLetters,
} from '../letters/systems';
import { Debris, Letter, Paragraph, Release, Sentence } from '../letters/traits';
import { Time } from '../time/traits';
import { updateTime } from '../time/systems';
import { jugglerActions } from './actions';
import { catchLetters, chaseLandings, moveHands } from './systems';
import { Hand, Juggler, Viewport } from './traits';
import { HAND_OFFSET_X, figure, handOffsetX } from './utils';

const WIDTH = 1280;
const HEIGHT = 800;
const DT = 1 / 120;
const { catchY, shoulderY } = figure(HEIGHT);

function createJuggling(): World {
  const world = createWorld(Time, Viewport, Sentence, Release, Paragraph, Debris, Juggler);
  jugglerActions(world).setViewport(WIDTH, HEIGHT);
  jugglerActions(world).spawnJuggler();

  return world;
}

/** The simulation systems in frame-loop order. */
function step(world: World, dt: number): void {
  updateTime(world, dt);
  ageLetters(world);
  releaseLetters(world);
  fallLetters(world);
  chaseLandings(world);
  catchLetters(world);
  moveHands(world);
  scrollParagraph(world);
  seatLetters(world);
  explodeLetters(world);
  moveDebris(world);
}

function run(world: World, seconds: number, each?: (world: World) => void): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    step(world, DT);
    each?.(world);
  }
}

/** Types a sentence and seats its letters along the top the way a centred layout would. */
function typeSentence(world: World, sentence: string): void {
  const start = world.get(Sentence)!.text.length;
  const { typeCharacter, placeLetter } = letterActions(world);

  for (const [offset, char] of [...sentence].entries()) {
    typeCharacter(char);

    if (char !== ' ') placeLetter(start + offset, (offset - sentence.length / 2) * 30 + WIDTH / 2 - 48, -28, 0);
  }
}

function letters(world: World) {
  return [...world.query(Letter)].map((entity) => entity.get(Letter)!).sort((a, b) => a.index - b.index);
}

function hand(world: World, side: 'left' | 'right') {
  return [...world.query(Hand)].map((entity) => entity.get(Hand)!).find((hand) => hand.side === side)!;
}

it('juggles a short word with his stats and never lets a live letter pass the hands', () => {
  const world = createJuggling();
  typeSentence(world, 'GLYPH');
  run(world, 20, (world) => {
    for (const letter of letters(world)) {
      if (letter.state === 'airborne' && letter.vy <= 0) expect(letter.y).toBeGreaterThanOrEqual(catchY);
    }
  });

  const all = letters(world);
  expect(all).toHaveLength(5);
  expect(all.every((letter) => letter.state === 'airborne' || letter.state === 'held')).toBe(true);
  expect(all.every((letter) => letter.catches > 1)).toBe(true);
  expect(world.get(Juggler)!.dropped).toBe(0);
});

it('drops letters when a burst of forty overwhelms him, and each dropped letter explodes on the floor', () => {
  const world = createJuggling();
  const { floorY, topY } = figure(HEIGHT);
  typeSentence(world, Array.from({ length: 40 }, (_, index) => String.fromCharCode(65 + (index % 26))).join(''));
  let shards = 0;

  run(world, 45, (world) => {
    shards = Math.max(shards, world.get(Debris)!.count);

    for (const letter of letters(world)) {
      expect(letter.y).toBeGreaterThanOrEqual(floorY);
      expect(letter.y).toBeLessThanOrEqual(topY + 40);
    }
  });

  const all = letters(world);
  expect(world.get(Juggler)!.dropped).toBeGreaterThan(0);
  expect(shards).toBeGreaterThan(0);
  expect(all.filter((letter) => letter.state === 'dead')).toHaveLength(0);
  expect(all.length).toBeLessThan(40);
  expect(world.get(Debris)!.count).toBe(0);
});

it('catches only within his grip', () => {
  const world = createJuggling();
  jugglerActions(world).setStats({ speed: 10 });
  typeSentence(world, 'A');
  letterActions(world).placeLetter(0, WIDTH / 2 - 48 + 400, -28, 0);

  run(world, 4);
  expect(world.get(Juggler)!.dropped).toBe(1);
  expect(letters(world)).toHaveLength(0);
});

it('releases letters in sentence order with a hop, and runs to stand under the first one', () => {
  const world = createJuggling();
  typeSentence(world, 'CAB');

  run(world, FIRST_RELEASE_DELAY + DT);
  const [c, a, b] = letters(world);
  expect(c!.state).toBe('airborne');
  expect(c!.vy).toBeGreaterThan(0);
  expect(a!.state).toBe('queued');
  expect(b!.state).toBe('queued');

  let caught = false;

  run(world, 5, (world) => {
    const [first] = letters(world);

    if (caught || first!.catches === 0) return;

    caught = true;
    // He may lean toward the other hand's next catch by up to the reach slack, and the hand has already carried the
    // letter inward by at most one step.
    const { x, reach, handSpeed } = world.get(Juggler)!;
    expect(Math.abs(x + handOffsetX(first!.target) - first!.x)).toBeLessThan(reach * 0.6 + handSpeed * DT + 1);
  });

  expect(caught).toBe(true);
});

it('reaches the free hand toward its incoming letter while the body waits under the other', () => {
  const world = createJuggling();
  typeSentence(world, 'AB');
  const { placeLetter } = letterActions(world);
  placeLetter(0, WIDTH / 2 - 48 - 200, -28, 0);
  placeLetter(1, WIDTH / 2 - 48 + 200, -28, 0);
  let extended = false;

  run(world, 4, (world) => {
    const [first] = letters(world);

    if (extended || first!.catches === 0) return;

    extended = true;
    // Both letters are airborne; the body stands under A while the right hand stretches toward B.
    expect(hand(world, 'right').x - (world.get(Juggler)!.x + HAND_OFFSET_X)).toBeGreaterThan(15);
  });

  expect(extended).toBe(true);
});

it('releases faster while many letters wait', () => {
  expect(releaseInterval(6)).toBe(RELEASE_INTERVAL);
  expect(releaseInterval(18)).toBeLessThan(RELEASE_INTERVAL / 2);
  expect(releaseInterval(60)).toBe(0.1);
});

it('waves for input once nothing is in play', () => {
  const world = createJuggling();
  run(world, 3);
  expect(hand(world, 'right').y).toBeGreaterThan(shoulderY);
  expect(hand(world, 'left').y).toBeLessThan(shoulderY);
});

it('deletes the newest character and frees the hand holding its letter', () => {
  const world = createJuggling();
  typeSentence(world, 'AB');
  const { deleteCharacter } = letterActions(world);

  run(world, 2);
  expect(letters(world)[0]!.state).not.toBe('queued');
  deleteCharacter();
  expect(letters(world).map((letter) => letter.char)).toEqual(['A']);
  expect(world.get(Sentence)!.text).toBe('A');

  run(world, 2);
  deleteCharacter();
  expect(letters(world)).toHaveLength(0);
  expect([...world.query(Hand)].every((entity) => entity.get(Hand)!.holding === undefined)).toBe(true);
  deleteCharacter();
  expect(world.get(Sentence)!.text).toBe('');
});
