import type { Entity } from 'koota';
import { quat, type Quat } from 'math';
import { Body, type HeldPose } from './traits';

/** Snapshot an entity's published pose into retained animation storage. */
export function readBodyPose(out: HeldPose, entity: Entity): void {
  const body = entity.get(Body)!;
  out.x = body.position[0];
  out.y = body.position[1];
  out.z = body.position[2];
  out.yaw = 2 * Math.atan2(body.rotation[2], body.rotation[3]);
}

/** A turn of `yaw` about the floor normal, the only turn a body here makes. */
export function yawRotation(out: Quat, yaw: number): Quat {
  return quat.set(out, 0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2));
}
