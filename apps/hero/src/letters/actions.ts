import { createActions, type Entity } from 'koota';
import { mat4, vec3, type Mat4 } from 'math';
import { physicsActions } from '../physics/actions';
import { readBodyPose } from '../physics/utils';
import { Time } from '../time/traits';
import { writeLetter } from './systems';
import { Title, Typing, type Letter, type TitleBodies } from './traits';

export const letterActions = createActions((world) => ({
  spawnLetters() {
    world.spawn(Title);
    world.spawn(Typing);
  },
  prepareTitle(worldMatrix: Mat4, letters: readonly Letter[], cameraHeight: number, thickness: number, width: number) {
    const titleEntity = world.queryFirst(Title)!;
    const inverse = mat4.create();
    mat4.copy(inverse, worldMatrix);
    mat4.invert(inverse, inverse);
    const physics = physicsActions(world);
    physics.setPhysicsFloor(Math.min(...letters.map(({ home }) => home[2])) - thickness / 2);

    const pieces = letters.map((letter) => {
      const offset = mat4.create();
      const original = mat4.create();
      const transform = mat4.create();
      mat4.copy(original, letter.original);
      mat4.copy(transform, worldMatrix);
      mat4.fromTranslation(offset, vec3.fromValues(-letter.home[0], -letter.home[1], -letter.home[2]));
      mat4.multiply(offset, offset, transform);
      mat4.multiply(offset, offset, original);

      const entity = physics.spawnSolidBody(
        vec3.fromValues(letter.home[0], letter.home[1], letter.home[2]),
        letter.solid.prisms,
      );

      return { letter, offset, entity };
    });

    const state: TitleBodies = {
      matrices: new Float64Array(letters.length * 16),
      inverse,
      pieces,
      liftHeight: cameraHeight - 1.6,
      lifting: false,
      elapsed: 0,
      replays: 0,
      departing: false,
      from: letters.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 })),
      origins: letters.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 })),
      released: new Uint8Array(letters.length),
      swallowed: new Uint8Array(letters.length),
      grow: new Float64Array(letters.length).fill(1),
      landings: letters.map((_, index) => ({ index, x: 0, y: 0 })),
      landingCount: 0,
      pose: { x: 0, y: 0, z: 0, yaw: 0 },
      flight: { radius: 1, turn: 0, stretch: 1, size: 1 },
      velocity: vec3.create(),
      scale: vec3.create(),
      body: mat4.create(),
      matrix: mat4.create(),
    };

    for (let index = 0; index < pieces.length; index++) writeLetter(state, index);

    titleEntity.set(Title, { bodies: state, width });

    return state;
  },
  disposeTitle(entity: Entity) {
    if (!entity.isAlive()) return;

    const title = entity.get(Title)!;

    if (title.bodies !== undefined) {
      for (const piece of title.bodies.pieces) physicsActions(world).destroyBody(piece.entity);
    }

    entity.set(Title, { bodies: undefined, width: undefined, reach: 0 });
  },
  replayTitle() {
    world.query(Title).updateEach(([title]) => {
      const state = title.bodies;

      if (state === undefined) return;

      state.replays++;

      for (let index = 0; index < state.pieces.length; index++) {
        if (state.swallowed[index] === 1) {
          const home = state.pieces[index]!.letter.home;
          state.pose.x = home[0];
          state.pose.y = home[1];
          state.pose.z = home[2];
          state.pose.yaw = 0;
          physicsActions(world).reviveBody(state.pieces[index]!.entity, state.pose);
          state.grow[index] = 1;
          writeLetter(state, index);
        }

        readBodyPose(state.from[index]!, state.pieces[index]!.entity);
      }

      state.swallowed.fill(0);
      state.released.fill(0);
      state.departing = false;
      state.lifting = true;
      state.elapsed = 0;
    });

    world.query(Typing).updateEach(([typing]) => {
      typing.start = Number.POSITIVE_INFINITY;
      typing.beat = 0;
      typing.count = 0;
    });
  },
  typeFeatureAfter(delay: number) {
    world.query(Typing).updateEach(([typing]) => {
      typing.start = world.get(Time)!.now + delay * 1000;
      typing.beat = 0;
      typing.count = 0;
    });
  },
}));
