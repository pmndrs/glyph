import { createActions, type Entity } from 'koota';
import { mat4, vec3, type Mat4 } from 'math';
import { physicsActions } from '../physics/actions';
import { readBodyPose } from '../physics/utils';
import type { HeldPose } from '../physics/traits';
import { Collapse } from '../black-hole/traits';
import { writeLetter } from './utils';
import {
  Title,
  Typing,
  TitleView,
  FeatureView,
  type TitleDraw,
  type FeatureDraw,
  type Letter,
  type TitleBodies,
} from './traits';

const revived: HeldPose = { x: 0, y: 0, z: 0, yaw: 0 };
const still = vec3.create();

export const letterActions = createActions((world) => {
  /**
   * Bring the letters the hole took back home and forget the finale. A lifting title goes up for another drop;
   * otherwise every letter counts as already released.
   */
  function restore(state: TitleBodies, lifting: boolean): void {
    for (let index = 0; index < state.pieces.length; index++) {
      if (state.swallowed[index] !== 1) continue;

      [revived.x, revived.y, revived.z] = state.pieces[index]!.letter.home;
      physicsActions(world).reviveBody(state.pieces[index]!.entity, revived);
      state.grow[index] = 1;
      writeLetter(state, index);
    }

    state.swallowed.fill(0);
    state.released.fill(lifting ? 0 : 1);
    state.departing = false;
    state.departure.fill(Number.NaN);
    state.lifting = lifting;
    state.elapsed = 0;
  }

  return {
    mountTitleView: (view: TitleDraw) => {
      world.queryFirst(Title)!.add(TitleView(view));
    },
    unmountTitleView: () => {
      world.queryFirst(Title)!.remove(TitleView);
    },
    mountFeatureView: (view: FeatureDraw) => {
      world.queryFirst(Typing)!.add(FeatureView(view));
    },
    unmountFeatureView: () => {
      world.queryFirst(Typing)!.remove(FeatureView);
    },
    spawnLetters: () => {
      world.spawn(Title);
      world.spawn(Typing);
    },
    prepareTitle: (
      worldMatrix: Mat4,
      letters: readonly Letter[],
      cameraHeight: number,
      thickness: number,
      width: number,
    ) => {
      const titleEntity = world.queryFirst(Title)!;
      const inverse = mat4.create();
      mat4.invert(inverse, worldMatrix);
      const physics = physicsActions(world);
      physics.setPhysicsFloor(Math.min(...letters.map(({ home }) => home[2])) - thickness / 2);

      const pieces = letters.map((letter) => {
        // From the letter's body to its glyph: undo the body's home, then place the glyph as the paragraph did.
        const offset = mat4.fromTranslation(
          mat4.create(),
          vec3.fromValues(-letter.home[0], -letter.home[1], -letter.home[2]),
        );
        mat4.multiply(offset, offset, worldMatrix);
        mat4.multiply(offset, offset, letter.original);

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
        departure: new Float64Array(letters.length).fill(Number.NaN),
        from: letters.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 })),
        origins: letters.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 })),
        released: new Uint8Array(letters.length),
        swallowed: new Uint8Array(letters.length),
        grow: new Float64Array(letters.length).fill(1),
        landings: letters.map((_, index) => ({ index, x: 0, y: 0 })),
        landingCount: 0,
      };

      for (let index = 0; index < pieces.length; index++) writeLetter(state, index);

      titleEntity.set(Title, { bodies: state, width });

      return state;
    },
    disposeTitle: (entity: Entity) => {
      if (!entity.isAlive()) return;

      const title = entity.get(Title)!;

      if (title.bodies !== undefined) {
        for (const piece of title.bodies.pieces) physicsActions(world).destroyBody(piece.entity);
      }

      entity.set(Title, { bodies: undefined, width: undefined, reach: 0 });
    },
    replayTitle: () => {
      world.query(Title).updateEach(([title]) => {
        const state = title.bodies;

        if (state === undefined) return;

        state.replays++;
        restore(state, true);

        for (let index = 0; index < state.pieces.length; index++) {
          readBodyPose(state.from[index]!, state.pieces[index]!.entity);
        }
      });

      letterActions(world).clearFeature();
    },
    /**
     * Play's hole eats a letter pushed into it: from where it is, it flies into the hole the way the finale's letters
     * do, leaving at `at` on the hole's clock, and is parked and hidden when it arrives.
     */
    eatLetter: (index: number, at: number) => {
      world.query(Title).updateEach(([title]) => {
        const state = title.bodies;

        if (state === undefined || state.swallowed[index] === 1 || !Number.isNaN(state.departure[index])) return;

        readBodyPose(state.origins[index]!, state.pieces[index]!.entity);
        state.departure[index] = at;
      });
    },
    /**
     * Put the title on the floor without a lift: letters the hole took come back home, letters mid-lift drop from
     * where they are, and letters on the floor stay put.
     */
    settleTitle: () => {
      world.query(Title).updateEach(([title]) => {
        const state = title.bodies;

        if (state === undefined) return;

        restore(state, false);

        for (const piece of state.pieces) physicsActions(world).releaseBody(piece.entity, still, 0);
      });
    },
    /**
     * Take the tagline off the paper and forget any pending typing. On the paper it backspaces out; once the hole
     * has taken it, it is simply gone.
     */
    clearFeature: () => {
      const onPaper = world.get(Collapse)!.hole.beat === 'closed';

      world.query(Typing).updateEach(([typing]) => {
        typing.started = false;
        typing.beat = 0;
        typing.leaving = onPaper && typing.count > 0;

        if (!typing.leaving) typing.count = 0;
      });
    },
    startTyping: () => {
      world.query(Typing).updateEach(([typing]) => {
        typing.started = true;
        typing.beat = 0;
        typing.count = 0;
        typing.leaving = false;
      });
    },
  };
});
