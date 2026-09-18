import { createActions, trait } from 'koota';
import { blackHoleActions } from './black-hole/actions';
import { fieldActions } from './field/actions';
import { robotActions } from './robot/actions';
import { typographyActions } from './typography/actions';

/** Application playback state belongs to the composition. */
export const Playback = trait(() => ({ started: false }));

export const heroActions = createActions((world) => ({
  spawn() {
    robotActions(world).spawn();
    typographyActions(world).spawn();
    fieldActions(world).spawn();
  },
  replay() {
    world.get(Playback)!.started = true;
    blackHoleActions(world).dismiss();
    typographyActions(world).replay();
    robotActions(world).reset();
    fieldActions(world).reset();
  },
}));
