import * as THREE from 'three/webgpu';

/** Copies an object's current local transform without traversing or depending on its ancestors. */
export function copyCurrentLocalTransform(source: THREE.Object3D, target: THREE.Object3D): void {
  if (source.matrixAutoUpdate) source.updateMatrix();
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.matrix.copy(source.matrix);
  target.matrix.decompose(target.position, target.quaternion, target.scale);
  target.matrixWorldNeedsUpdate = true;
}
