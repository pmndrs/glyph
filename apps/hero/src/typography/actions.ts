import { createActions, type Entity } from 'koota';
import type { Mat4 } from 'math';
import { Time } from '../time/traits';
import { createTitleBodies, disposeTitle, replayTitle, type Letter } from './utils/bodies';
import { Title, Typing } from './traits';

export const typographyActions = createActions((world) => ({
  spawn() {
    world.spawn(Title);
    world.spawn(Typing);
  },
  prepare(worldMatrix: Mat4, letters: readonly Letter[], cameraHeight: number, thickness: number, width: number) {
    const title = world.queryFirst(Title)!.get(Title)!;
    title.bodies = createTitleBodies(world, worldMatrix, letters, cameraHeight, thickness);
    title.width = width;

    return title.bodies;
  },
  dispose(entity: Entity) {
    if (!entity.isAlive()) return;

    const title = entity.get(Title)!;

    if (title.bodies !== undefined) disposeTitle(title.bodies);

    title.bodies = undefined;
    title.width = undefined;
    title.reach = 0;
  },
  replay() {
    world.query(Title).updateEach(([title]) => {
      if (title.bodies !== undefined) replayTitle(world, title.bodies);
    });

    world.query(Typing).updateEach(([typing]) => {
      typing.start = Number.POSITIVE_INFINITY;
      typing.beat = 0;
      typing.count = 0;
    });
  },
  typeAfter(delay: number) {
    world.query(Typing).updateEach(([typing]) => {
      typing.start = world.get(Time)!.now + delay * 1000;
      typing.beat = 0;
      typing.count = 0;
    });
  },
}));
