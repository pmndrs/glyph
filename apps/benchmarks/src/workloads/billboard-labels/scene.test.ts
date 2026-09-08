import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import type { ComparisonWorkloadEntry } from '../shared/scene-entry';
import { animateBillboardLabelEntries } from './scene';

function entry(x: number, z: number): ComparisonWorkloadEntry {
  const node = new THREE.Group();
  node.position.set(x, 0, z);
  const text = new THREE.Object3D();
  node.add(text);
  return { animationPhase: 0, node, role: 'primary', sourceText: 'label', text } as unknown as ComparisonWorkloadEntry;
}

describe('billboard label animation', () => {
  it('orbits the supplied camera and reorders labels as their depth crosses', () => {
    const entries = [entry(-100, 0), entry(100, 0)];
    const camera = new THREE.PerspectiveCamera();

    animateBillboardLabelEntries(entries, 0, 400, 300, camera);
    const initialCamera = camera.position.clone();
    const initialOrder = entries.map(({ text }) => text.renderOrder);

    animateBillboardLabelEntries(entries, 12_000, 400, 300, camera);

    expect(camera.position.equals(initialCamera)).toBe(false);
    expect(entries.map(({ text }) => text.renderOrder)).toEqual(initialOrder.toReversed());
    for (const { node } of entries) expect(node.quaternion.equals(camera.quaternion)).toBe(true);
  });
});
