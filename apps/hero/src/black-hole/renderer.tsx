import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three/webgpu';
import { buildMaterials, holeUniforms } from './materials';
import { blackHoleActions } from './actions';
import { HOLE_CENTER } from './content';

/** After the robot leaves, the hole pulls in the scene and fades to black. Space replays the sequence. */
export function BlackHole() {
  const world = useWorld();
  const materials = useMemo(() => buildMaterials(), []);
  const hole = useRef<Group>(null);

  useEffect(() => {
    blackHoleActions(world).mountBlackHoleView({ group: hole.current!, uniforms: holeUniforms });

    return () => blackHoleActions(world).unmountBlackHoleView();
  }, [world]);

  return (
    <>
      <group position={[HOLE_CENTER[0], HOLE_CENTER[1], 5]} ref={hole} visible={false}>
        <mesh material={materials.core} renderOrder={40}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        <mesh material={materials.light} position={[0, 0, 0.01]} renderOrder={41} rotation={[0, 0, -0.15]}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      </group>
      <mesh frustumCulled={false} material={materials.black} position={[0, 0, 7]} renderOrder={60}>
        <planeGeometry args={[60, 60]} />
      </mesh>
    </>
  );
}
