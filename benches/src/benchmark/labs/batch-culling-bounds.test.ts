import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import { applyExperimentBounds } from './batch-culling-bounds';

describe('supplied culling experiment bounds', () => {
  it('keeps a world envelope conservative through a transformed direct draw', () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    mesh.position.set(700, -40, 0);
    mesh.rotation.z = 0.4;
    mesh.scale.set(2, 0.7, 1);
    mesh.updateMatrixWorld(true);
    const world = new THREE.Box3(new THREE.Vector3(-25, -10, 0), new THREE.Vector3(25, 10, 0));
    applyExperimentBounds([mesh], { kind: 'supplied', world });
    const sphere = mesh.geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
    for (const x of [-25, 25]) {
      for (const y of [-10, 10]) expect(sphere.containsPoint(new THREE.Vector3(x, y, 0))).toBe(true);
    }
    expect(mesh.frustumCulled).toBe(true);
    expect(mesh.visible).toBe(true);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it('opts out after an unknown material displacement instead of retaining a stale bound', () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    applyExperimentBounds([mesh], {
      kind: 'supplied',
      world: new THREE.Box3(new THREE.Vector3(900, 0, 0), new THREE.Vector3(950, 40, 0)),
    });
    applyExperimentBounds([mesh], { kind: 'unknown-displacement' });
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.visible).toBe(true);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
