import { Matrix4, Quaternion, Vector3 } from 'three';

import type { ShowcaseObject } from './showcase-objects';
import { SHOWCASE_FLOOR_Y } from './showcase-objects';
import { SHOWCASE_SELECTED_SCALE } from './selection-motion';
import { showcaseUiLayout } from './ui-layout';

export type ShowcaseFocusPose = Readonly<{
  position: Vector3;
  quaternion: Quaternion;
  target: Vector3;
  targetNdcX: number;
}>;

export type ShowcaseOrbitCoordinates = Readonly<{
  distance: number;
  elevation: number;
  yaw: number;
}>;

/** Adopt an animated camera position into the orbit controller without a discontinuous handoff frame. */
export function showcaseOrbitCoordinates(position: Vector3, target: Vector3): ShowcaseOrbitCoordinates {
  const x = position.x - target.x;
  const y = position.y - target.y;
  const z = position.z - target.z;
  const distance = Math.hypot(x, y, z);
  return Object.freeze({
    distance,
    elevation: distance === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, y / distance))),
    yaw: Math.atan2(x, z),
  });
}

/** A moving turntable target is complete once the camera regains its authored orbit radius. */
export function showcaseOrbitReturnSettled(
  cameraPosition: Vector3,
  orbitTarget: Vector3,
  orbitDistance: number,
): boolean {
  return Math.abs(cameraPosition.distanceTo(orbitTarget) - orbitDistance) < 0.03;
}

/** Frame one object in the unobscured left region while reserving the screen-space panel on the right. */
export function showcaseFocusPose(
  object: ShowcaseObject,
  viewQuaternion: Quaternion,
  viewportWidth: number,
  viewportHeight: number,
  verticalFovDegrees: number,
): ShowcaseFocusPose {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const aspect = width / height;
  const tangent = Math.tan((verticalFovDegrees * Math.PI) / 360);
  const leftRegionWidth = Math.max(1, showcaseUiLayout(width, height).panel.x - 12);
  const targetNdcX = leftRegionWidth / width - 1;
  const selectedWidth = object.size[0] * SHOWCASE_SELECTED_SCALE;
  const selectedHeight = object.size[1] * SHOWCASE_SELECTED_SCALE;
  const distanceForHeight = selectedHeight / (2 * tangent * 0.58);
  const distanceForWidth = selectedWidth / (2 * tangent * aspect * 0.42);
  const distance = Math.max(5.6, distanceForHeight, distanceForWidth);
  const center = new Vector3(object.position[0], SHOWCASE_FLOOR_Y + selectedHeight / 2, object.position[1]);
  const forward = new Vector3(0, 0, -1).applyQuaternion(viewQuaternion).normalize();
  const right = forward.clone().cross(_up).normalize();
  const horizontalHalfExtent = distance * tangent * aspect;
  const target = center.clone().addScaledVector(right, -targetNdcX * horizontalHalfExtent);
  const position = target.clone().addScaledVector(forward, -distance);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, target, _up));
  return Object.freeze({ position, quaternion, target, targetNdcX });
}

const _up = new Vector3(0, 1, 0);
