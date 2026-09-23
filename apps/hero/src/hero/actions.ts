import { createActions } from 'koota';
import { blackHoleActions } from '../black-hole/actions';
import { iconPaperActions } from '../icon-paper/actions';
import { letterActions } from '../letters/actions';
import { physicsActions } from '../physics/actions';
import { robotActions } from '../robot/actions';
import { sequenceActions } from '../sequence/actions';
import { starEmberActions } from '../star-embers/actions';
import { rainActions } from '../rain/actions';
import { soundActions } from '../sound/actions';
import { Collapse } from '../black-hole/traits';
import { Time } from '../time/traits';
import { Title } from '../letters/traits';
import { Robot } from '../robot/traits';
import { overPlayButton, playReveal } from '../play-button/systems';
import { PLAY_HOLE_AFTER } from '../black-hole/content';
import { Mode, PaperView, Viewport, type ModeKind } from './traits';
import type { Cue } from '../sequence/traits';
import type { Vector2 } from 'three/webgpu';

export const heroActions = createActions((world) => {
  /**
   * Each mode's script. The sequence types the tagline and runs the robot and the finale; play opens its little
   * hole a beat after the rain starts, and feeding it brings on the finale.
   */
  function script(mode: ModeKind): Cue[] {
    if (mode === 'play') return [{ at: PLAY_HOLE_AFTER, run: () => blackHoleActions(world).openPlayHole() }];

    return [
      { on: 'letters-landed', after: 0.55, run: () => letterActions(world).typeFeatureAfter(0) },
      { on: 'letters-landed', after: 1.4, run: () => robotActions(world).runRobot() },
      { on: 'robot-departed', run: () => blackHoleActions(world).openBlackHole() },
    ];
  }

  /**
   * Close the finale, restore the paper, and reset the robot, then run `mode`'s script. The sequence lifts and
   * smashes the title down again; play settles it on the floor where it belongs and takes the tagline off.
   */
  function restart(mode: ModeKind): void {
    world.set(Mode, { kind: mode, since: world.get(Time)!.elapsed });
    sequenceActions(world).loadSequence(script(mode));
    blackHoleActions(world).dismissBlackHole();
    starEmberActions(world).resetStarEmbers();

    if (mode === 'sequence') letterActions(world).replayTitle();
    else {
      letterActions(world).settleTitle();
      letterActions(world).clearFeature();
    }

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
      rainActions(world).initializeRain();
      soundActions(world).initializeSound();
      robotActions(world).spawnRobot();
      letterActions(world).spawnLetters();
      iconPaperActions(world).spawnIconPaper();
      sequenceActions(world).loadSequence([{ at: 1, run: () => heroActions(world).replayHero() }]);
    },
    replayHero: () => {
      restart('sequence');
    },
    /** Free play: the title sits where it belongs, and the robot rolls in from the lower left to a spot above it. */
    startPlay: () => {
      restart('play');
      const { width, height } = world.get(Viewport)!;
      const robot = robotActions(world);
      robot.placeRobot(-width / 2 - 2.6, -height / 2 - 1.2, 0.9);
      robot.driveRobotTo(-width * 0.33, height * 0.32);
    },
    /**
     * A press at a normalized screen point sends the robot there. While the sequence's hole is closed it takes the
     * wheel first: a dropped title stays put and a robot on the floor carries on from where it is, while a title
     * that has not dropped yet restarts into play. Once either mode's finale has opened only the Play button
     * answers; play's little feeding hole leaves the wheel in hand.
     */
    pressHero: (x: number, y: number) => {
      const { width, height, aspect } = world.get(Viewport)!;
      const robot = robotActions(world);
      const beat = world.get(Collapse)!.hole.beat;

      if (beat === 'open' || beat === 'black') {
        if (playReveal(world) > 0 && overPlayButton(x * aspect, y)) heroActions(world).startPlay();

        return;
      }

      if (world.get(Mode)!.kind === 'sequence') {
        const dropped = (world.queryFirst(Title)!.get(Title)!.bodies?.replays ?? 0) > 0;
        const onFloor = dropped && world.queryFirst(Robot)!.get(Robot)!.active;

        if (dropped) {
          world.set(Mode, { kind: 'play', since: world.get(Time)!.elapsed });
          sequenceActions(world).loadSequence(script('play'));
          letterActions(world).clearFeature();
          robot.resetRobot();
        } else restart('play');

        if (!onFloor) robot.placeRobot(-width / 2 - 2.6, -height / 2 - 1.2, 0.9);
      }

      robot.driveRobotTo((x * width) / 2, (y * height) / 2);
    },
    mountPaperView: (drift: Vector2) => {
      world.add(PaperView(drift));
    },
    unmountPaperView: () => {
      world.remove(PaperView);
    },
  };
});
