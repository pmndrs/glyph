import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useMemo, useRef } from 'react';
import type { Group } from 'three/webgpu';
import { heroReady } from '../view/startup';
import { buildMaterials, HORIZON_ON_PLANE, uPresence, uHeat, uHoleCamera, syncHoleUniforms } from './materials';
import { Collapse } from './traits';
import { HOLE_CENTER } from './utils';

/** After the robot leaves, the hole pulls in the scene and fades to black. Space replays the sequence. */
export function BlackHole() {
  const world = useWorld();
  const materials = useMemo(() => buildMaterials(), []);
  const camera = useThree((state) => state.camera);
  const hole = useRef<Group>(null);

  useFrame(
    () => {
      if (!heroReady()) return;

      uHoleCamera.value = camera.position.z;
      const state = world.get(Collapse)!.hole;
      syncHoleUniforms(state);
      const group = hole.current;

      if (group === null) return;

      group.visible = state.beat === 'open';
      uPresence.value = state.presence;
      uHeat.value = state.pull;
      const size = Math.max(state.horizon / HORIZON_ON_PLANE, 0.001);
      group.scale.set(size, size, 1);
    },
    { fps: 60 },
  );

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
