import type * as THREE from 'three/webgpu';

import type { ThreeRootContext, ThreeTextMaterial } from '../material.js';

/** Package-private boundary for one Three publication. */
export interface ThreePublicationBoundary {
  readonly renderObject: THREE.Object3D;
  readonly root: ThreeRootContext;
  readonly material: ThreeTextMaterial | undefined;
  objectForTransform?(recordIndex: number, source: THREE.Object3D): THREE.Object3D;
}
