import { createActions } from 'koota';
import { quat, vec3 } from 'math';
import {
  MotionType,
  addBroadphaseLayer,
  addObjectLayer,
  box,
  convexHull,
  createWorld as createSimulation,
  createWorldSettings,
  dof,
  enableCollision,
  registerShapes,
  rigidBody,
  staticCompound,
} from 'crashcat';
import { Physics } from './traits';
import type { Collider } from './utils';

/** Solver units per page unit: a letter a quarter of a unit tall is a body two units tall, well inside the solver's range. */
export const SOLVER_SCALE = 8;
/** How thick every prism is, in solver units. Motion is locked to the page, so this only has to be solid. */
const DEPTH = 1;

export const physicsActions = createActions((world) => ({
  initializePhysics: () => {
    registerShapes([box.def, convexHull.def, staticCompound.def]);
    const settings = createWorldSettings();
    // Nothing falls on a page. What pulls a letter is the stone, and it says so each step.
    settings.gravity = [0, 0, 0];
    const movingLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
    const wallLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
    enableCollision(settings, movingLayer, movingLayer);
    enableCollision(settings, movingLayer, wallLayer);
    world.set(Physics, {
      engine: createSimulation(settings),
      movingLayer,
      wallLayer,
      accumulator: 0,
      bodies: new Map(),
      poses: new Map(),
      walls: [],
      position: vec3.create(),
      rotation: quat.create(),
      velocity: vec3.create(),
    });
  },
  /**
   * A dynamic body for one letter: its collider's convex pieces as prisms, at `size` page units per em, with its
   * origin on the collider's centre. It moves in the page and turns about the page's normal, and nothing else.
   */
  spawnBody: (
    key: number,
    collider: Collider,
    size: number,
    pose: { x: number; y: number; angle: number; vx: number; vy: number; spin: number },
  ) => {
    const physics = world.get(Physics)!;

    if (physics.bodies.has(key) || collider.pieces.length === 0) return false;

    const scale = size * SOLVER_SCALE;
    const children = collider.pieces.map((piece) => {
      const positions: number[] = [];

      for (const z of [-DEPTH / 2, DEPTH / 2]) {
        for (let index = 0; index < piece.length; index += 2) {
          positions.push((piece[index]! - collider.centerX) * scale, (piece[index + 1]! - collider.centerY) * scale, z);
        }
      }

      return {
        position: vec3.create(),
        quaternion: quat.create(),
        shape: convexHull.create({ positions, density: 1, convexRadius: 0, hullTolerance: 1e-5 }),
      };
    });
    const handle = rigidBody.create(physics.engine, {
      motionType: MotionType.DYNAMIC,
      objectLayer: physics.movingLayer,
      shape: staticCompound.create({ children }),
      position: [pose.x * SOLVER_SCALE, -pose.y * SOLVER_SCALE, 0],
      quaternion: quat.set(physics.rotation, 0, 0, Math.sin(pose.angle / 2), Math.cos(pose.angle / 2)),
      allowedDegreesOfFreedom: dof(true, true, false, false, false, true),
      linearDamping: 0.25,
      angularDamping: 0.35,
      gravityFactor: 0,
      friction: 0.35,
      restitution: 0.55,
      allowSleeping: false,
    });
    rigidBody.setLinearVelocity(
      physics.engine,
      handle,
      vec3.set(physics.velocity, pose.vx * SOLVER_SCALE, -pose.vy * SOLVER_SCALE, 0),
    );
    rigidBody.setAngularVelocity(physics.engine, handle, vec3.set(physics.velocity, 0, 0, pose.spin));
    physics.bodies.set(key, handle);
    physics.poses.set(key, { x: pose.x, y: pose.y, angle: pose.angle, vx: pose.vx, vy: pose.vy });

    return true;
  },
  removeBody: (key: number) => {
    const physics = world.get(Physics)!;
    const handle = physics.bodies.get(key);

    if (handle === undefined) return;

    rigidBody.remove(physics.engine, handle);
    physics.bodies.delete(key);
    physics.poses.delete(key);
  },
  /** Change a body's velocity by `ax, ay` page units per second, y down: how a force reaches it. */
  accelerateBody: (key: number, ax: number, ay: number) => {
    const physics = world.get(Physics)!;
    const handle = physics.bodies.get(key);

    if (handle === undefined) return;

    const [vx, vy] = handle.motionProperties.linearVelocity;
    rigidBody.setLinearVelocity(
      physics.engine,
      handle,
      vec3.set(physics.velocity, vx + ax * SOLVER_SCALE, vy - ay * SOLVER_SCALE, 0),
    );
  },
  /** Replace the static walls: boxes in page units, y down, that bodies bounce off. */
  setWalls: (walls: readonly { left: number; top: number; right: number; bottom: number }[]) => {
    const physics = world.get(Physics)!;

    for (const wall of physics.walls) rigidBody.remove(physics.engine, wall);

    physics.walls = walls.map((wall) =>
      rigidBody.create(physics.engine, {
        motionType: MotionType.STATIC,
        objectLayer: physics.wallLayer,
        shape: box.create({
          halfExtents: [
            ((wall.right - wall.left) / 2) * SOLVER_SCALE,
            ((wall.bottom - wall.top) / 2) * SOLVER_SCALE,
            DEPTH,
          ],
          convexRadius: 0,
        }),
        position: [((wall.left + wall.right) / 2) * SOLVER_SCALE, (-(wall.top + wall.bottom) / 2) * SOLVER_SCALE, 0],
        friction: 0.2,
        restitution: 0.7,
      }),
    );
  },
}));
