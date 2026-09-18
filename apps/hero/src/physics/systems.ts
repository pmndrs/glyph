import { Not, type World } from 'koota';
import { deltaAngle, lerp, quat, vec3, type Vec3, type Quat } from 'math';
import { rigidBody, updateWorld } from 'crashcat';
import { Frame } from '../sequence/traits';
import { Body, Floor, Physics, type HeldPose } from './traits';

/** Body removal and entity destruction release the same solver handle. */
export function subscribePhysics(world: World): void {
  const physics = world.get(Physics)!;

  world.onRemove(Body, (entity) => {
    const id = entity.get(Body)!.id;
    rigidBody.remove(physics.engine, rigidBody.get(physics.engine, id)!);
    physics.entities.delete(id);
  });
}

/** Fixed 60 Hz integration publishes entity poses and one-frame landing events. */
export function stepPhysics(world: World): void {
  const physics = world.get(Physics)!;
  const bodies = world.query(Body, Not(Floor));
  physics.accumulator = Math.min(physics.accumulator + world.get(Frame)!.delta, 4 / 60);
  const steps = Math.floor(physics.accumulator * 60);
  physics.accumulator -= steps / 60;

  bodies.updateEach(([body]) => {
    body.moved = false;
    body.landed = false;
  });

  for (let step = 1; step <= steps; step++) {
    bodies.updateEach(([body]) => {
      if (body.mode !== 'held') return;

      interpolate(physics.position, physics.rotation, body.from, body.to, step / steps);
      const handle = rigidBody.get(physics.engine, body.id)!;
      rigidBody.wake(physics.engine, handle);
      rigidBody.moveKinematic(handle, physics.position, physics.rotation, 1 / 60);
    });

    // Four collision steps keep the fast smash from crossing thin solids.
    for (let collision = 0; collision < 4; collision++) updateWorld(physics.engine, physics.listener, 1 / 240);

    bodies.updateEach(([body]) => {
      if (body.mode === 'parked') return;

      const handle = rigidBody.get(physics.engine, body.id)!;
      vec3.copy(body.position, handle.position);
      quat.copy(body.rotation, handle.quaternion);
      body.moved = true;
    });
  }

  bodies.updateEach(([body]) => {
    if (body.mode !== 'held') return;

    interpolate(body.position, body.rotation, body.to, body.to, 1);
    body.moved = true;
  });
}

function interpolate(position: Vec3, rotation: Quat, from: HeldPose, to: HeldPose, t: number): void {
  vec3.set(position, lerp(from.x, to.x, t), lerp(from.y, to.y, t), lerp(from.z, to.z, t));
  const yaw = from.yaw + deltaAngle(from.yaw, to.yaw) * t;
  quat.set(rotation, 0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2));
}
