import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';

import type { ComparisonWorkloadEntry } from '../shared/scene-entry';
import { editorialFlow, layoutEditorialEntries, positionEditorialObstacle } from './scene';

function editorialEntry(
  width: number,
  height: number,
): {
  readonly entry: ComparisonWorkloadEntry;
  readonly measure: ReturnType<typeof vi.fn>;
  readonly position: { x: number; y: number; z: number };
} {
  const position = {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  };
  const measure = vi.fn<() => { width: number; height: number }>(() => ({ width, height }));
  const text = { measure, position } as unknown as ComparisonWorkloadEntry['text'];
  return {
    entry: { node: text, role: 'primary', sourceText: '', text },
    measure,
    position,
  };
}

describe('editorial layout', () => {
  it('measures each paragraph once while centering the complete block', () => {
    const lede = editorialEntry(320, 80);
    const body = editorialEntry(400, 240);

    layoutEditorialEntries([lede.entry, body.entry], 1_000, 800);

    expect(lede.measure).toHaveBeenCalledTimes(1);
    expect(body.measure).toHaveBeenCalledTimes(1);
    expect(lede.position).toMatchObject({ x: 300, y: -240, z: 0 });
    expect(body.position).toMatchObject({ x: 300, y: -320, z: 0 });
  });

  it('authors two ordered columns with independently routed exclusions', () => {
    const leftExclusion = {
      key: 'left-object',
      shape: { kind: 'rectangle', bounds: [10, 20, 30, 40] },
    } as const;
    const rightExclusion = {
      key: 'right-object',
      shape: { kind: 'rectangle', bounds: [240, 30, 270, 60] },
    } as const;

    const flow = editorialFlow(500, 700, 20, [leftExclusion, rightExclusion]);

    expect(flow.regions).toEqual([
      {
        key: 'editorial-left',
        shape: { kind: 'rectangle', bounds: [0, 0, 240, 700] },
        exclusions: [leftExclusion],
      },
      {
        key: 'editorial-right',
        shape: { kind: 'rectangle', bounds: [260, 0, 500, 700] },
        exclusions: [rightExclusion],
      },
    ]);
  });

  it('moves the projected object across the text plane deterministically', () => {
    const obstacle = new THREE.Object3D();
    const animationSpeed = 30;
    const rate = 0.25 + animationSpeed * 0.0175;

    positionEditorialObstacle(obstacle, 500, 700, animationSpeed, 0);
    const cameraSideZ = obstacle.position.z;
    positionEditorialObstacle(obstacle, 500, 700, animationSpeed, Math.PI / (0.00042 * rate));

    expect(cameraSideZ).toBeGreaterThan(0);
    expect(obstacle.position.z).toBeLessThan(0);
    expect(obstacle.position.toArray().every(Number.isFinite)).toBe(true);
    expect([obstacle.rotation.x, obstacle.rotation.y, obstacle.rotation.z].every(Number.isFinite)).toBe(true);
  });
});
