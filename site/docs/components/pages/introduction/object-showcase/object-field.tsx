import { useFrame } from '@react-three/fiber/webgpu';
import { useLayoutEffect, useRef } from 'react';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { DENSE_SHOWCASE_CAPACITY } from './dense-showcase';
import { SHOWCASE_FLOOR_Y, SHOWCASE_OBJECTS, type ShowcaseObject } from './showcase-objects';
import { SHOWCASE_REST_SCALE } from './selection-motion';
import type { ShowcaseSelectionMotionSource } from './use-selection-motion';

const BOX_ROTATION = new Quaternion();

export function ObjectField({
  denseScale,
  items,
  motion,
  onMount,
  visibleCount,
}: {
  denseScale: Readonly<{ current: number }>;
  items: readonly ShowcaseObject[];
  motion: ShowcaseSelectionMotionSource;
  onMount: (objects: InstancedMesh | null) => void;
  visibleCount: Readonly<{ current: number }>;
}) {
  const objects = useRef<InstancedMesh>(null);
  const matrix = useRef(new Matrix4());
  const position = useRef(new Vector3());
  const scale = useRef(new Vector3());
  const rendered = useRef<{ denseScale: number; index: number | undefined; scale: number }>({
    denseScale: 1,
    index: undefined,
    scale: SHOWCASE_REST_SCALE,
  });

  useLayoutEffect(() => {
    const mesh = objects.current;
    if (mesh === null) return;
    onMount(mesh);
    return () => onMount(null);
  }, [onMount]);

  useLayoutEffect(() => {
    const mesh = objects.current;
    if (mesh === null) return;
    const initialMatrix = matrix.current;
    mesh.count = Math.min(items.length, visibleCount.current);
    for (const [index, object] of items.entries()) {
      setObjectMatrix(initialMatrix, object, 1, position.current, scale.current);
      mesh.setMatrixAt(index, initialMatrix);
      mesh.setColorAt(index, object.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    rendered.current.denseScale = denseScale.current;
    rendered.current.index = undefined;
    rendered.current.scale = SHOWCASE_REST_SCALE;
  }, [denseScale, items, visibleCount]);

  useFrame(() => {
    const mesh = objects.current;
    if (mesh === null) return;
    mesh.count = Math.min(items.length, visibleCount.current);
    const next = motion.current;
    const previous = rendered.current;
    const nextDenseScale = denseScale.current;
    if (
      next.scale === previous.scale &&
      next.selectedIndex === previous.index &&
      nextDenseScale === previous.denseScale
    ) {
      return;
    }
    const nextMatrix = matrix.current;
    if (nextDenseScale !== previous.denseScale) {
      for (let index = SHOWCASE_OBJECTS.length; index < items.length; index += 1) {
        setObjectMatrix(nextMatrix, items[index]!, nextDenseScale, position.current, scale.current);
        mesh.setMatrixAt(index, nextMatrix);
      }
    }
    if (previous.index !== undefined && previous.index !== next.selectedIndex) {
      setObjectMatrix(nextMatrix, items[previous.index]!, 1, position.current, scale.current);
      mesh.setMatrixAt(previous.index, nextMatrix);
    }
    if (next.selectedIndex !== undefined) {
      setObjectMatrix(nextMatrix, items[next.selectedIndex]!, next.scale, position.current, scale.current);
      mesh.setMatrixAt(next.selectedIndex, nextMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    rendered.current.denseScale = nextDenseScale;
    rendered.current.index = next.selectedIndex;
    rendered.current.scale = next.scale;
  });

  return (
    <instancedMesh
      args={[undefined, undefined, DENSE_SHOWCASE_CAPACITY]}
      castShadow
      count={Math.min(items.length, visibleCount.current)}
      name="showcase-objects"
      receiveShadow
      ref={objects}
    >
      <primitive attach="geometry" object={BOX_GEOMETRY} />
      <meshStandardMaterial metalness={0.02} roughness={0.34} vertexColors />
    </instancedMesh>
  );
}

const BOX_GEOMETRY = new RoundedBoxGeometry(1, 1, 1, 5, 0.1);

function setObjectMatrix(
  matrix: Matrix4,
  object: ShowcaseObject,
  selectionScale: number,
  position: Vector3,
  scale: Vector3,
): void {
  const width = object.size[0] * selectionScale;
  const height = object.size[1] * selectionScale;
  const depth = object.size[2] * selectionScale;
  matrix.compose(
    position.set(object.position[0], SHOWCASE_FLOOR_Y + height / 2, object.position[1]),
    BOX_ROTATION,
    scale.set(width, height, depth),
  );
}
