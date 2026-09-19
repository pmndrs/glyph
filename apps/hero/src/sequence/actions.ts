import { createActions } from 'koota';
import { blackHoleActions } from '../black-hole/actions';
import { iconFieldActions } from '../icon-field/actions';
import { robotActions } from '../robot/actions';
import { typographyActions } from '../typography/actions';
import { starEmberActions } from '../star-embers/actions';
import { Playback } from './traits';

export const sequenceActions = createActions((world) => ({
  spawnSequence() {
    starEmberActions(world).initializeStarEmbers();
    robotActions(world).spawnRobot();
    typographyActions(world).spawnTypography();
    iconFieldActions(world).spawnIconFields();
  },
  replaySequence() {
    world.set(Playback, { started: true });
    blackHoleActions(world).dismissBlackHole();
    starEmberActions(world).sampleStarEmbers(undefined);
    typographyActions(world).replayTitle();
    robotActions(world).resetRobot();
    iconFieldActions(world).resetIconFields();
  },
}));
