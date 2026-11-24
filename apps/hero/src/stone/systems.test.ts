import type { GlyphOutlineContour } from '@pmndrs/glyph';
import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { pageActions } from '../page/actions';
import { springLetters } from '../page/systems';
import { DropCap, Letterpress, Script, Spread } from '../page/traits';
import { BODY_ORIGIN, REST, createLetters, currentText } from '../page/utils';
import { physicsActions } from '../physics/actions';
import { stepPhysics } from '../physics/systems';
import { Physics } from '../physics/traits';
import { Quality } from '../quality/traits';
import { Time } from '../time/traits';
import { stoneActions } from './actions';
import { captureLetters, finishRewind, moveStone, pullBodies } from './systems';
import { Stone, StoneView, Taken } from './traits';

const TEXT = 'letters stand in lines until something heavy lands among them and the lines give way';
/** Every letter's outline: a square a third of an em wide, standing on the baseline. */
const SQUARE = [
  [
    [0, 0, 0, 0, 0.33, 0, true],
    [0.33, 0, 0.33, 0, 0.33, -0.33, true],
    [0.33, -0.33, 0.33, -0.33, 0, -0.33, true],
    [0, -0.33, 0, -0.33, 0, 0, true],
  ],
] as unknown as GlyphOutlineContour[];

/** A world whose letters are the text's non-space characters, set in rows a few units from the page's corner. */
function setUp() {
  const world = createWorld(Time, Quality, Spread, Letterpress, Script, DropCap, Stone, StoneView, Taken, Physics);
  physicsActions(world).initializePhysics();
  const offsets = Array.from(TEXT, (character, index) => (character === ' ' ? -1 : index)).filter(
    (index) => index >= 0,
  );
  const letters = createLetters(offsets.length);

  for (const [index, offset] of offsets.entries()) {
    letters.cluster[index] = offset;
    letters.fontSize[index] = 0.3;
    letters.shape[index] = 1;
    letters.x[index] = 4 + (offset % 20) * 0.32;
    letters.y[index] = 4 + Math.floor(offset / 20) * 0.45;
    letters.pivotX[index] = 0.05;
    letters.pivotY[index] = -0.05;
  }

  letters.outlineAt = () => SQUARE;
  pageActions(world).adoptLetters(TEXT, letters, 1);

  return world;
}

function run(world: ReturnType<typeof createWorld>, seconds: number): void {
  for (let frame = 0; frame < seconds * 60; frame++) {
    world.set(Time, { delta: 1 / 60, elapsed: world.get(Time)!.elapsed + 1 / 60 });
    moveStone(world);
    captureLetters(world);
    stepPhysics(world);
    pullBodies(world);
    finishRewind(world);
    springLetters(world);
  }
}

it('takes letters out of the text as bodies, and the rewind gives every one back where it left', () => {
  const world = setUp();

  try {
    stoneActions(world).dropStone(BODY_ORIGIN.x + 7, BODY_ORIGIN.y + 5);
    run(world, 2.5);
    const script = world.get(Script)!;
    const letters = world.get(Letterpress)!;
    const taken = script.removedCount;

    expect(taken).toBeGreaterThan(5);
    expect(world.get(Taken)!.order).toHaveLength(taken);
    // Exactly one edit a letter, each removing one character, leaves the text the script accounts for.
    expect(script.edits).toHaveLength(taken);
    expect(currentText(script)).toHaveLength(TEXT.length - taken);
    expect(currentText(script).replaceAll(' ', '').length).toBe(letters.count - taken);
    // The first letter is the drop cap, which stays.
    expect(script.removed[0]).toBe(0);
    expect(world.get(Physics)!.bodies.size + world.get(Stone)!.swallowed).toBe(taken);

    const applied = script.edits.reduce(
      (text, edit) => text.slice(0, edit.start) + edit.insert + text.slice(edit.end),
      TEXT,
    );
    expect(applied).toBe(currentText(script));
    script.edits.length = 0;

    stoneActions(world).rewindStone();
    stoneActions(world).dismissStone();
    run(world, 6);

    expect(currentText(script)).toBe(TEXT);
    expect(
      script.edits.reduce((text, edit) => text.slice(0, edit.start) + edit.insert + text.slice(edit.end), applied),
    ).toBe(TEXT);
    expect(world.get(Physics)!.bodies.size).toBe(0);
    expect(world.get(Stone)!.rewinding).toBe(-1);
    expect(letters.moving).toBe(0);

    for (let index = 0; index < letters.count; index++) {
      expect(letters.state[index]).toBe(REST);
      expect(letters.x[index]).toBe(letters.targetX[index]);
      expect(letters.scale[index]).toBe(1);
    }
  } finally {
    world.destroy();
  }
});

it('takes nothing while the paragraph is drawn whole for editing', () => {
  const world = setUp();

  try {
    pageActions(world).setBodyMode('direct');
    stoneActions(world).dropStone(BODY_ORIGIN.x + 7, BODY_ORIGIN.y + 5);
    run(world, 1.5);
    expect(world.get(Script)!.removedCount).toBe(0);
  } finally {
    world.destroy();
  }
});
