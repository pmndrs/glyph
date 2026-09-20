import { expect, it } from 'vitest';

import {
  HAND_OFFSET_X,
  HAND_SPEED,
  RELEASE_INTERVAL,
  createJugglerWorld,
  figure,
  handOffsetX,
  placeLetter,
  removeLetter,
  stepJugglerWorld,
  typeLetter,
  type JugglerWorld,
} from './juggler';

const WIDTH = 1280;
const HEIGHT = 800;
const DT = 1 / 120;

function run(world: JugglerWorld, seconds: number, each?: (world: JugglerWorld) => void): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    stepJugglerWorld(world, DT);
    each?.(world);
  }
}

/** Types a sentence and spreads its letters along the top the way a centred layout would. */
function typeSentence(world: JugglerWorld, sentence: string): void {
  const { topY } = figure(HEIGHT);
  for (const [index, char] of [...sentence].entries()) {
    if (char === ' ') continue;
    typeLetter(world, char, index);
    placeLetter(world, index, (index - sentence.length / 2) * 30, topY);
  }
}

it('catches every letter and never lets one pass the hands', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const { catchY } = figure(HEIGHT);
  typeSentence(world, 'GLYPH JUGGLER');

  run(world, 25, ({ letters }) => {
    for (const letter of letters) {
      // A falling letter never passes the hands; a rising one may start from a hand mid-scoop.
      if (letter.state === 'airborne' && letter.vy <= 0) expect(letter.y).toBeGreaterThanOrEqual(catchY);
    }
  });

  expect(world.letters).toHaveLength(12);
  expect(world.letters.every((letter) => letter.state !== 'queued')).toBe(true);
  expect(world.letters.every((letter) => letter.catches > 0)).toBe(true);
});

it('keeps up with a burst of forty letters', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const { catchY, topY } = figure(HEIGHT);
  typeSentence(world, Array.from({ length: 40 }, (_, index) => String.fromCharCode(65 + (index % 26))).join(''));

  run(world, 45, ({ letters }) => {
    for (const letter of letters) {
      if (letter.state === 'airborne' && letter.vy <= 0) expect(letter.y).toBeGreaterThanOrEqual(catchY);
      expect(letter.y).toBeLessThanOrEqual(topY + 40);
    }
  });

  expect(world.letters.filter((letter) => letter.state === 'queued')).toHaveLength(0);
  expect(world.letters.every((letter) => letter.catches > 1)).toBe(true);
});

it('releases letters in sentence order with a hop, and runs to stand under the first one', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  typeSentence(world, 'CAB');
  const [c, a, b] = world.letters;

  run(world, RELEASE_INTERVAL + DT);
  expect(c!.state).toBe('airborne');
  expect(c!.vy).toBeGreaterThan(0);
  expect(c!.released).toBeGreaterThanOrEqual(0);
  expect(a!.state).toBe('queued');
  expect(b!.state).toBe('queued');

  let caught = false;
  run(world, 5, ({ juggler }) => {
    if (caught || c!.catches === 0) return;
    caught = true;
    // On the catch frame the hand has already carried the letter inward by at most one step.
    expect(Math.abs(juggler.x + handOffsetX(c!.target) - c!.x)).toBeLessThan(HAND_SPEED * DT + 1);
  });
  expect(caught).toBe(true);
});

it('reaches the free hand toward its incoming letter while the body waits under the other', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const { topY } = figure(HEIGHT);
  const first = typeLetter(world, 'A', 0);
  placeLetter(world, 0, -200, topY);
  typeLetter(world, 'B', 1);
  placeLetter(world, 1, 200, topY);

  let extended = false;
  run(world, 3, ({ juggler }) => {
    if (extended || first.catches === 0) return;
    extended = true;
    // Both letters are airborne; the body stands under A while the right hand stretches toward B.
    expect(juggler.hands.right.x - (juggler.x + HAND_OFFSET_X)).toBeGreaterThan(15);
  });
  expect(extended).toBe(true);
});

it('waves for input once nothing is in play', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const { shoulderY } = figure(HEIGHT);
  run(world, 3);
  expect(world.juggler.hands.right.y).toBeGreaterThan(shoulderY);
  expect(world.juggler.hands.left.y).toBeLessThan(shoulderY);
});

it('removes a letter by sentence offset and frees the hand holding it', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  typeSentence(world, 'AB');
  const [first, second] = world.letters;

  run(world, 1);
  expect(first!.state).not.toBe('queued');
  expect(removeLetter(world, 1)).toBe(second);
  expect(world.letters).toEqual([first]);

  run(world, 2);
  expect(removeLetter(world, 0)).toBe(first);
  expect(world.letters).toHaveLength(0);
  expect(Object.values(world.juggler.hands).every((hand) => hand.holding === undefined)).toBe(true);
  expect(removeLetter(world, 5)).toBeUndefined();
});
