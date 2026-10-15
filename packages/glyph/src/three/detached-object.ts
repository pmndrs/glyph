import * as THREE from 'three/webgpu';
import type { LayoutPoint } from '../layout.js';

/** Copies an object's current local transform without traversing or depending on its ancestors. */
export function copyCurrentLocalTransform(
  source: THREE.Object3D,
  target: THREE.Object3D,
  anchorOffset: LayoutPoint,
): void {
  if (source.matrixAutoUpdate) source.updateMatrix();
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.matrix.copy(source.matrix).multiply(new THREE.Matrix4().makeTranslation(anchorOffset.x, -anchorOffset.y, 0));
  target.matrix.decompose(target.position, target.quaternion, target.scale);
  target.matrixWorldNeedsUpdate = true;
}
