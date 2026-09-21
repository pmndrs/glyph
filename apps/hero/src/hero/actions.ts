import { createActions } from 'koota';
import { blackHoleActions } from '../black-hole/actions';
import { iconPaperActions } from '../icon-paper/actions';
import { letterActions } from '../letters/actions';
import { physicsActions } from '../physics/actions';
import { robotActions } from '../robot/actions';
import { sequenceActions } from '../sequence/actions';
import { starEmberActions } from '../star-embers/actions';
import { overPlayButton, playReveal } from '../play-button/systems';
import { Mode, PaperView, Viewport, type ModeKind } from './traits';
import type { Cue } from '../sequence/traits';
import type { Vector2 } from 'three/webgpu';

export const heroActions = createActions((world) => {
  /** Each mode's script. The sequence types the tagline and runs the robot and the finale; play has no script. */
  function script(mode: ModeKind): Cue[] {
    if (mode === 'play') return [];

    return [
      { on: 'letters-landed', after: 0.55, run: () => letterActions(world).typeFeatureAfter(0) },
      { on: 'letters-landed', after: 1.4, run: () => robotActions(world).runRobot() },
      { on: 'robot-departed', run: () => blackHoleActions(world).openBlackHole() },
    ];
  }

  /** Close the finale, restore the paper, lift the title, and reset the robot, then run `mode`'s script. */
  function restart(mode: ModeKind): void {
    world.set(Mode, { kind: mode });
    sequenceActions(world).loadSequence(script(mode));
    blackHoleActions(world).dismissBlackHole();
    starEmberActions(world).resetStarEmbers();
    letterActions(world).replayTitle();
    robotActions(world).resetRobot();
    iconPaperActions(world).resetIconPaper();
  }

  return {
    setViewport: (width: number, height: number, cameraZ: number, aspect: number) => {
      world.set(Viewport, { width, height, cameraZ, aspect });
    },
    initializeHero: () => {
      physicsActions(world).initializePhysics();
      starEmberActions(world).initializeStarEmbers();
      robotActions(world).spawnRobot();
      letterActions(world).spawnLetters();
      iconPaperActions(world).spawnIconPaper();
      sequenceActions(world).loadSequence([{ at: 1, run: () => heroActions(world).replayHero() }]);
    },
    replayHero: () => {
      restart('sequence');
    },
    /** Free play: the robot scoots in from the lower left to a spot above the title, and waits for the pointer. */
    startPlay: () => {
      restart('play');
      const { width, height } = world.get(Viewport)!;
      const robot = robotActions(world);
      robot.placeRobot(-width / 2 - 2.6, -height / 2 - 1.2, 0.9);
      robot.driveRobotTo(-width * 0.33, height * 0.32);
    },
    /** A press at a normalized screen point: in play it sends the robot, over the button it starts play. */
    pressHero: (x: number, y: number) => {
      const { width, height, aspect } = world.get(Viewport)!;

      if (world.get(Mode)!.kind === 'play') robotActions(world).driveRobotTo((x * width) / 2, (y * height) / 2);
      else if (playReveal(world) > 0 && overPlayButton(x * aspect, y)) heroActions(world).startPlay();
    },
    mountPaperView: (drift: Vector2) => {
      world.add(PaperView(drift));
    },
    unmountPaperView: () => {
      world.remove(PaperView);
    },
  };
});
