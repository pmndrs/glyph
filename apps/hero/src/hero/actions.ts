import { createActions } from 'koota';
import { blackHoleActions } from '../black-hole/actions';
import { iconPaperActions } from '../icon-paper/actions';
import { letterActions } from '../letters/actions';
import { physicsActions } from '../physics/actions';
import { robotActions } from '../robot/actions';
import { sequenceActions } from '../sequence/actions';
import { starEmberActions } from '../star-embers/actions';
import { PaperView, Viewport } from './traits';
import type { Vector2 } from 'three/webgpu';

export const heroActions = createActions((world) => ({
  setViewport: (width: number, height: number, cameraZ: number, aspect: number) => {
    world.set(Viewport, { width, height, cameraZ, aspect });
  },
  initializeHero: () => {
    physicsActions(world).initializePhysics();
    starEmberActions(world).initializeStarEmbers();
    robotActions(world).spawnRobot();
    letterActions(world).spawnLetters();
    iconPaperActions(world).spawnIconPaper();

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
    starEmberActions(world).resetStarEmbers();
    letterActions(world).replayTitle();
    robotActions(world).resetRobot();
    iconPaperActions(world).resetIconPaper();
  },
  mountPaperView: (drift: Vector2) => {
    world.add(PaperView(drift));
  },
  unmountPaperView: () => {
    world.remove(PaperView);
  },
}));
