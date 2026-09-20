import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import type { Mesh } from 'three/webgpu';
import { jugglerActions } from './actions';
import { figure } from './utils';

const INK = '#f4f7ff';
const LIMB_THICKNESS = 5;
const LIMBS = [
  'torso',
  'leftUpperArm',
  'leftForearm',
  'rightUpperArm',
  'rightForearm',
  'leftThigh',
  'leftShin',
  'rightThigh',
  'rightShin',
] as const;
const JOINTS = ['head', 'leftHand', 'rightHand', 'leftKnee', 'rightKnee', 'leftElbow', 'rightElbow'] as const;

/** Plain meshes for the stick figure and the floor; the figure view system poses them every frame. */
export function StickFigure() {
  const world = useWorld();
  const height = useThree((state) => state.viewport.height);
  const width = useThree((state) => state.viewport.width);
  const parts = useRef(new Map<string, Mesh>());

  useEffect(() => {
    jugglerActions(world).mountFigureView({ parts: parts.current, eased: 0, joint: [0, 0] });

    return () => jugglerActions(world).unmountFigureView();
  }, [world]);

  const register = (name: string) => (mesh: Mesh | null) => {
    if (mesh === null) parts.current.delete(name);
    else parts.current.set(name, mesh);
  };

  return (
    <group name="juggler">
      <mesh position={[0, figure(height).floorY - 3, -1]} scale={[width, 1, 1]}>
        <planeGeometry args={[1, 2]} />
        <meshBasicNodeMaterial color="#293244" />
      </mesh>
      {LIMBS.map((name) => (
        <mesh key={name} ref={register(name)}>
          <planeGeometry args={[1, LIMB_THICKNESS]} />
          <meshBasicNodeMaterial color={INK} />
        </mesh>
      ))}
      {JOINTS.map((name) => (
        <mesh key={name} ref={register(name)}>
          <circleGeometry args={[name === 'head' ? figure(height).headRadius : LIMB_THICKNESS / 2, 32]} />
          <meshBasicNodeMaterial color={INK} />
        </mesh>
      ))}
    </group>
  );
}
