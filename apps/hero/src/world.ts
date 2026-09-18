import { createWorld } from 'koota';
import { Frame, Sequence } from './sequence/traits';
import { Field, LAYERS, createField } from './field/traits';
import { Robot } from './robot/traits';
import { Title, Typing } from './typography/traits';

/** Each scene owns its state. Retained pools are created before any playback. */
export function createHeroWorld() {
  const world = createWorld(Frame, Sequence);
  world.spawn(Robot);
  world.spawn(Title);
  world.spawn(Typing);
  for (const options of LAYERS) world.spawn(Field(createField(options)));
  return world;
}
