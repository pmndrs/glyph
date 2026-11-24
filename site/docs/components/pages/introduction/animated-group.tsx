import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, type ReactNode } from 'react';
import { Group } from 'three';

export function AnimatedGroup({
  children,
  speed = 1,
  amount = 0.04,
}: {
  children: ReactNode;
  speed?: number;
  amount?: number;
}) {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) {
      group.current.position.y = Math.sin(elapsed.current * speed) * amount;
      group.current.rotation.z = Math.sin(elapsed.current * speed * 0.7) * amount * 0.25;
    }
  });
  return <group ref={group}>{children}</group>;
}
