import { createWorld } from 'koota';
import { Frame, Sequence } from './sequence/traits';
import { Field, LAYERS, createField } from './field/traits';
import { Robot, ROBOT_HALF_EXTENTS } from './robot/traits';
import { Title, Typing } from './typography/traits';
import { Physics } from './physics/traits';
import { physicsActions } from './physics/actions';
import { subscribePhysics } from './physics/systems';

/** Each scene owns its state. Retained pools are created before any playback. */
export function createHeroWorld() {
  const world = createWorld(Frame, Sequence, Physics);
  subscribePhysics(world);
  physicsActions(world).attachRobot(world.spawn(Robot), ROBOT_HALF_EXTENTS);
  world.spawn(Title);
  world.spawn(Typing);

  for (const options of LAYERS) world.spawn(Field(createField(options)));

  return world;
}
