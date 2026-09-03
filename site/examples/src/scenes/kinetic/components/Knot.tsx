import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import type { Group, Texture } from 'three/webgpu';

import { KNOT_POSITION, RADIUS, REPEAT, TUBE } from '../config';
import { surfaceMaterial, surfaceScroll } from '../materials';

/** The torus knot, wearing the tile texture as its skin and turning slowly. */
export function Knot({ skin }: { readonly skin: Texture }) {
  const group = useRef<Group>(null);
  const material = useMemo(() => surfaceMaterial(skin, REPEAT), [skin]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ elapsed }) => {
    surfaceScroll.value = elapsed * 0.06;
    group.current?.rotation.set(0.95 + Math.sin(elapsed * 0.15) * 0.18, elapsed * 0.1, 0.25);
  });

  return (
    <group ref={group} position={[...KNOT_POSITION]}>
      <mesh material={material} receiveShadow>
        <torusKnotGeometry args={[RADIUS, TUBE, 400, 40, 2, 3]} />
      </mesh>
    </group>
  );
}
