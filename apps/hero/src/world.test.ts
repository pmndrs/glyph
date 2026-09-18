import { describe, expect, it } from 'vitest';
import Box3D from 'box3d.js/inline';
import { mat4 } from 'math';
import { createHeroWorld } from './world';
import { advanceHero } from './systems';
import { Frame, Sequence } from './sequence/traits';
import { sequenceActions } from './sequence/actions';
import { COLLAPSE_SECONDS } from './sequence/motion';
import { Field } from './field/traits';
import { Robot } from './robot/traits';
import { robotActions } from './robot/actions';
import { Title, Typing } from './typography/traits';
import { createTitleBodies, disposeTitle } from './typography/bodies';

function prepare(world: ReturnType<typeof createHeroWorld>) {
  const frame = world.get(Frame)!;
  frame.ready = true;
  frame.width = 10;
  frame.height = 6;
  frame.aspect = 10 / 6;
}

describe('hero domains', () => {
  it('keeps worlds isolated and freezes every simulation until preparation finishes', () => {
    const first = createHeroWorld();
    const second = createHeroWorld();
    try {
      const field = first.queryFirst(Field)!.get(Field)!;
      const positions = field.lattice.x;
      advanceHero(first, 30, 30_000);
      expect(first.get(Frame)!.elapsed).toBe(0);
      expect(field.offset).toBe(0);
      expect(first.queryFirst(Robot)!.get(Robot)!.runAt).toBeUndefined();
      prepare(first);
      advanceHero(first, 1 / 60, 30_016);
      expect(field.offset).toBeGreaterThan(0);
      expect(field.lattice.x).toBe(positions);
      expect(second.queryFirst(Field)!.get(Field)!.offset).toBe(0);
      expect(second.get(Sequence)!.hole).not.toBe(first.get(Sequence)!.hole);
      sequenceActions(first).holdCollapse(COLLAPSE_SECONDS);
      advanceHero(first, 1 / 60, 30_033);
      expect(first.get(Sequence)!.hole.beat).toBe('black');
      expect(second.get(Sequence)!.hole.beat).toBe('closed');
    } finally {
      first.destroy();
      second.destroy();
    }
  });

  it('drives the full lift, landing, typing, robot, and finale twice with retained buffers and no renderer', async () => {
    const world = createHeroWorld();
    const b3 = await Box3D();
    const title = world.queryFirst(Title)!.get(Title)!;
    title.bodies = createTitleBodies(
      b3,
      mat4.create(),
      [
        {
          home: [0, 0, 0.5],
          index: 0,
          original: mat4.create(),
          solid: {
            prisms: [
              [
                -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
                -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
              ],
            ],
          },
        },
      ],
      16,
      1,
    );
    const matrices = title.bodies.matrices;
    const poses = title.bodies.world.poses;
    const robot = world.queryFirst(Robot)!.get(Robot)!;
    const typing = world.queryFirst(Typing)!.get(Typing)!;
    const particles = robot.dust.particles;
    const impacts = world.get(Sequence)!.impacts;
    const actions = sequenceActions(world);
    let now = 0;
    prepare(world);
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        actions.replay();
        let lifted = false;
        let landed = false;
        let typed = false;
        let drove = false;
        let emitted = false;
        let opened = false;
        for (let frame = 0; frame < 1_000; frame++) {
          now += 1000 / 60;
          advanceHero(world, 1 / 60, now);
          lifted ||= poses[2]! > 10;
          landed ||= title.bodies.landingCount > 0;
          typed ||= typing.count > 0;
          drove ||= robot.active;
          emitted ||= particles.some((particle) => particle.age < particle.life);
          opened ||= world.get(Sequence)!.hole.beat === 'open';
        }
        expect({ lifted, landed, typed, drove, emitted, opened }).toEqual({
          lifted: true,
          landed: true,
          typed: true,
          drove: true,
          emitted: true,
          opened: true,
        });
        expect(world.get(Sequence)!.hole).toMatchObject({ beat: 'black', blackout: 1 });
        expect(title.bodies.matrices).toBe(matrices);
        expect(title.bodies.world.poses).toBe(poses);
        expect(robot.dust.particles).toBe(particles);
        expect(world.get(Sequence)!.impacts).toBe(impacts);
        expect([...matrices].every(Number.isFinite)).toBe(true);
      }
    } finally {
      disposeTitle(title.bodies);
      world.destroy();
    }
  });

  it('clears held inspection poses and old landing cues on replay', () => {
    const world = createHeroWorld();
    prepare(world);
    try {
      const entity = world.queryFirst(Robot)!;
      const robot = entity.get(Robot)!;
      const typing = world.queryFirst(Typing)!.get(Typing)!;
      const actions = sequenceActions(world);
      actions.impact(1, 2, 0);
      robotActions(world).hold(4);
      actions.holdCollapse(COLLAPSE_SECONDS);
      advanceHero(world, 1 / 60, 5000);
      actions.replay();
      advanceHero(world, 1 / 60, 5017);
      expect(world.get(Sequence)!.hole.beat).toBe('closed');
      expect(robot.held).toBeUndefined();
      expect(robot.active).toBe(false);
      expect(typing.count).toBe(0);
      advanceHero(world, 1 / 60, 10_000);
      expect(robot.active).toBe(false);
      expect(typing.count).toBe(0);
      actions.impact(2, 3, 0);
      advanceHero(world, 1 / 60, 11_417);
      expect(robot.active).toBe(true);
    } finally {
      world.destroy();
    }
  });
});
