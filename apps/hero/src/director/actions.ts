import { createActions } from 'koota';
import { blackHoleActions } from '../black-hole/actions';
import { iconPaperActions } from '../icon-paper/actions';
import { letterActions } from '../letters/actions';
import { physicsActions } from '../physics/actions';
import { robotActions } from '../robot/actions';
import { sequenceActions } from '../sequence/actions';
import { rainActions } from '../rain/actions';
import { soundActions } from '../sound/actions';
import { Collapse } from '../black-hole/traits';
import { Time } from '../time/traits';
import { Title } from '../letters/traits';
import { Robot } from '../robot/traits';
import { uiActions } from '../ui/actions';
import { overPlayButton } from '../ui/content';
import { PlayButton } from '../ui/traits';
import { PLAY_HOLE_AFTER } from '../black-hole/content';
import { Viewport } from '../viewport/traits';
import { Mode, type ModeKind } from './traits';
import type { Cue } from '../sequence/traits';

export const directorActions = createActions((world) => {
  /**
   * Each mode's script. The sequence types the tagline and runs the robot and the finale; play opens its little
   * hole a beat after the rain starts, and feeding it brings on the finale.
   */
  function script(mode: ModeKind): Cue[] {
    if (mode === 'play') return [{ at: PLAY_HOLE_AFTER, run: () => blackHoleActions(world).openPlayHole() }];

    return [
      { on: 'letters-landed', after: 0.55, run: () => letterActions(world).startTyping() },
      { on: 'letters-landed', after: 1.4, run: () => robotActions(world).runRobot() },
      { on: 'robot-departed', run: () => blackHoleActions(world).openBlackHole() },
    ];
  }

  /** Run `mode`'s script from now. */
  function enter(mode: ModeKind): void {
    world.set(Mode, { kind: mode, since: world.get(Time)!.elapsed });
    sequenceActions(world).loadSequence(script(mode));
  }

  /** Stand the robot beyond the lower-left edge, facing in, so it scoots in when sent somewhere. */
  function placeOffscreen(): void {
    const { width, height } = world.get(Viewport)!;
    robotActions(world).placeRobot(-width / 2 - 2.6, -height / 2 - 1.2, 0.9);
  }

  /**
   * Close the finale, restore the paper, and reset the robot, then run `mode`'s script. The sequence lifts and
   * smashes the title down again; play settles it on the floor where it belongs and takes the tagline off.
   */
  function restart(mode: ModeKind): void {
    enter(mode);
    blackHoleActions(world).dismissBlackHole();

    if (mode === 'sequence') letterActions(world).replayTitle();
    else {
      letterActions(world).settleTitle();
      letterActions(world).clearFeature();
    }

    robotActions(world).resetRobot();
    iconPaperActions(world).resetIconPaper();
  }

  return {
    initializeScene: () => {
      physicsActions(world).initializePhysics();
      uiActions(world).initializePlayButton();
      rainActions(world).initializeRain();
      soundActions(world).initializeSound();
      robotActions(world).spawnRobot();
      letterActions(world).spawnLetters();
      iconPaperActions(world).spawnIconPaper();
      sequenceActions(world).loadSequence([{ at: 1, run: () => directorActions(world).replayScene() }]);
    },
    replayScene: () => {
      restart('sequence');
    },
    /**
     * A press at a normalized screen point sends the robot there. While the sequence's hole is closed it takes the
     * wheel first: a dropped title stays put and a robot on the floor carries on from where it is, while a title
     * that has not dropped yet restarts into play. Once either mode's finale has opened only the Play button
     * answers; play's little feeding hole leaves the wheel in hand.
     */
    pressScene: (x: number, y: number) => {
      const { width, height, aspect } = world.get(Viewport)!;
      const robot = robotActions(world);
      const beat = world.get(Collapse)!.hole.beat;

      if (beat === 'open' || beat === 'black') {
        // Free play from the button: the title sits where it belongs, and the robot rolls in to a spot above it.
        if (world.get(PlayButton)!.reveal > 0 && overPlayButton(x * aspect, y)) {
          restart('play');
          placeOffscreen();
          robot.driveRobotTo(-width * 0.33, height * 0.32);
        }

        return;
      }

      if (world.get(Mode)!.kind === 'sequence') {
        const dropped = (world.queryFirst(Title)!.get(Title)!.bodies?.replays ?? 0) > 0;
        const onFloor = dropped && world.queryFirst(Robot)!.get(Robot)!.active;

        if (dropped) {
          enter('play');
          letterActions(world).clearFeature();
          robot.resetRobot();
        } else restart('play');

        if (!onFloor) placeOffscreen();
      }

      robot.driveRobotTo((x * width) / 2, (y * height) / 2);
    },
  };
});
