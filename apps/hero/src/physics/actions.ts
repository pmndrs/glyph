import { createActions, type Entity } from 'koota';
import { quat, vec3, type Vec3 } from 'math';
import {
  addBroadphaseLayer,
  addObjectLayer,
  createWorld as createSimulation,
  createWorldSettings,
  enableCollision,
  registerShapes,
  type Listener,
  box,
  convexHull,
  dof,
  MaterialCombineMode,
  MotionType,
  rigidBody,
  staticCompound,
  type RigidBody,
} from 'crashcat';
import { Body, Floor, Physics, type HeldPose } from './traits';
import { readBodyPose } from './utils';

export const physicsActions = createActions((world) => {
  function attach(entity: Entity, handle: RigidBody, mode: 'static' | 'dynamic' | 'parked' = 'dynamic'): Entity {
    const physics = world.get(Physics)!;
    entity.add(Body);
    const body = entity.get(Body)!;
    body.id = handle.id;
    body.mode = mode;
    vec3.copy(body.position, handle.position);
    quat.copy(body.rotation, handle.quaternion);
    physics.entities.set(handle.id, entity);

    return entity;
  }

  function transform(pose: HeldPose): void {
    const physics = world.get(Physics)!;
    vec3.set(physics.position, pose.x, pose.y, pose.z);
    quat.set(physics.rotation, 0, 0, Math.sin(pose.yaw / 2), Math.cos(pose.yaw / 2));
  }

  return {
    initializePhysics() {
      registerShapes([box.def, convexHull.def, staticCompound.def]);
      const settings = createWorldSettings();
      settings.gravity = [0, 0, -80];
      settings.solver.minVelocityForRestitution = 25;
      const movingLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
      const floorLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
      const parkedLayer = addObjectLayer(settings, addBroadphaseLayer(settings));
      enableCollision(settings, movingLayer, movingLayer);
      enableCollision(settings, movingLayer, floorLayer);
      const entities = new Map<number, Entity>();
      const listener: Listener = {
        onContactAdded(a, b) {
          const first = entities.get(a.id)!;
          const second = entities.get(b.id)!;
          const entity = first.has(Floor) ? second : second.has(Floor) ? first : undefined;
          const body = entity?.get(Body);

          if (body === undefined || !body.airborne) return;

          body.airborne = false;
          body.landed = true;
        },
      };

      world.add(
        Physics({
          engine: createSimulation(settings),
          entities,
          listener,
          movingLayer,
          floorLayer,
          parkedLayer,
          accumulator: 0,
          position: vec3.create(),
          rotation: quat.create(),
          velocity: vec3.create(),
        }),
      );
      const physics = world.get(Physics)!;

      world.onRemove(Body, (entity) => {
        const id = entity.get(Body)!.id;
        rigidBody.remove(physics.engine, rigidBody.get(physics.engine, id)!);
        physics.entities.delete(id);
      });
    },
    destroyBody(entity: Entity) {
      if (entity.isAlive()) entity.destroy();
    },
    spawnSolidBody(position: Vec3, prisms: readonly (readonly number[])[]) {
      const physics = world.get(Physics)!;
      const handle = rigidBody.create(physics.engine, {
        motionType: MotionType.DYNAMIC,
        objectLayer: physics.movingLayer,
        shape: staticCompound.create({
          children: prisms.map((prism) => ({
            position: vec3.create(),
            quaternion: quat.create(),
            shape: convexHull.create({ positions: [...prism], density: 8, convexRadius: 0, hullTolerance: 1e-6 }),
          })),
        }),
        position,
        // Letters translate and turn around the floor normal without tipping.
        allowedDegreesOfFreedom: dof(true, true, true, false, false, true),
        linearDamping: 0,
        angularDamping: 0,
        friction: 0.9,
        restitution: 0.3,
        frictionCombineMode: MaterialCombineMode.GEOMETRIC_MEAN,
        restitutionCombineMode: MaterialCombineMode.MAX,
      });

      return attach(world.spawn(), handle);
    },
    setPhysicsFloor(top: number) {
      const physics = world.get(Physics)!;
      const existing = world.queryFirst(Floor, Body);

      if (existing !== undefined) existing.destroy();

      const handle = rigidBody.create(physics.engine, {
        motionType: MotionType.STATIC,
        objectLayer: physics.floorLayer,
        position: [0, 0, top - 0.5],
        shape: box.create({ halfExtents: [80, 80, 0.5], convexRadius: 0 }),
        friction: 0.9,
        restitution: 0,
        frictionCombineMode: MaterialCombineMode.GEOMETRIC_MEAN,
        restitutionCombineMode: MaterialCombineMode.MAX,
      });
      attach(world.spawn(Floor), handle, 'static');
    },
    attachKinematicBody(entity: Entity, halfExtents: readonly [number, number, number]) {
      const physics = world.get(Physics)!;
      const handle = rigidBody.create(physics.engine, {
        motionType: MotionType.STATIC,
        objectLayer: physics.parkedLayer,
        shape: convexHull.create({ positions: stadium(halfExtents), convexRadius: 0 }),
        friction: 0.1,
        frictionCombineMode: MaterialCombineMode.GEOMETRIC_MEAN,
        allowSleeping: false,
      });
      attach(entity, handle, 'parked');
    },
    holdBody(entity: Entity, pose: HeldPose) {
      const physics = world.get(Physics)!;
      const body = entity.get(Body)!;

      if (body.mode !== 'held') {
        rigidBody.setMotionType(physics.engine, rigidBody.get(physics.engine, body.id)!, MotionType.KINEMATIC, true);
        body.airborne = false;
        readBodyPose(body.from, entity);
        body.mode = 'held';
      } else Object.assign(body.from, body.to);

      Object.assign(body.to, pose);
    },
    parkBody(entity: Entity) {
      const physics = world.get(Physics)!;
      const body = entity.get(Body)!;
      const handle = rigidBody.get(physics.engine, body.id)!;
      body.mode = 'parked';
      body.airborne = false;
      rigidBody.setObjectLayer(physics.engine, handle, physics.parkedLayer);
      rigidBody.setMotionType(physics.engine, handle, MotionType.STATIC, false);
    },
    reviveBody(entity: Entity, pose: HeldPose) {
      const physics = world.get(Physics)!;
      const body = entity.get(Body)!;
      const handle = rigidBody.get(physics.engine, body.id)!;
      transform(pose);
      rigidBody.setTransform(physics.engine, handle, physics.position, physics.rotation, true);
      rigidBody.setLinearVelocity(physics.engine, handle, vec3.zero(physics.velocity));
      rigidBody.setAngularVelocity(physics.engine, handle, physics.velocity);
      rigidBody.setObjectLayer(physics.engine, handle, physics.movingLayer);
      rigidBody.setMotionType(physics.engine, handle, MotionType.KINEMATIC, true);
      vec3.copy(body.position, physics.position);
      quat.copy(body.rotation, physics.rotation);
      Object.assign(body.from, pose);
      Object.assign(body.to, pose);
      body.mode = 'held';
      body.airborne = false;
      body.moved = true;
    },
    releaseBody(entity: Entity, velocity: Vec3, spin: number) {
      const physics = world.get(Physics)!;
      const body = entity.get(Body)!;

      if (body.mode !== 'held') return;

      const handle = rigidBody.get(physics.engine, body.id)!;
      transform(body.to);
      rigidBody.setTransform(physics.engine, handle, physics.position, physics.rotation, true);
      rigidBody.setMotionType(physics.engine, handle, MotionType.DYNAMIC, true);
      rigidBody.setLinearVelocity(physics.engine, handle, velocity);
      rigidBody.setAngularVelocity(physics.engine, handle, vec3.set(physics.velocity, 0, 0, spin));
      body.mode = 'dynamic';
      body.airborne = true;
    },
  };
});

/** Upright rounded sides let off-center contacts nudge letters aside. */
function stadium([along, across, up]: readonly [number, number, number]): number[] {
  const points: number[] = [];
  const radius = Math.min(along, across);
  const reach = Math.max(across - radius, 0);

  for (const z of [0, up * 2]) {
    for (let side = 0; side < 10; side++) {
      const angle = (side / 10) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      points.push(x, y + reach, z, x, y - reach, z);
    }
  }

  return points;
}
