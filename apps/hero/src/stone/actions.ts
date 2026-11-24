import { createActions } from 'koota';
import { pageActions } from '../page/actions';
import { Letterpress, Script, Spread } from '../page/traits';
import { BODY, BODY_HEIGHT, BODY_ORIGIN, SWALLOWED, columnBoxes, type Box } from '../page/utils';
import { physicsActions } from '../physics/actions';
import { Time } from '../time/traits';
import { REWIND_STAGGER } from './content';
import { Stone, StoneView, Taken, type StoneDraw } from './traits';

const boxes: Box[] = [];

export const stoneActions = createActions((world) => ({
  /** Put the stone on the page at a point, at rest. */
  dropStone: (x: number, y: number) => {
    world.set(Stone, { present: true, x, y, vx: 0, vy: 0, leadX: undefined, leadY: undefined, rewinding: -1 });
    stoneActions(world).fenceBodies();
  },
  /** Lead the stone toward a point: a hand holding it, or the script's path. */
  leadStone: (x: number, y: number) => {
    world.set(Stone, { leadX: x, leadY: y });
  },
  /** Let it go with a velocity, to coast and bounce off the edges of the text. */
  releaseStone: (vx: number, vy: number) => {
    world.set(Stone, { leadX: undefined, leadY: undefined, vx, vy });
  },
  dismissStone: () => {
    world.set(Stone, { present: false, leadX: undefined, leadY: undefined, vx: 0, vy: 0 });
  },
  /**
   * Give back every letter the stone took, last taken first, a beat apart: each character returns to the text by
   * an exact edit and its letter is carried home, out of the stone if it had been swallowed. `immediately` gives
   * them all back at once, for a cut.
   */
  rewindStone: (immediately = false) => {
    const taken = world.get(Taken)!;
    const letters = world.get(Letterpress)!;
    const stone = world.get(Stone)!;
    const { elapsed } = world.get(Time)!;
    const page = pageActions(world);
    const physics = physicsActions(world);

    for (let turn = 0; turn < taken.order.length; turn++) {
      const index = taken.order[taken.order.length - 1 - turn]!;

      if (letters.state[index] === BODY) physics.removeBody(index);
      else if (letters.state[index] === SWALLOWED) {
        letters.x[index] = stone.x - BODY_ORIGIN.x - letters.pivotX[index]!;
        letters.y[index] = stone.y - BODY_ORIGIN.y - letters.pivotY[index]!;
      }

      page.restoreLetter(index, immediately ? elapsed : elapsed + turn * REWIND_STAGGER);
    }

    taken.order.length = 0;
    world.set(Stone, { rewinding: immediately ? -1 : 0, swallowed: 0, appetite: 0 });

    if (immediately) page.settleLetters();
  },
  /**
   * Stand a wall on each column rule and round the text, so loose letters bounce off them. Restated whenever the
   * columns move.
   */
  fenceBodies: () => {
    const spread = world.get(Spread)!;
    const count = columnBoxes(boxes, spread.columns, spread.width, BODY_HEIGHT);
    const left = BODY_ORIGIN.x;
    const top = BODY_ORIGIN.y;
    const right = left + spread.width;
    const bottom = top + BODY_HEIGHT;
    const walls = [
      { left: left - 3, top: top - 3, right: right + 3, bottom: top - 1.2 },
      { left: left - 3, top: bottom + 0.6, right: right + 3, bottom: bottom + 3 },
      { left: left - 3, top: top - 3, right: left - 0.9, bottom: bottom + 3 },
      { left: right + 0.9, top: top - 3, right: right + 3, bottom: bottom + 3 },
    ];

    for (let index = 0; index + 1 < count; index++) {
      const rule = left + (boxes[index]!.right + boxes[index + 1]!.left) / 2;
      walls.push({ left: rule - 0.02, top, right: rule + 0.02, bottom });
    }

    physicsActions(world).setWalls(walls);
    world.set(Stone, { fenced: spread.geometry });
  },
  /** Whether the script still lacks letters the stone took. */
  holdsLetters: () => world.get(Script)!.removedCount > 0,
  mountStoneView: (view: StoneDraw) => {
    world.set(StoneView, view);
  },
  unmountStoneView: () => {
    world.set(StoneView, undefined);
  },
}));
