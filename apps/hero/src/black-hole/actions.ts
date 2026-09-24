import { createActions } from 'koota';
import { Time } from '../time/traits';
import { Collapse, BlackHoleView, type BlackHoleDraw } from './traits';
import { collapseAt } from './utils';
import { FINALE_JOIN, HOLE_CENTER, HORIZON, PLAY_HORIZON, PLAY_OFFSET } from './content';

export const blackHoleActions = createActions((world) => ({
  mountBlackHoleView: (view: BlackHoleDraw) => {
    world.add(BlackHoleView(view));
  },
  unmountBlackHoleView: () => {
    world.remove(BlackHoleView);
  },
  /**
   * Open the finale. Play's hole hands over here, joining the finale's timeline where that hole is already open,
   * where it is and with the pull it has built; the sequence's finale opens at the centre from nothing.
   */
  openBlackHole: () => {
    const collapse = world.get(Collapse)!;

    if (collapse.openedAt === undefined) {
      const handover = collapse.playSince !== undefined;
      world.set(Collapse, {
        openedAt: world.get(Time)!.now - (handover ? FINALE_JOIN : 0) * 1000,
        playSince: undefined,
        joinedPull: handover ? collapse.hole.pull : 0,
        fromPlay: handover,
        ...(handover ? {} : { x: HOLE_CENTER[0], y: HOLE_CENTER[1] }),
      });
    }
  },
  /** Play's little hole appears, small, waiting to be fed, at `at` or somewhere off the centre. */
  openPlayHole: (at?: { readonly x: number; readonly y: number }) => {
    const collapse = world.get(Collapse)!;

    if (collapse.openedAt === undefined && collapse.playSince === undefined) {
      world.set(Collapse, {
        x: at?.x ?? HOLE_CENTER[0] + (Math.random() * 2 - 1) * PLAY_OFFSET[0],
        y: at?.y ?? HOLE_CENTER[1] + (Math.random() * 2 - 1) * PLAY_OFFSET[1],
        playSince: world.get(Time)!.now,
        playHorizon: PLAY_HORIZON,
        playGrown: PLAY_HORIZON,
        fedAt: Number.NEGATIVE_INFINITY,
      });
    }
  },
  /** Feeding widens play's hole, up to the finale's horizon, with a gulp. */
  growPlayHole: (amount: number) => {
    const collapse = world.get(Collapse)!;
    world.set(Collapse, {
      playHorizon: Math.min(collapse.playHorizon + amount, HORIZON),
      fedAt: world.get(Time)!.now,
    });
  },
  dismissBlackHole: () => {
    const collapse = world.get(Collapse)!;
    world.set(Collapse, {
      openedAt: undefined,
      playSince: undefined,
      playHorizon: 0,
      playGrown: 0,
      x: HOLE_CENTER[0],
      y: HOLE_CENTER[1],
      joinedPull: 0,
      fromPlay: false,
    });
    collapseAt(collapse.hole, -1, HOLE_CENTER[0], HOLE_CENTER[1]);
  },
}));
