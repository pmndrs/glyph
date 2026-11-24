import { useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three/webgpu';
import { stoneActions } from './actions';
import { createStoneMaterials, stoneUniforms } from './materials';

/** The stone's own drawing: a black core and its light, above the page. The bending of the frame is the post pass's. */
export function StoneRenderer() {
  const world = useWorld();
  const camera = useThree((state) => state.camera);
  const materials = useMemo(() => createStoneMaterials(), []);
  const group = useRef<Group>(null);

  useEffect(() => {
    stoneActions(world).mountStoneView({ group: group.current!, camera, uniforms: stoneUniforms });

    return () => stoneActions(world).unmountStoneView();
  }, [world, camera]);

  useEffect(
    () => () => {
      materials.core.dispose();
      materials.light.dispose();
    },
    [materials],
  );

  return (
    <group name="stone" ref={group} visible={false}>
      <mesh material={materials.core} renderOrder={40}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <mesh material={materials.light} renderOrder={41} rotation={[0, 0, -0.18]}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  );
}
