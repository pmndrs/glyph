import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { showcaseFocusPose, showcaseOrbitCoordinates, showcaseOrbitReturnSettled } from './camera-framing';
import { SHOWCASE_FLOOR_Y, SHOWCASE_OBJECTS } from './showcase-objects';
import { SHOWCASE_SELECTED_SCALE } from './selection-motion';

describe('object-showcase camera framing', () => {
  it('projects every selected object into the center of the panel-free region', () => {
    const width = 720;
    const height = 352;
    const camera = new PerspectiveCamera(35, width / height, 0.01, 100);
    camera.rotation.set(-0.35, 0.62, 0);
    const view = new Quaternion().setFromEuler(camera.rotation);
    for (const object of SHOWCASE_OBJECTS) {
      const pose = showcaseFocusPose(object, view, width, height, camera.fov);
      camera.position.copy(pose.position);
      camera.quaternion.copy(pose.quaternion);
      camera.updateMatrixWorld(true);
      const center = new Vector3(
        object.position[0],
        SHOWCASE_FLOOR_Y + (object.size[1] * SHOWCASE_SELECTED_SCALE) / 2,
        object.position[1],
      ).project(camera);
      expect(center.x).toBeCloseTo(pose.targetNdcX, 5);
      expect(Math.abs(center.y)).toBeLessThan(0.02);
    }
  });

  it('finishes a return by orbit radius even while its tangential target keeps moving', () => {
    const target = new Vector3(0, -0.25, 0);
    expect(showcaseOrbitReturnSettled(new Vector3(15, -0.25, 0), target, 15)).toBe(true);
    expect(showcaseOrbitReturnSettled(new Vector3(14.8, -0.25, 0), target, 15)).toBe(false);
  });

  it('adopts an animated camera position without changing its orbit-space position', () => {
    const target = new Vector3(0, -0.25, 0);
    const position = new Vector3(12.5, 8.75, -21.25);
    const orbit = showcaseOrbitCoordinates(position, target);
    const horizontal = Math.cos(orbit.elevation) * orbit.distance;
    const reconstructed = new Vector3(
      target.x + Math.sin(orbit.yaw) * horizontal,
      target.y + Math.sin(orbit.elevation) * orbit.distance,
      target.z + Math.cos(orbit.yaw) * horizontal,
    );

    expect(reconstructed.distanceTo(position)).toBeLessThan(1e-10);
  });
});
