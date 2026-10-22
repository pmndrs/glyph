import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';

import type { ComparisonWorkloadEntry } from '../shared/scene-entry';
import {
  animateEditorialEntries,
  editorialBodyHeight,
  editorialColumnWidth,
  editorialFlow,
  layoutEditorialEntries,
  positionEditorialObstacle,
  projectedPausedEditorialFlow,
  sameEditorialFlow,
} from './scene';

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

  it('keeps the projected object centered while rotating its silhouette deterministically', () => {
    const obstacle = new THREE.Object3D();
    const animationSpeed = 30;
    const rate = 0.25 + animationSpeed * 0.0175;

    positionEditorialObstacle(obstacle, 500, 700, animationSpeed, 0);
    const initialPosition = obstacle.position.clone();
    const initialRotation = obstacle.rotation.clone();
    positionEditorialObstacle(obstacle, 500, 700, animationSpeed, Math.PI / (0.00042 * rate));

    expect(initialPosition.toArray()).toEqual([250, -329, 50]);
    expect(obstacle.position.equals(initialPosition)).toBe(true);
    expect(obstacle.rotation.equals(initialRotation)).toBe(false);
    expect(obstacle.position.toArray().every(Number.isFinite)).toBe(true);
    expect([obstacle.rotation.x, obstacle.rotation.y, obstacle.rotation.z].every(Number.isFinite)).toBe(true);
  });
});

describe('paused editorial projection', () => {
  it('publishes the final text-plane projection after animation and updates it for paused transforms', () => {
    const configuration = {
      animationEnabled: true,
      animationSpeed: 30,
      fontSize: 20,
      layoutWidthRatio: 1,
    };
    const viewportWidth = 1_000;
    const viewportHeight = 800;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, viewportWidth / viewportHeight, 1, 2_000);
    camera.position.set(500, -400, 900);
    camera.lookAt(500, -400, 0);
    const ledeNode = new THREE.Group();
    const bodyNode = new THREE.Group();
    const obstacle = new THREE.Mesh(new THREE.BoxGeometry(96, 96, 96));
    const bodyText = new THREE.Object3D();
    bodyNode.add(bodyText, obstacle);
    scene.add(ledeNode, bodyNode);
    const initialWidth = editorialColumnWidth(configuration, viewportWidth, 0);
    const fixedHeight = editorialBodyHeight(configuration.fontSize);
    const ledeState = { constraints: { width: { mode: 'exact', size: initialWidth } } };
    const bodyState: {
      constraints: { width: { mode: string; size: number } };
      flow: ReturnType<typeof editorialFlow> | undefined;
    } = { constraints: { width: { mode: 'exact', size: initialWidth } }, flow: undefined };
    const ledeText = Object.assign(ledeNode, {
      set(properties: { constraints: typeof ledeState.constraints }) {
        ledeState.constraints = properties.constraints;
      },
      measure() {
        return { width: ledeState.constraints.width.size, height: ledeState.constraints.width.size * 0.2 };
      },
    });
    Object.defineProperty(ledeText, 'constraints', { get: () => ledeState.constraints });
    const body = Object.assign(bodyText, {
      set(properties: { constraints: typeof bodyState.constraints; flow: ReturnType<typeof editorialFlow> }) {
        bodyState.constraints = properties.constraints;
        bodyState.flow = {
          regions: properties.flow.regions.map((region) => ({
            ...region,
            shape:
              region.shape.kind === 'rectangle'
                ? {
                    kind: 'rectangle' as const,
                    bounds: region.shape.bounds.map(Math.fround) as [number, number, number, number],
                  }
                : region.shape,
          })),
        };
      },
      measure() {
        return { width: bodyState.constraints.width.size, height: fixedHeight };
      },
    });
    Object.defineProperties(body, {
      constraints: { get: () => bodyState.constraints },
      flow: { get: () => bodyState.flow },
    });
    const entries: ComparisonWorkloadEntry[] = [
      {
        node: ledeNode,
        role: 'primary',
        sourceText: 'lede',
        text: ledeText as unknown as ComparisonWorkloadEntry['text'],
      },
      {
        node: bodyNode,
        role: 'secondary',
        sourceText: 'body',
        text: body as unknown as ComparisonWorkloadEntry['text'],
        editorialObstacle: obstacle,
        editorialObstacleBounds: new THREE.Box3(new THREE.Vector3(-48, -48, -48), new THREE.Vector3(48, 48, 48)),
      },
    ];
    const onError = (error: unknown) => {
      throw error;
    };
    const onReflow = vi.fn<() => void>();
    const animate = (animationEnabled: boolean, timestamp: number) =>
      animateEditorialEntries(
        entries,
        { ...configuration, animationEnabled },
        timestamp,
        viewportWidth,
        viewportHeight,
        scene,
        onError,
        onReflow,
        camera,
      );
    const currentFlow = () => projectedPausedEditorialFlow(entries[1]!, camera, configuration, viewportWidth);

    animate(true, 5_000);
    animate(false, 5_000);
    expect(sameEditorialFlow(currentFlow(), bodyState.flow)).toBe(false);
    animate(false, 5_000);
    expect(sameEditorialFlow(currentFlow(), bodyState.flow)).toBe(true);
    const settledReflows = onReflow.mock.calls.length;
    animate(false, 5_000);
    expect(onReflow).toHaveBeenCalledTimes(settledReflows);

    camera.position.x += 25;
    camera.lookAt(500, -400, 0);
    animate(false, 5_000);
    expect(onReflow).toHaveBeenCalledTimes(settledReflows + 1);
    expect(sameEditorialFlow(currentFlow(), bodyState.flow)).toBe(true);

    scene.position.x += 17;
    animate(false, 5_000);
    expect(onReflow).toHaveBeenCalledTimes(settledReflows + 2);
    expect(sameEditorialFlow(currentFlow(), bodyState.flow)).toBe(true);
  });
});
