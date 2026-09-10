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
    // Two motions, and they are different things. The skin crawls along the tube on its own, which
    // is what makes the knot read as a marquee; the knot turns under it, which is what carries the
    // far side round to be read. The write head does not travel with either — the passage is
    // end-aligned in the strip, so new words arrive at the same place on the tile and the crawl
    // takes them away.
    surfaceScroll.value = elapsed * 0.06;
    group.current?.rotation.set(0.95 + Math.sin(elapsed * 0.19) * 0.26, elapsed * 0.16, 0.25);
  });

  return (
    <group ref={group} position={[...KNOT_POSITION]}>
      <mesh material={material}>
        <torusKnotGeometry args={[RADIUS, TUBE, 400, 40, 2, 3]} />
      </mesh>
    </group>
  );
}
