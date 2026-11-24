import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, type ReactNode } from 'react';
import type { Group } from 'three/webgpu';

/** A group that always faces the camera, lifted `offset` above its parent's origin. */
export function Billboard({ offset = 0, children }: { readonly offset?: number; readonly children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    group.current?.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={group} position={[0, offset, 0]}>
      {children}
    </group>
  );
}
