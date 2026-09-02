import type * as THREE from 'three/webgpu';

/** Whether an object remains attached to and visible beneath one retained draw root. */
export function visibleBelowRoot(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current !== null && current !== root) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return current === root;
}
