import type { Entity } from 'koota';
import { Body, type HeldPose } from './traits';

export function createHeldPose() {
  return { x: 0, y: 0, z: 0, yaw: 0 };
}

/** Snapshot an entity's published pose into retained animation storage. */
export function readBodyPose(out: HeldPose, entity: Entity): void {
  const body = entity.get(Body)!;
  out.x = body.position[0];
  out.y = body.position[1];
  out.z = body.position[2];
  out.yaw = 2 * Math.atan2(body.rotation[2], body.rotation[3]);
}
