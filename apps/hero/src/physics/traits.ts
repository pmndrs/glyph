import { trait, type Entity } from 'koota';
import { quat, vec3 } from 'math';
import {
  addBroadphaseLayer,
  addObjectLayer,
  box,
  convexHull,
  createWorld as createSimulation,
  createWorldSettings,
  enableCollision,
  registerShapes,
  staticCompound,
  type Listener,
} from 'crashcat';

registerShapes([box.def, convexHull.def, staticCompound.def]);

export interface HeldPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export function createHeldPose() {
  return { x: 0, y: 0, z: 0, yaw: 0 };
}

export const Floor = trait();

/** Entity-owned motion and the handle into the shared solver. */
export const Body = trait(() => ({
  id: 0,
  mode: 'dynamic' as 'static' | 'dynamic' | 'held' | 'parked',
  position: vec3.create(),
  rotation: quat.create(),
  from: createHeldPose(),
  to: createHeldPose(),
  airborne: false,
  landed: false,
  moved: false,
}));

/** One solver resource on the application's Koota world. */
export const Physics = trait(() => {
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

  return {
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
  };
});

/** Snapshot an entity's published pose into retained animation storage. */
export function readBodyPose(out: ReturnType<typeof createHeldPose>, entity: Entity): void {
  const body = entity.get(Body)!;
  out.x = body.position[0];
  out.y = body.position[1];
  out.z = body.position[2];
  out.yaw = 2 * Math.atan2(body.rotation[2], body.rotation[3]);
}
