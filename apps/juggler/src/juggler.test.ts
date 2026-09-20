import { expect, it } from 'vitest';

import {
  createJugglerWorld,
  deleteLetter,
  figure,
  handOffsetX,
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

it('catches every letter and never lets one pass the hands', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const { catchY } = figure(HEIGHT);
  for (const char of 'GLYPHJUGGLER') typeLetter(world, char);

  run(world, 25, ({ letters }) => {
    for (const letter of letters) expect(letter.y).toBeGreaterThanOrEqual(catchY);
  });

  expect(world.letters).toHaveLength(12);
  expect(world.letters.every((letter) => letter.state !== 'queued')).toBe(true);
  expect(world.letters.every((letter) => letter.catches > 0)).toBe(true);
});

it('keeps up with a burst of forty letters', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const { catchY, topY } = figure(HEIGHT);
  for (let index = 0; index < 40; index += 1) typeLetter(world, String.fromCharCode(65 + (index % 26)));

  run(world, 45, ({ letters }) => {
    for (const letter of letters) {
      expect(letter.y).toBeGreaterThanOrEqual(catchY);
      expect(letter.y).toBeLessThanOrEqual(topY + 1);
    }
  });

  expect(world.letters.filter((letter) => letter.state === 'queued')).toHaveLength(0);
  expect(world.letters.every((letter) => letter.catches > 1)).toBe(true);
});

it('runs to stand under the first letter before it lands', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const letter = typeLetter(world, 'A');
  typeLetter(world, 'B');
  typeLetter(world, 'C');

  let caught = false;
  run(world, 5, ({ juggler }) => {
    if (caught || letter.catches === 0) return;
    caught = true;
    expect(Math.abs(juggler.x + handOffsetX(letter.target) - letter.x)).toBeLessThan(1);
  });
  expect(caught).toBe(true);
});

it('deletes the newest queued letter first, then letters in play', () => {
  const world = createJugglerWorld(WIDTH, HEIGHT);
  const first = typeLetter(world, 'A');
  const second = typeLetter(world, 'B');

  run(world, 1);
  expect(first.state).not.toBe('queued');
  expect(deleteLetter(world)).toBe(second);
  expect(world.letters).toEqual([first]);

  run(world, 2);
  expect(deleteLetter(world)).toBe(first);
  expect(world.letters).toHaveLength(0);
  expect(Object.values(world.juggler.hands).every((hand) => hand.holding === undefined)).toBe(true);
  expect(deleteLetter(world)).toBeUndefined();
});
