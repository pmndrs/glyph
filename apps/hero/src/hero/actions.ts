import { createActions } from 'koota';
import { blackHoleActions } from '../black-hole/actions';
import { iconFieldActions } from '../icon-field/actions';
import { letterActions } from '../letters/actions';
import { physicsActions } from '../physics/actions';
import { robotActions } from '../robot/actions';
import { sequenceActions } from '../sequence/actions';
import { starEmberActions } from '../star-embers/actions';
import { Preparation, Viewport } from './traits';

export const heroActions = createActions((world) => ({
  initializeHero: () => {
    physicsActions(world).initializePhysics();
    starEmberActions(world).initializeStarEmbers();
    robotActions(world).spawnRobot();
    letterActions(world).spawnLetters();
    iconFieldActions(world).spawnIconFields();

    sequenceActions(world).loadSequence([
      { at: 1, run: () => heroActions(world).replayHero() },
      { on: 'letters-landed', after: 0.55, run: () => letterActions(world).typeFeatureAfter(0) },
      { on: 'letters-landed', after: 1.4, run: () => robotActions(world).runRobot() },
      { on: 'robot-departed', run: () => blackHoleActions(world).openBlackHole() },
    ]);
  },
  replayHero: () => {
    sequenceActions(world).cancelSequence();
    blackHoleActions(world).dismissBlackHole();
    starEmberActions(world).sampleStarEmbers(undefined);
    letterActions(world).replayTitle();
    robotActions(world).resetRobot();
    iconFieldActions(world).resetIconFields();
  },
  sampleView: (width: number, height: number, cameraZ: number, aspect: number, ready: boolean) => {
    world.set(Viewport, { width, height, cameraZ, aspect });
    world.set(Preparation, { ready });
  },
}));
