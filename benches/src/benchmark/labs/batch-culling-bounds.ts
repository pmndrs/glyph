import * as THREE from 'three/webgpu';

/** Experiment-only policy: an application must account for every vertex displacement. */
export type ExperimentBounds =
  | { readonly kind: 'supplied'; readonly world: THREE.Box3 }
  | { readonly kind: 'unknown-displacement' };

const inverse = new THREE.Matrix4();
const local = new THREE.Box3();

/**
 * Assign fixture bounds to unshared Glyph geometries with invertible transforms.
 * Visibility and Three's culling traversal remain authoritative; this is not a public bounds API.
 */
export function applyExperimentBounds(draws: readonly THREE.Mesh[], bounds: ExperimentBounds): void {
  for (const draw of draws) {
    draw.frustumCulled = bounds.kind === 'supplied';
    if (bounds.kind === 'unknown-displacement') continue;
    inverse.copy(draw.matrixWorld).invert();
    local.copy(bounds.world).applyMatrix4(inverse);
    draw.geometry.boundingSphere ??= new THREE.Sphere();
    local.getBoundingSphere(draw.geometry.boundingSphere);
  }
}
