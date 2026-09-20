import { createActions, type Entity, type TraitRecord } from 'koota';
import { letterActions } from '../letters/actions';
import { Letter } from '../letters/traits';
import { FigureView, Hand, Juggler, Viewport, type FigureDraw } from './traits';
import { figure, handOffsetX } from './utils';

export const jugglerActions = createActions((world) => ({
  setViewport: (width: number, height: number) => {
    world.set(Viewport, { width, height });
  },
  setStats: (stats: Partial<Pick<TraitRecord<typeof Juggler>, 'speed' | 'handSpeed' | 'reach' | 'grip'>>) => {
    world.set(Juggler, { ...world.get(Juggler)!, ...stats });
  },
  spawnJuggler: () => {
    const { catchY } = figure(world.get(Viewport)!.height);
    world.spawn(Hand({ side: 'left', x: handOffsetX('left'), y: catchY }));
    world.spawn(Hand({ side: 'right', x: handOffsetX('right'), y: catchY }));
  },
  /** The hand closes on the letter wherever it is, so the arm stretches as far as the catch needs. */
  holdLetter: (handEntity: Entity, letterEntity: Entity) => {
    letterActions(world).catchLetter(letterEntity);
    const hand = handEntity.get(Hand)!;
    hand.holding = letterEntity;
    hand.heldFor = 0;
    hand.x = letterEntity.get(Letter)!.x;
    hand.y = figure(world.get(Viewport)!.height).catchY;
    handEntity.set(Hand, hand);
  },
  tossLetter: (handEntity: Entity) => {
    const hand = handEntity.get(Hand)!;
    const letter = hand.holding;

    if (letter === undefined) return;

    hand.holding = undefined;
    hand.heldFor = 0;
    handEntity.set(Hand, hand);
    letterActions(world).tossLetter(letter, hand.side, world.get(Juggler)!.x);
  },
  mountFigureView: (view: FigureDraw) => {
    world.set(FigureView, view);
  },
  unmountFigureView: () => {
    world.set(FigureView, undefined);
  },
}));
