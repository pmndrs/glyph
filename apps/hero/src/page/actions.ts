import { createActions } from 'koota';
import { clamp } from 'math';
import { jitter } from '../utils';
import { COLUMN_RANGE } from './content';
import { BodyView, DropCap, Letterpress, Script, Spread, type BodyDraw } from './traits';
import {
  BODY,
  BODY_WIDTH_RANGE,
  REST,
  RETURNING,
  SPRING,
  SWALLOWED,
  createManuscript,
  currentOffset,
  type Letters,
} from './utils';

export const pageActions = createActions((world) => ({
  /** Ask for a column count. The gutters spring to it. */
  setColumns: (columns: number) => {
    world.set(Spread, { columnsTarget: clamp(columns, COLUMN_RANGE.min, COLUMN_RANGE.max), held: false });
  },
  /** A hand on a gutter: the count follows it exactly, fraction and all. */
  holdColumns: (columns: number) => {
    const spread = world.get(Spread)!;
    const held = clamp(columns, COLUMN_RANGE.min, COLUMN_RANGE.max);

    if (held === spread.columns && spread.held) return;

    world.set(Spread, {
      columns: held,
      columnsTarget: held,
      columnsVelocity: 0,
      held: true,
      geometry: spread.geometry + 1,
    });
  },
  /** A hand on the page's edge. */
  holdWidth: (width: number) => {
    const spread = world.get(Spread)!;
    const held = clamp(width, BODY_WIDTH_RANGE.min, BODY_WIDTH_RANGE.max);

    if (held === spread.width && spread.held) return;

    world.set(Spread, { width: held, widthTarget: held, widthVelocity: 0, held: true, geometry: spread.geometry + 1 });
  },
  /** Let go: the count settles on the nearest whole column. */
  releaseSpread: () => {
    const spread = world.get(Spread)!;
    world.set(Spread, { held: false, columnsTarget: Math.round(spread.columns) });
  },
  setPageWidth: (width: number) => {
    world.set(Spread, { widthTarget: clamp(width, BODY_WIDTH_RANGE.min, BODY_WIDTH_RANGE.max), held: false });
  },
  setPageLight: (light: number, immediately = false) => {
    world.set(Spread, immediately ? { light, lightTarget: light } : { lightTarget: light });
  },
  setInk: (ink: number, immediately = false) => {
    world.set(Spread, immediately ? { ink, inkTarget: ink } : { inkTarget: ink });
  },
  setBodyMode: (mode: 'detached' | 'direct') => {
    world.set(Spread, { mode });
  },
  /** The body has been split into letters: take them and the text they came from. */
  adoptLetters: (original: string, letters: Letters, capHeight: number) => {
    for (let index = 0; index < letters.count; index++) {
      letters.stiffness[index] = 520 + 460 * jitter(index * 7 + 3);
      letters.targetX[index] = letters.x[index]!;
      letters.targetY[index] = letters.y[index]!;
    }

    world.set(Letterpress, letters);
    world.set(Script, createManuscript(original));
    world.set(DropCap, { size: capHeight });
  },
  /** The visitor's typing changed the text under the letters. */
  markScriptStale: () => {
    world.get(Script)!.stale = true;
  },
  /**
   * Take a letter out of its line: its character leaves the text by an exact edit, so the paragraph closes over
   * the gap, and the letter itself is handed to whoever moves it next.
   */
  removeLetter: (index: number) => {
    const letters = world.get(Letterpress)!;
    const script = world.get(Script)!;
    const original = letters.cluster[index]!;

    if (script.removed[original] === 1) return;

    const start = currentOffset(script, original);
    script.edits.push({ start, end: start + 1, insert: '' });
    script.removed[original] = 1;
    script.removedCount++;
    script.revision++;

    if (letters.state[index] === REST) letters.moving++;

    letters.state[index] = BODY;
  },
  /** A letter in the stone is drawn at nothing until it is given back. */
  swallowLetter: (index: number) => {
    const letters = world.get(Letterpress)!;
    letters.state[index] = SWALLOWED;
    letters.scale[index] = 0;
    letters.flush[index] = 1;
  },
  /**
   * Give a letter back: its character returns to the text at the offset it left, the paragraph opens to receive
   * it, and from `startAt` the letter is carried to wherever the layout now puts it.
   */
  restoreLetter: (index: number, startAt: number) => {
    const letters = world.get(Letterpress)!;
    const script = world.get(Script)!;
    const original = letters.cluster[index]!;

    if (script.removed[original] === 0) return;

    const start = currentOffset(script, original);
    script.edits.push({ start, end: start, insert: script.original[original]! });
    script.removed[original] = 0;
    script.removedCount--;
    script.revision++;
    letters.state[index] = RETURNING;
    letters.startAt[index] = startAt;
    letters.vx[index] = 0;
    letters.vy[index] = 0;
  },
  /** Put every moving letter where it belongs, now: for a cut, or a visitor who asked for less motion. */
  settleLetters: () => {
    const letters = world.get(Letterpress)!;

    for (let index = 0; index < letters.count; index++) {
      const state = letters.state[index]!;

      if (state !== SPRING && state !== RETURNING) continue;

      letters.x[index] = letters.targetX[index]!;
      letters.y[index] = letters.targetY[index]!;
      letters.vx[index] = 0;
      letters.vy[index] = 0;
      letters.angle[index] = 0;
      letters.scale[index] = 1;
      letters.state[index] = REST;
      letters.flush[index] = 1;
      letters.moving--;
    }
  },
  mountBodyView: (view: BodyDraw) => {
    world.set(BodyView, view);
  },
  unmountBodyView: () => {
    world.set(BodyView, undefined);
  },
}));
